"""Frozen GGUF evaluation on Kaggle GPU. Never trains or changes prompts."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time
import urllib.request
import zipfile

WORK = Path('/kaggle/working')
START = time.monotonic()
LIMIT = 1790

def remaining():
    value = LIMIT - (time.monotonic() - START)
    if value <= 0:
        raise TimeoutError('30-minute evaluation deadline reached')
    return value

def run(argv, **kwargs):
    return subprocess.run(argv, check=True, timeout=remaining(), **kwargs)

def digest(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def download(url, dest, expected):
    with urllib.request.urlopen(url, timeout=min(60, remaining())) as response, open(dest, 'wb') as stream:
        while True:
            remaining()
            chunk = response.read(8 * 1024 * 1024)
            if not chunk:
                break
            stream.write(chunk)
    if digest(dest) != expected:
        raise ValueError('Download SHA-256 mismatch')

def extract(archive, dest):
    with tarfile.open(archive) as tar:
        # Official runtime archive, additionally checked against pinned SHA-256.
        tar.extractall(dest, filter='data')

def main():
    inputs = next(Path('/kaggle/input').rglob('plan.json')).parent
    plan = json.loads((inputs / 'plan.json').read_text())
    model = inputs / 'hydra-nano-git-Q8_0.gguf'
    if digest(model) != plan['modelSha256']:
        raise ValueError('Model changed')
    repo = WORK / 'hydra-frozen'
    if (inputs / 'frozen.zip').exists():
        if digest(inputs / 'frozen.zip') != plan['frozenSha256']:
            raise ValueError('Frozen source archive changed')
        with zipfile.ZipFile(inputs / 'frozen.zip') as archive:
            archive.extractall(repo)
    else:
        # Kaggle automatically expands uploaded ZIP resources into their stem folder.
        shutil.copytree(inputs / 'frozen', repo)
    for name, value in plan['sources'].items():
        if digest(repo / name) != value:
            raise ValueError(f'Frozen source changed: {name}')
    manifest = json.loads((repo / 'skills/hydra/scripts/runtime-manifest.json').read_text())
    node = shutil.which('node')
    major = int(subprocess.check_output([node, '--version'], text=True).strip().lstrip('v').split('.')[0]) if node else 0
    if major < 18:
        artifact = manifest['nodeArtifact']
        archive = WORK / 'node.tar.xz'
        download(artifact['url'], archive, artifact['sha256'])
        extract(archive, WORK / 'node-runtime')
        node = str(next((WORK / 'node-runtime').rglob('bin/node')))
    run(['nvidia-smi'])
    gpu_before = [int(value) for value in subprocess.check_output(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], text=True).splitlines()]
    artifacts = manifest['llama']['gpuArtifacts']
    runtime = WORK / 'llama'
    runtime.mkdir(exist_ok=True)
    for index, artifact in enumerate(artifacts):
        file = WORK / f'cuda-{index}.tar.gz'
        download(artifact['url'], file, artifact['sha256'])
        extract(file, runtime)
    server_file = next(runtime.rglob('llama-server'))
    server_file.chmod(0o755)
    library_dirs = {str(p.parent) for p in runtime.rglob('*.so*') if p.is_file()}
    env = {**os.environ, 'CUDA_VISIBLE_DEVICES': '0', 'LD_LIBRARY_PATH': ':'.join(sorted(library_dirs)) + ':' + os.environ.get('LD_LIBRARY_PATH', ''),
           'HYDRA_HOME': str(WORK / 'hydra-home'), 'HYDRA_BACKEND': 'llamacpp',
           'HYDRA_LLAMA_URL': 'http://127.0.0.1:11435', 'HYDRA_MODEL': 'hydra-nano:git'}
    run(['git', 'config', '--global', 'user.name', 'Hydra Evaluation'])
    run(['git', 'config', '--global', 'user.email', 'hydra-eval@example.invalid'])
    run(['git', 'config', '--global', 'core.autocrlf', 'false'])
    with open(WORK / 'server.log', 'w') as log:
        server = subprocess.Popen([str(server_file), '-m', str(model), '--alias', 'hydra-nano:git', '--host', '127.0.0.1',
                                   '--port', '11435', '-c', '32768', '-np', '4', '-ngl', 'all'], env=env, stdout=log, stderr=log)
        try:
            ready_until = time.monotonic() + min(120, remaining())
            while time.monotonic() < ready_until:
                if server.poll() is not None:
                    raise RuntimeError('GPU server failed; see server.log')
                try:
                    with urllib.request.urlopen(env['HYDRA_LLAMA_URL'] + '/health', timeout=1) as response:
                        if response.status == 200:
                            break
                except Exception:
                    time.sleep(0.5)
            else:
                raise TimeoutError('GPU server startup exceeded 120 seconds')
            gpu_processes = subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'], text=True)
            gpu_after = [int(value) for value in subprocess.check_output(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], text=True).splitlines()]
            if gpu_after[0] - gpu_before[0] < 100:
                raise RuntimeError('llama-server is not using GPU memory; refusing a CPU fallback score')
            with open(WORK / 'eval.log', 'w') as output:
                run([node, 'evals/run.mjs'], cwd=repo, env=env, stdout=output, stderr=subprocess.STDOUT)
            source_report = repo / 'evals/results/git1.hydra-nano-git.json'
            report = json.loads(source_report.read_text())
            if report['overall']['tasks'] != plan['tasks']:
                raise RuntimeError('Incomplete evaluation')
            for name, value in plan['sources'].items():
                if digest(repo / name) != value:
                    raise ValueError(f'Source changed during evaluation: {name}')
            report['provenance'] = {'plan': plan, 'elapsedSeconds': time.monotonic() - START, 'gpu': True,
                                    'gpuProcessEvidence': gpu_processes, 'gpuMemoryBeforeMB': gpu_before, 'gpuMemoryAfterMB': gpu_after}
            (WORK / 'git1.llamacpp-q8.kaggle.json').write_text(json.dumps(report, indent=1))
            # Summary only; sealed failure rows must not guide prompt/training changes.
            print(json.dumps(report['overall'], indent=2))
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        (WORK / 'failure.json').write_text(json.dumps({'error': str(error), 'elapsedSeconds': time.monotonic() - START}))
        raise
