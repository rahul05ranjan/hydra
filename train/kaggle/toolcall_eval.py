"""Private Kaggle 2x T4 evaluation of the tool-calling candidate against Hydra Nano v2, side by side
under identical conditions: GPU 0 serves the candidate and GPU 1 serves v2, both as Q8_0 GGUFs on the
pinned CUDA llama.cpp runtime, with the same frozen Hydra code.

  1. Hydra development gates for both: Git original/extended/paraphrase, Files/Read/Test/OS development,
     Test/OS extended, Test dev2.
  2. Only if the candidate is within the plan's tolerance of v2 on every development gate: holdouts
     (Files, Read, OS holdout; Test holdout 2) and sealed git1 for both. Only aggregate scores leave the
     worker; task rows are deleted before anything is written to /kaggle/working.
  3. BFCL v4 non-live, live and multi-turn for both (evals/public/bfcl_qwen35.py).
  4. lm-evaluation-harness on the candidate (MMLU, ARC-Challenge, HellaSwag; GSM8K, IFEval), FP16,
     the same settings as the published v2 numbers.
No training, no publication. Results go to /kaggle/working/toolcall-eval.json.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile

START = time.monotonic()
WORK = Path('/kaggle/working')
TEMP = Path('/tmp/hydra-toolcall-eval')
SUMMARY = {'complete': False, 'results': {}, 'gates': {}, 'events': []}
LOCK = threading.Lock()


def digest(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save():
    with LOCK:
        (WORK / 'toolcall-eval.json').write_text(json.dumps(SUMMARY, indent=2))


def event(message):
    line = f'[{time.monotonic() - START:7.0f}s] {message}'
    print(line, flush=True)
    with LOCK:
        SUMMARY['events'].append(line)
    save()


def run(argv, log, **kwargs):
    with open(log, 'w') as stream:
        return subprocess.run(argv, stdout=stream, stderr=subprocess.STDOUT, **kwargs).returncode


def restore(inputs, name, target):
    """Kaggle unpacks an uploaded x.zip into a folder x/; take whichever form is mounted. A zip named
    x.bin is left alone (Kaggle never finished unpacking the 5,670-file quality sources)."""
    for archive in (inputs / f'{name}.zip', inputs / f'{name}.bin'):
        if archive.exists():
            with zipfile.ZipFile(archive) as z:
                z.extractall(target)
            return
    shutil.copytree(inputs / name, target)


def tree_digest(root):
    files = {p.relative_to(root).as_posix(): digest(p) for p in sorted(root.rglob('*')) if p.is_file()}
    return hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()


def main():
    inputs = next(Path('/kaggle/input').rglob('toolcall-eval-plan.json')).parent
    plan = json.loads((inputs / 'toolcall-eval-plan.json').read_text())
    SUMMARY['plan'] = plan
    for name, expected in plan['inputs'].items():
        if (inputs / name).exists() and digest(inputs / name) != expected:
            raise ValueError(f'Input changed: {name}')
    TEMP.mkdir(parents=True, exist_ok=True)

    # Two identical copies of the frozen Hydra code, one per model, so concurrent runs never share files.
    repos = {}
    for label in ('candidate', 'v2'):
        repo = TEMP / f'repo-{label}'
        restore(inputs, 'frozen', repo)
        for name, expected in plan['sourceHashes'].items():
            if digest(repo / name) != expected:
                raise ValueError(f'Source changed: {name}')
        repos[label] = repo
    converter = TEMP / 'converter'
    restore(inputs, 'converter', converter)
    for name, expected in plan['converterFiles'].items():
        if digest(converter / name) != expected:
            raise ValueError(f'Converter source changed: {name}')
    sources = TEMP / 'quality-sources'
    restore(inputs, 'quality-sources', sources)
    if tree_digest(sources) != plan['qualitySourcesTree']:
        raise ValueError('Quality sources changed')

    pip = [sys.executable, '-m', 'pip', 'install', '-q']
    for packages in (['bfcl-eval==2026.3.23', 'soundfile'],
                     ['lm-eval[api,ifeval,math]==0.4.13', 'langdetect', 'immutabledict', 'accelerate'],
                     ['transformers==5.19.0', 'numpy==2.2.6', 'sentencepiece==0.2.1', 'protobuf==4.25.8']):
        if run(pip + packages, WORK / 'pip.log'):
            raise RuntimeError(f'pip install failed: {packages}')
    fla = run(pip + ['flash-linear-attention'], WORK / 'pip-fla.log') == 0
    event(f'packages installed; flash-linear-attention: {fla}')

    sys.path.insert(0, str(repos['candidate'] / 'train/kaggle'))
    import kernel as helpers
    helpers.START, helpers.LIMIT = START, plan['deadlineSeconds']
    manifest = json.loads((repos['candidate'] / 'skills/hydra/scripts/runtime-manifest.json').read_text())
    node = shutil.which('node')
    if not node or int(subprocess.check_output([node, '--version'], text=True).lstrip('v').split('.')[0]) < 18:
        spec = manifest['nodeArtifact']
        helpers.download(spec['url'], TEMP / 'node.tar.xz', spec['sha256'])
        helpers.extract(TEMP / 'node.tar.xz', TEMP / 'node')
        node = str(next((TEMP / 'node').rglob('bin/node')))
    runtime = TEMP / 'runtime'
    runtime.mkdir()
    for index, spec in enumerate(manifest['llama']['gpuArtifacts']):
        helpers.download(spec['url'], TEMP / f'runtime-{index}.tar.gz', spec['sha256'])
        helpers.extract(TEMP / f'runtime-{index}.tar.gz', runtime)
    server = next(runtime.rglob('llama-server'))
    server.chmod(0o755)
    libraries = ':'.join(sorted({str(p.parent) for p in runtime.rglob('*.so*')}))
    for args in (['user.name', 'Hydra Evaluation'], ['user.email', 'hydra-eval@example.invalid'], ['core.autocrlf', 'false']):
        subprocess.run(['git', 'config', '--global', *args], check=True)

    candidate = next(p.parent for p in Path('/kaggle/input').rglob('model.safetensors')
                     if digest(p) == plan['candidateFiles']['model.safetensors'])
    for name, expected in plan['candidateFiles'].items():
        if digest(candidate / name) != expected:
            raise ValueError(f'Candidate file changed: {name}')
    models = {'candidate': TEMP / 'candidate-Q8_0.gguf', 'v2': TEMP / 'v2-Q8_0.gguf'}
    if run([sys.executable, str(converter / 'llama/convert_hf_to_gguf.py'), str(candidate), '--outfile',
            str(models['candidate']), '--outtype', 'q8_0'], WORK / 'candidate-conversion.log'):
        raise RuntimeError('Candidate conversion failed')
    helpers.download(manifest['model']['url'], models['v2'], manifest['model']['sha256'])
    SUMMARY['models'] = {label: digest(path) for label, path in models.items()}
    event(f'models ready: {SUMMARY["models"]}')

    ports = {'candidate': 11501, 'v2': 11502}
    gpus = {'candidate': '0', 'v2': '1'}
    envs = {label: {**os.environ, 'LD_LIBRARY_PATH': libraries + ':' + os.environ.get('LD_LIBRARY_PATH', ''),
                    'HYDRA_HOME': str(TEMP / f'home-{label}'), 'HYDRA_BACKEND': 'llamacpp',
                    'HYDRA_LLAMA_URL': f'http://127.0.0.1:{ports[label]}', 'HYDRA_MODEL': f'hydra-{label}',
                    'HYDRA_EVAL_SOURCE_ROOT': str(sources / 'files')} for label in models}
    servers = {}
    for label in models:
        servers[label] = subprocess.Popen([str(server), '-m', str(models[label]), '--alias', f'hydra-{label}',
            '--host', '127.0.0.1', '--port', str(ports[label]), '-c', '65536', '-np', '4', '-ngl', 'all',
            '--device', 'CUDA0', '--split-mode', 'none'],
            env={**envs[label], 'CUDA_VISIBLE_DEVICES': gpus[label]},
            stdout=open(WORK / f'{label}-server.log', 'w'), stderr=subprocess.STDOUT)
    for label in models:
        for _ in range(240):
            if servers[label].poll() is not None:
                raise RuntimeError(f'{label} server exited')
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{ports[label]}/health', timeout=1) as response:
                    if response.status == 200:
                        break
            except Exception:
                time.sleep(0.5)
        else:
            raise TimeoutError(f'{label} server not ready')
    event('both servers ready')

    def node_run(label, name, args, extra_env=None):
        log = WORK / f'{label}-{name}.log'
        code = run([node, *args], log, cwd=repos[label], env={**envs[label], **(extra_env or {})})
        if code:
            raise RuntimeError(f'{label} {name} exited {code}; see {log.name}')

    def gates(label):
        repo, out = repos[label], {}
        for dev_set, tasks in (('original', 200), ('extended', 800), ('paraphrase', 800)):
            node_run(label, f'git-{dev_set}', ['evals/run_dev.mjs'], {'HYDRA_GIT_DEV_SET': dev_set})
            suffix = '' if dev_set == 'original' else f'_{dev_set}'
            report = json.loads((repo / f'evals/results/git_dev{suffix}.hydra-{label}.json').read_text())
            assert report['overall']['tasks'] == tasks, f'incomplete git {dev_set}'
            out[f'git-{dev_set}'] = {'tasks': tasks, 'solved': round(report['overall']['solved'] * tasks)}
        for split, heads in (('development', 'files,read,test,os'), ('extended', 'test,os'), ('dev2', 'test')):
            file = TEMP / f'{label}-{split}.json'
            node_run(label, split, ['evals/suite/run.mjs', '--heads', heads, '--split', split, '--output', str(file)])
            report = json.loads(file.read_text())
            for head, summary in report['byHead'].items():
                out[f'{head}-{split}'] = {'tasks': summary['tasks'], 'solved': summary['solvedCount']}
            shutil.copyfile(file, WORK / f'{label}-{split}.json')
        with LOCK:
            SUMMARY['results'].setdefault(label, {})['gates'] = out
        event(f'{label} gates: {json.dumps(out)}')

    def held_out(label):
        repo, out = repos[label], {}
        try:
            for split, heads in (('holdout', 'files,read,os'), ('holdout2', 'test')):
                file = TEMP / f'{label}-{split}.json'
                node_run(label, split, ['evals/suite/run.mjs', '--heads', heads, '--split', split, '--output', str(file)])
                for head, summary in json.loads(file.read_text())['byHead'].items():
                    out[f'{head}-{split}'] = {'tasks': summary['tasks'], 'solved': summary['solvedCount']}
                file.unlink()
            node_run(label, 'git1', ['evals/run.mjs'])
            report = repo / f'evals/results/git1.hydra-{label}.json'
            overall = json.loads(report.read_text())['overall']
            report.unlink()  # sealed task rows never leave the worker
            out['git1-sealed'] = {'tasks': overall['tasks'], 'solved': round(overall['solved'] * overall['tasks']),
                                  'weighted': overall.get('solvedWeighted')}
        finally:
            for name in ('holdout', 'holdout2', 'git1'):
                (WORK / f'{label}-{name}.log').unlink(missing_ok=True)  # logs could carry held-out task text
        with LOCK:
            SUMMARY['results'][label]['heldOut'] = out
        event(f'{label} held-out: {json.dumps(out)}')

    def bfcl(label):
        root = TEMP / f'bfcl-{label}'
        env = {**envs[label], 'BFCL_PROJECT_ROOT': str(root), 'LOCAL_SERVER_PORT': str(ports[label])}
        script = repos[label] / 'evals/public/bfcl_qwen35.py'
        # One registry entry serves both: the tokenizer and chat template are identical, and each label
        # has its own server and result directory.
        name = 'hydra-nano-v2-FC'
        for step in (['generate', '--local-model-path', str(candidate), '--skip-server-setup', '--num-threads', '4'], ['evaluate']):
            code = run([sys.executable, str(script), step[0], '--model', name, '--test-category', 'non_live,live,multi_turn', *step[1:]],
                       WORK / f'{label}-bfcl-{step[0]}.log', env=env)
            if code:
                raise RuntimeError(f'{label} BFCL {step[0]} exited {code}')
        import csv
        scores = {}
        for file in ('data_non_live.csv', 'data_live.csv', 'data_multi_turn.csv'):
            rows = list(csv.reader(open(root / 'score' / file)))
            scores[file[5:-4]] = dict(zip(rows[0], rows[1]))
        with LOCK:
            SUMMARY['results'][label]['bfcl'] = scores
        event(f'{label} BFCL done')

    def both(task):
        errors = []

        def wrap(label):
            try:
                task(label)
            except Exception as error:
                errors.append(f'{label}: {error}')
        threads = [threading.Thread(target=wrap, args=(label,)) for label in models]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        if errors:
            raise RuntimeError('; '.join(errors))

    both(gates)
    tolerance = plan['gateTolerance']
    verdict = {}
    for key, v2 in SUMMARY['results']['v2']['gates'].items():
        c = SUMMARY['results']['candidate']['gates'][key]
        allowed = max(1, math.ceil(tolerance * v2['tasks']))
        verdict[key] = {'candidate': c['solved'], 'v2': v2['solved'], 'tasks': v2['tasks'], 'pass': c['solved'] >= v2['solved'] - allowed}
    SUMMARY['gates'] = {'tolerance': tolerance, 'byGate': verdict, 'pass': all(v['pass'] for v in verdict.values())}
    event(f'development gates pass: {SUMMARY["gates"]["pass"]}')
    if SUMMARY['gates']['pass']:
        both(held_out)
    both(bfcl)
    for process in servers.values():
        process.terminate()
    for process in servers.values():
        process.wait(timeout=30)

    # lm-eval on the candidate's HF weights: log-likelihood on GPU 0 and generative on GPU 1, as for v2.
    def lm_eval(gpu, name, tasks, extra, model_extra='', batch='32'):
        out = TEMP / f'lm-{name}'
        code = run([sys.executable, '-m', 'lm_eval', '--model', 'hf', '--model_args',
                    f'pretrained={candidate},dtype=float16{model_extra}', '--device', 'cuda', '--batch_size', batch,
                    '--tasks', tasks, '--seed', '1234', '--output_path', str(out), *extra],
                   WORK / f'lm-{name}.log', env={**os.environ, 'CUDA_VISIBLE_DEVICES': gpu})
        files = sorted(out.rglob('results_*.json'))
        with LOCK:
            SUMMARY['results']['candidate'].setdefault('lmEval', {})[name] = {
                'exit': code, 'results': json.loads(files[-1].read_text())['results'] if files else None}
        event(f'lm-eval {name}: exit {code}')

    threads = [threading.Thread(target=lm_eval, args=('0', 'll', 'mmlu,arc_challenge,hellaswag', ['--num_fewshot', '0'], '', 'auto:4')),
               threading.Thread(target=lm_eval, args=('1', 'gen', 'gsm8k,ifeval',
                                ['--apply_chat_template', '--fewshot_as_multiturn'], ',enable_thinking=False'))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    for label, repo in repos.items():
        for name, expected in plan['sourceHashes'].items():
            if digest(repo / name) != expected:
                raise ValueError(f'Source changed during evaluation: {label} {name}')
    SUMMARY.update(complete=True, elapsedSeconds=round(time.monotonic() - START), published=False)
    save()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        SUMMARY['error'] = str(error)
        SUMMARY['elapsedSeconds'] = round(time.monotonic() - START)
        save()
        raise
