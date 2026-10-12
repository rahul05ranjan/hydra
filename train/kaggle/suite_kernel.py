"""Bounded private five-head DEVELOPMENT diagnosis. No training or sealed input."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

WORK = Path('/kaggle/working')
TEMP = Path('/tmp/hydra-suite')
START = time.monotonic()


def unzip(file, destination):
    with zipfile.ZipFile(file) as archive:
        archive.extractall(destination)


def main():
    inputs = next(Path('/kaggle/input').rglob('plan.json')).parent
    plan = json.loads((inputs / 'plan.json').read_text())
    if plan['training'] or plan['sealedEvaluation'] or plan['deadlineSeconds'] != 1800:
        raise ValueError('Expected approved 30-minute development-only plan')
    TEMP.mkdir(parents=True, exist_ok=True)
    repo = TEMP / 'source'
    if (inputs / 'frozen.zip').exists():
        h = hashlib.sha256((inputs / 'frozen.zip').read_bytes()).hexdigest()
        if h != plan['frozenSha256']:
            raise ValueError('Frozen source archive changed')
        unzip(inputs / 'frozen.zip', repo)
    else:
        shutil.copytree(inputs / 'frozen', repo)
    sys.path.insert(0, str(repo / 'train/kaggle'))
    import kernel as helpers
    helpers.START = START
    helpers.LIMIT = 1780
    for name, expected in plan['sourceHashes'].items():
        if name.startswith('evals/git1/') or helpers.digest(repo / name) != expected:
            raise ValueError(f'Unexpected/changed source: {name}')
    manifest = json.loads((repo / 'skills/hydra/scripts/runtime-manifest.json').read_text())
    node = shutil.which('node')
    if not node or int(subprocess.check_output([node, '--version'], text=True).lstrip('v').split('.')[0]) < 18:
        spec = manifest['nodeArtifact']
        file = TEMP / 'node.tar.xz'
        helpers.download(spec['url'], file, spec['sha256'])
        helpers.extract(file, TEMP / 'node')
        node = str(next((TEMP / 'node').rglob('bin/node')))
    helpers.run(['nvidia-smi'])
    runtime = TEMP / 'llama-runtime'
    runtime.mkdir(exist_ok=True)
    for index, spec in enumerate(manifest['llama']['gpuArtifacts']):
        file = TEMP / f'runtime-{index}.tar.gz'
        helpers.download(spec['url'], file, spec['sha256'])
        helpers.extract(file, runtime)
    server_file = next(runtime.rglob('llama-server'))
    server_file.chmod(0o755)
    libs = {str(file.parent) for file in runtime.rglob('*.so*') if file.is_file()}
    env = {**os.environ, 'CUDA_VISIBLE_DEVICES': '0',
        'LD_LIBRARY_PATH': ':'.join(sorted(libs)) + ':' + os.environ.get('LD_LIBRARY_PATH', ''),
        'HYDRA_BACKEND': 'llamacpp', 'HYDRA_LLAMA_URL': 'http://127.0.0.1:11435',
        'HYDRA_HOME': str(TEMP / 'hydra-home'), 'HYDRA_MODEL': 'hydra-nano:git'}
    helpers.run([sys.executable, '-m', 'pip', 'install', '--quiet', 'transformers==5.19.0',
        'numpy==2.2.6', 'sentencepiece==0.2.1', 'protobuf==4.25.8'])
    converter = TEMP / 'converter'
    if (inputs / 'converter.zip').exists():
        if helpers.digest(inputs / 'converter.zip') != plan['converterSha256']:
            raise ValueError('Converter archive changed')
        unzip(inputs / 'converter.zip', converter)
    else:
        shutil.copytree(inputs / 'converter', converter)
    # HF config/norms are already standard; do NOT apply the MLX normalization.
    base = TEMP / 'hf-base'
    base.mkdir(exist_ok=True)
    for asset in plan['nonGitAssets']:
        helpers.download(asset['url'], base / asset['path'], asset['sha256'])
    base_gguf = TEMP / 'base-Q8_0.gguf'
    with open(WORK / 'conversion.log', 'w') as output:
        helpers.run([sys.executable, str(converter / 'llama/convert_hf_to_gguf.py'), str(base),
            '--outfile', str(base_gguf), '--outtype', 'q8_0'], stdout=output, stderr=subprocess.STDOUT)
    git_gguf = TEMP / 'git-Q8_0.gguf'
    helpers.download(plan['gitGGUF']['url'], git_gguf, plan['gitGGUF']['sha256'])
    for argv in (['git', 'config', '--global', 'user.name', 'Hydra Development'],
                 ['git', 'config', '--global', 'user.email', 'hydra-dev@example.invalid'],
                 ['git', 'config', '--global', 'core.autocrlf', 'false']):
        helpers.run(argv)
    reports = {}
    receipts = []

    def evaluate(label, model, command, report_path, alias):
        server_env = {**env, 'HYDRA_MODEL': alias}
        before = [int(v) for v in subprocess.check_output(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], text=True).splitlines()]
        with open(WORK / f'{label}-server.log', 'w') as server_log:
            server = subprocess.Popen([str(server_file), '-m', str(model), '--alias', alias,
                '--host', '127.0.0.1', '--port', '11435', '-c', '32768', '-np', '4', '-ngl', 'all'],
                env=server_env, stdout=server_log, stderr=server_log)
            try:
                ready = time.monotonic() + min(120, helpers.remaining())
                while time.monotonic() < ready:
                    if server.poll() is not None:
                        raise RuntimeError(f'{label} server failed')
                    try:
                        with urllib.request.urlopen(server_env['HYDRA_LLAMA_URL'] + '/health', timeout=1) as response:
                            if response.status == 200:
                                break
                    except Exception:
                        time.sleep(0.5)
                else:
                    raise TimeoutError('GPU server readiness timeout')
                after = [int(v) for v in subprocess.check_output(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], text=True).splitlines()]
                if after[0] - before[0] < 100:
                    raise RuntimeError('Refusing CPU fallback')
                with open(WORK / f'{label}-evaluation.log', 'w') as output:
                    helpers.run([node, *command], cwd=repo, env=server_env, stdout=output, stderr=subprocess.STDOUT)
                report = json.loads(report_path.read_text())
                receipts.append({'label': label, 'modelSha256': helpers.digest(model), 'gpuBeforeMB': before,
                    'gpuAfterMB': after, 'alias': alias, 'gpuProcesses': subprocess.check_output(
                        ['nvidia-smi', '--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'], text=True)})
                return report
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()

    # Same physical checkpoint, separate prompts/head tests. Provenance links each Hub identity.
    reports['nonGit'] = evaluate('non-git', base_gguf,
        ['evals/suite/run.mjs', '--output', str(WORK / 'non-git-development.json')],
        WORK / 'non-git-development.json', 'hydra-suite-base')
    if not reports['nonGit'].get('complete') or sum(v['tasks'] for v in reports['nonGit']['byHead'].values()) != 84:
        raise ValueError('Incomplete non-Git development evaluation')
    reports['git'] = evaluate('git', git_gguf, ['evals/run_dev.mjs'],
        repo / 'evals/results/git_dev.hydra-nano-git.json', 'hydra-nano:git')
    if reports['git']['overall']['tasks'] != 200:
        raise ValueError('Incomplete Git development evaluation')
    (WORK / 'git-development.json').write_text(json.dumps(reports['git'], indent=2))
    for name, expected in plan['sourceHashes'].items():
        if helpers.digest(repo / name) != expected:
            raise ValueError(f'Source changed during evaluation: {name}')
    summary = {'complete': True, 'training': False, 'sealedEvaluation': False,
        'elapsedSeconds': time.monotonic() - START, 'plan': plan, 'runtimeReceipts': receipts,
        'byHead': {**reports['nonGit']['byHead'], 'git': reports['git']['overall']},
        'scope': reports['nonGit']['scope']}
    (WORK / 'suite-summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary['byHead'], indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        (WORK / 'suite-failure.json').write_text(json.dumps({'error': str(error),
            'elapsedSeconds': time.monotonic() - START, 'training': False, 'sealedEvaluation': False}))
        raise
