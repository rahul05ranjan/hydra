from pathlib import Path as _P
import hashlib as _H
if _H.sha256(next(_P('/kaggle/input').rglob('eval-plan.json')).read_bytes()).hexdigest() != '7e0d0ba02e27589ade44989b38c6394b0d081200152ed7dc5930f8bb49032c87':
    raise ValueError('Evaluation input plan changed')

"""Hash-frozen candidate scoring; sealed reports expose aggregate results only."""
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

START = time.monotonic()
WORK = Path('/kaggle/working')
TEMP = Path('/tmp/hydra-candidate-eval')


def main():
    inputs = next(Path('/kaggle/input').rglob('eval-plan.json')).parent
    plan = json.loads((inputs / 'eval-plan.json').read_text())
    if plan['training'] or not 180 <= plan['deadlineSeconds'] <= 1200:
        raise ValueError('Expected bounded evaluation-only plan')
    TEMP.mkdir(parents=True, exist_ok=True)
    repo = TEMP / 'source'
    if (inputs / 'frozen.zip').exists():
        if hashlib.sha256((inputs / 'frozen.zip').read_bytes()).hexdigest() != plan['frozenSha256']:
            raise ValueError('Source archive changed')
        with zipfile.ZipFile(inputs / 'frozen.zip') as archive:
            archive.extractall(repo)
    else:
        shutil.copytree(inputs / 'frozen', repo)
    for name, expected in plan['sourceHashes'].items():
        if hashlib.sha256((repo / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Source changed: {name}')
    sys.path.insert(0, str(repo / 'train/kaggle'))
    import kernel as helpers
    helpers.START, helpers.LIMIT = START, plan['deadlineSeconds'] - 20
    checkpoint = next(p.parent for p in Path('/kaggle/input').rglob('model.safetensors')
                      if helpers.digest(p) == plan['checkpointFiles']['model.safetensors'])
    for name, expected in plan['checkpointFiles'].items():
        if helpers.digest(checkpoint / name) != expected:
            raise ValueError(f'Candidate asset changed: {name}')
    converter = TEMP / 'converter'
    if (inputs / 'converter.zip').exists():
        if helpers.digest(inputs / 'converter.zip') != plan['converterSha256']:
            raise ValueError('Converter archive changed')
        with zipfile.ZipFile(inputs / 'converter.zip') as archive:
            archive.extractall(converter)
    else:
        shutil.copytree(inputs / 'converter', converter)
    for name, expected in plan['converterFiles'].items():
        if helpers.digest(converter / name) != expected:
            raise ValueError(f'Converter source changed: {name}')
    helpers.run([sys.executable, '-m', 'pip', 'install', '--quiet',
                 'transformers==5.19.0', 'numpy==2.2.6', 'sentencepiece==0.2.1', 'protobuf==4.25.8'])
    manifest = json.loads((repo / 'skills/hydra/scripts/runtime-manifest.json').read_text())
    node = shutil.which('node')
    if not node or int(subprocess.check_output([node, '--version'], text=True).lstrip('v').split('.')[0]) < 18:
        spec = manifest['nodeArtifact']; file = TEMP / 'node.tar.xz'
        helpers.download(spec['url'], file, spec['sha256']); helpers.extract(file, TEMP / 'node')
        node = str(next((TEMP / 'node').rglob('bin/node')))
    runtime = TEMP / 'runtime'; runtime.mkdir()
    for index, spec in enumerate(manifest['llama']['gpuArtifacts']):
        file = TEMP / f'runtime-{index}.tar.gz'
        helpers.download(spec['url'], file, spec['sha256']); helpers.extract(file, runtime)
    server_file = next(runtime.rglob('llama-server')); server_file.chmod(0o755)
    env = {**os.environ, 'CUDA_VISIBLE_DEVICES': '0',
           'LD_LIBRARY_PATH': ':'.join(sorted({str(p.parent) for p in runtime.rglob('*.so*')})) + ':' + os.environ.get('LD_LIBRARY_PATH', ''),
           'HYDRA_HOME': str(TEMP / 'home'), 'HYDRA_BACKEND': 'llamacpp',
           'HYDRA_LLAMA_URL': 'http://127.0.0.1:11435', 'HYDRA_MODEL': 'hydra-nano:git'}
    for args in (['user.name', 'Hydra Evaluation'], ['user.email', 'hydra-eval@example.invalid'], ['core.autocrlf', 'false']):
        helpers.run(['git', 'config', '--global', *args])
    models = {}
    for label, dtype in [('candidate-f16', 'f16'), ('candidate-q8', 'q8_0')]:
        model = TEMP / f'{label}.gguf'
        with (WORK / f'{label}-conversion.log').open('w') as log:
            helpers.run([sys.executable, str(converter / 'llama/convert_hf_to_gguf.py'),
                         str(checkpoint), '--outfile', str(model), '--outtype', dtype], stdout=log, stderr=subprocess.STDOUT)
        models[label] = model
    models['baseline-q8'] = TEMP / 'baseline.gguf'
    helpers.download(manifest['model']['url'], models['baseline-q8'], manifest['model']['sha256'])
    results, gpu = {}, {}
    with (WORK / 'gpu-devices.log').open('w') as log:
        helpers.run([str(server_file), '--list-devices'], env=env, stdout=log, stderr=subprocess.STDOUT)

    def memory():
        return [int(v) for v in subprocess.check_output(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], text=True).splitlines()]

    def evaluate(label, model, phases):
        before = memory()
        with (WORK / f'{label}-server.log').open('w') as log:
            server = subprocess.Popen([str(server_file), '-m', str(model), '--alias', 'hydra-nano:git',
                '--host', '127.0.0.1', '--port', '11435', '-c', '32768', '-np', '4', '-ngl', 'all',
                '--device', 'CUDA0', '--split-mode', 'none'], env=env, stdout=log, stderr=log)
            try:
                ready_until = time.monotonic() + min(120, helpers.remaining())
                while time.monotonic() < ready_until:
                    if server.poll() is not None: raise RuntimeError(f'{label} GPU server failed')
                    try:
                        with urllib.request.urlopen(env['HYDRA_LLAMA_URL'] + '/health', timeout=1) as response:
                            if response.status == 200: break
                    except Exception: time.sleep(0.5)
                else: raise TimeoutError('GPU server readiness timeout')
                after = memory()
                for _ in range(10):
                    if sum(after) - sum(before) >= 100: break
                    time.sleep(0.5); after = memory()
                process_evidence = subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid,gpu_uuid,used_memory', '--format=csv,noheader,nounits'], text=True)
                gpu[label] = {'beforeMB': before, 'afterMB': after, 'device': 'CUDA0',
                              'splitMode': 'none', 'processEvidence': process_evidence, 'modelSha256': helpers.digest(model)}
                (WORK / 'gpu-evidence.json').write_text(json.dumps(gpu, indent=2))
                if sum(after) - sum(before) < 100: raise RuntimeError('Refusing CPU fallback score')
                for phase, command, source_path, expected in phases:
                    with (WORK / f'{label}-{phase}.log').open('w') as log:
                        helpers.run([node, *command], cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
                    report = json.loads((repo / source_path).read_text())
                    if phase == 'suite':
                        if not report['complete'] or len(report['rows']) != expected: raise ValueError('Incomplete suite')
                        result = {'byHead': report['byHead'], 'scope': report['scope']}
                    else:
                        if report['overall']['tasks'] != expected: raise ValueError('Incomplete Git evaluation')
                        result = report['overall']
                    # Sealed task/failure rows never leave the temporary worker repo.
                    if phase != 'sealed':
                        (WORK / f'{label}-{phase}.json').write_text(json.dumps(report, indent=1))
                    results[f'{label}-{phase}'] = result
                    (WORK / 'candidate-summary.json').write_text(json.dumps({'complete': False, 'results': results, 'gpu': gpu}, indent=2))
                    print(label, phase, json.dumps(result), flush=True)
            finally:
                server.terminate()
                try: server.wait(timeout=10)
                except subprocess.TimeoutExpired: server.kill(); server.wait()

    development = ('development', ['evals/run_dev.mjs'], 'evals/results/git_dev.hydra-nano-git.json', 200)
    evaluate('baseline-q8', models['baseline-q8'], [development])
    evaluate('candidate-f16', models['candidate-f16'], [development])
    evaluate('candidate-q8', models['candidate-q8'], [development,
        ('suite', ['evals/suite/run.mjs', '--output', 'evals/results/candidate-suite.json'], 'evals/results/candidate-suite.json', 84),
        ('sealed', ['evals/run.mjs'], 'evals/results/git1.hydra-nano-git.json', 1000)])
    for name, expected in plan['sourceHashes'].items():
        if helpers.digest(repo / name) != expected: raise ValueError(f'Source changed during evaluation: {name}')
    (WORK / 'candidate-summary.json').write_text(json.dumps({'complete': True, 'plan': plan,
        'elapsedSeconds': time.monotonic() - START, 'results': results, 'gpu': gpu,
        'published': False, 'defaultChanged': False}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        (WORK / 'candidate-failure.json').write_text(json.dumps({'error': str(error), 'elapsedSeconds': time.monotonic() - START}))
        raise
