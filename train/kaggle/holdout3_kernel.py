"""Hydra Nano v2 on the 10,000-task third holdout (2,000 per head), once, on one Kaggle T4.
No training and no sealed git1 input. Only per-head aggregates are written to /kaggle/working; per-task rows and
per-intent logs stay in /tmp, so no failure row leaves the worker."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile

WORK = Path('/kaggle/working')
TEMP = Path('/tmp/hydra-holdout3')
START = time.monotonic()
DEADLINE = 6900  # Kaggle cap is 7,200 s; leave room to write the summary


def main():
    inputs = next(Path('/kaggle/input').rglob('plan.json')).parent
    plan = json.loads((inputs / 'plan.json').read_text())
    if plan['training'] or plan['sealedEvaluation'] or plan['split'] != 'holdout3' or plan['tasks'] != 10000:
        raise ValueError('Expected the approved 10,000-task holdout3 evaluation plan')
    TEMP.mkdir(parents=True, exist_ok=True)
    repo, sources = TEMP / 'source', TEMP / 'quality-sources'
    # Kaggle may hand over an uploaded zip already unpacked; accept either form, by content hash.
    if (inputs / 'frozen.zip').is_file():
        if hashlib.sha256((inputs / 'frozen.zip').read_bytes()).hexdigest() != plan['frozen.zip']:
            raise ValueError('frozen.zip changed')
        with zipfile.ZipFile(inputs / 'frozen.zip') as archive:
            archive.extractall(repo)
    else:
        shutil.copytree(inputs / 'frozen', repo)
    sys.path.insert(0, str(repo / 'train/kaggle'))
    import kernel as helpers
    helpers.START, helpers.LIMIT = START, DEADLINE
    for name, expected in plan['sourceHashes'].items():
        if 'git1' in name or helpers.digest(repo / name) != expected:
            raise ValueError(f'Unexpected/changed source: {name}')
    # The Files and Read source files, taken from the pinned public release archives; each file's SHA-256 is checked.
    wanted = plan['sourceFiles']
    for release, spec in plan['sourceArchives'].items():
        archive = TEMP / f'{release}.tar.gz'
        with urllib.request.urlopen(spec['url'], timeout=120) as response, open(archive, 'wb') as stream:
            shutil.copyfileobj(response, stream, 8 * 1024 * 1024)
        with tarfile.open(archive) as bundle:
            for member in bundle:
                if not member.isfile() or not member.name.startswith(spec['prefix']):
                    continue
                key = release + '/' + member.name[len(spec['prefix']):]
                if key in wanted:
                    data = bundle.extractfile(member).read()
                    if hashlib.sha256(data).hexdigest() != wanted[key]:
                        raise ValueError(f'Source file differs from the pinned one: {key}')
                    (sources / key).parent.mkdir(parents=True, exist_ok=True)
                    (sources / key).write_bytes(data)
        archive.unlink()
    missing = [key for key in wanted if not (sources / key).is_file()]
    if missing:
        raise ValueError(f'{len(missing)} pinned source files not found in their archives, e.g. {missing[0]}')

    manifest = json.loads((repo / 'skills/hydra/scripts/runtime-manifest.json').read_text())
    node = shutil.which('node')
    if not node or int(subprocess.check_output([node, '--version'], text=True).lstrip('v').split('.')[0]) < 18:
        spec = manifest['nodeArtifact']
        helpers.download(spec['url'], TEMP / 'node.tar.xz', spec['sha256'])
        helpers.extract(TEMP / 'node.tar.xz', TEMP / 'node')
        node = str(next((TEMP / 'node').rglob('bin/node')))
    runtime = TEMP / 'llama-runtime'
    runtime.mkdir(exist_ok=True)
    for index, spec in enumerate(manifest['llama']['gpuArtifacts']):
        helpers.download(spec['url'], TEMP / f'runtime-{index}.tar.gz', spec['sha256'])
        helpers.extract(TEMP / f'runtime-{index}.tar.gz', runtime)
    server_file = next(runtime.rglob('llama-server'))
    server_file.chmod(0o755)
    model = TEMP / 'hydra-nano-git-Q8_0.gguf'
    if plan['model']['sha256'] != manifest['model']['sha256']:
        raise ValueError('Plan model differs from the pinned runtime manifest')
    helpers.download(manifest['model']['url'], model, manifest['model']['sha256'])
    for argv in (['git', 'config', '--global', 'user.name', 'Hydra Evaluation'],
                 ['git', 'config', '--global', 'user.email', 'hydra-eval@example.invalid'],
                 ['git', 'config', '--global', 'core.autocrlf', 'false']):
        helpers.run(argv)

    libs = {str(file.parent) for file in runtime.rglob('*.so*') if file.is_file()}
    env = {**os.environ, 'CUDA_VISIBLE_DEVICES': '0',
        'LD_LIBRARY_PATH': ':'.join(sorted(libs)) + ':' + os.environ.get('LD_LIBRARY_PATH', ''),
        'HYDRA_BACKEND': 'llamacpp', 'HYDRA_LLAMA_URL': 'http://127.0.0.1:11435', 'HYDRA_TELEMETRY': '0',
        'HYDRA_HOME': str(TEMP / 'hydra-home'), 'HYDRA_MODEL': 'hydra-nano:git'}
    gpu = lambda: [int(v) for v in subprocess.check_output(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], text=True).splitlines()]
    before = gpu()
    log = open(TEMP / 'server.log', 'w')
    server = subprocess.Popen([str(server_file), '-m', str(model), '--alias', 'hydra-nano:git', '--host', '127.0.0.1',
        '--port', '11435', '-c', '32768', '-np', '4', '-ngl', 'all', '--no-slots', '--no-webui'], env=env, stdout=log, stderr=log)
    timings, summary = {}, {}
    try:
        ready = time.monotonic() + 180
        while time.monotonic() < ready:
            if server.poll() is not None:
                raise RuntimeError('llama-server exited during start-up')
            try:
                with urllib.request.urlopen(env['HYDRA_LLAMA_URL'] + '/health', timeout=1) as response:
                    if response.status == 200:
                        break
            except Exception:
                time.sleep(0.5)
        else:
            raise TimeoutError('llama-server readiness timeout')
        after = gpu()
        if after[0] - before[0] < 100:
            raise RuntimeError('Refusing CPU fallback: the model did not load on the GPU')

        # Files, Read, Test, OS: rows stay in /tmp; only byHead aggregates are kept.
        started = time.monotonic()
        full = TEMP / 'suite-holdout3-rows.json'
        with open(TEMP / 'suite.log', 'w') as output:
            helpers.run([node, 'evals/suite/run.mjs', '--heads', 'files,read,test,os', '--split', 'holdout3',
                '--source-root', str(sources), '--output', str(full)], cwd=repo, env=env, stdout=output, stderr=subprocess.STDOUT)
        report = json.loads(full.read_text())
        if not report.get('complete') or any(report['byHead'][head]['tasks'] != 2000 for head in ('files', 'read', 'test', 'os')):
            raise ValueError('Incomplete Files/Read/Test/OS evaluation')
        summary.update(report['byHead'])
        timings['filesReadTestOs'] = time.monotonic() - started

        # Git: builds the 100 worlds and refuses to score if any HEAD differs from the frozen tasks.
        started = time.monotonic()
        with open(TEMP / 'git.log', 'w') as output:
            helpers.run([node, 'evals/run_dev.mjs'], cwd=repo, env={**env, 'HYDRA_GIT_DEV_SET': 'holdout3'},
                stdout=output, stderr=subprocess.STDOUT)
        git = json.loads((repo / 'evals/results/git_dev_holdout3.hydra-nano-git.json').read_text())
        if git['overall']['tasks'] != 2000:
            raise ValueError('Incomplete Git evaluation')
        summary['git'] = git['overall']
        timings['git'] = time.monotonic() - started
        processes = subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'], text=True)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
    for name, expected in plan['sourceHashes'].items():
        if helpers.digest(repo / name) != expected:
            raise ValueError(f'Source changed during evaluation: {name}')
    result = {'complete': True, 'training': False, 'sealedEvaluation': False, 'split': 'holdout3',
        'tasks': sum(head['tasks'] for head in summary.values()), 'elapsedSeconds': time.monotonic() - START,
        'planSha256': hashlib.sha256((inputs / 'plan.json').read_bytes()).hexdigest(),
        'modelSha256': helpers.digest(model), 'gpuBeforeMB': before, 'gpuAfterMB': after, 'gpuProcesses': processes,
        'secondsByStage': timings, 'byHead': summary,
        'scope': 'Third holdout, scored once; per-head aggregates only. Rows and per-intent logs were not kept.'}
    (WORK / 'holdout3-summary.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({head: {'tasks': v['tasks'], 'solved': v['solved']} for head, v in summary.items()}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        (WORK / 'holdout3-failure.json').write_text(json.dumps({'error': str(error), 'elapsedSeconds': time.monotonic() - START,
            'training': False, 'sealedEvaluation': False}))
        raise
