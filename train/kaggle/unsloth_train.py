"""Private Kaggle 2x T4 run: Unsloth fine-tunes of Hydra Nano v2 on the tool-calling mix, full-parameter
on GPU 0 and LoRA on GPU 1 at the same time, with the same data, seed and batches as the
full_finetune.py toolcall run, so loss, speed and memory compare directly.
Training only: no Hydra development, holdout or sealed input, no benchmark input, no publication.
The starting checkpoint is the published v2 at a pinned revision, checked file by file."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

START = time.monotonic()
WORK = Path('/kaggle/working')
TEMP = Path('/tmp/hydra-unsloth')


def digest(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    inputs = next(Path('/kaggle/input').rglob('unsloth-plan.json')).parent
    plan = json.loads((inputs / 'unsloth-plan.json').read_text())
    for name, expected in plan['inputs'].items():
        if digest(inputs / name) != expected:
            raise ValueError(f'Input changed: {name}')
    with (WORK / 'pip.log').open('w') as log:
        subprocess.run([sys.executable, '-m', 'pip', 'install', *plan['packages']], stdout=log, stderr=subprocess.STDOUT, check=True)
    from huggingface_hub import snapshot_download
    start = Path(snapshot_download(plan['checkpoint']['repo'], revision=plan['checkpoint']['revision'],
                                   local_dir=TEMP / 'start', allow_patterns=list(plan['checkpoint']['files'])))
    for name, expected in plan['checkpoint']['files'].items():
        if digest(start / name) != expected:
            raise ValueError(f'Starting checkpoint changed: {name}')
    manifest = TEMP / 'checkpoint-manifest.json'
    manifest.write_text(json.dumps({'source': plan['checkpoint'], 'weightsOnlyResume': True,
                                    'files': plan['checkpoint']['files']}, indent=2))
    # The trainer imports full_finetune.py from its own folder.
    code = TEMP / 'code'
    code.mkdir(parents=True, exist_ok=True)
    for name in ('full_finetune.py', 'unsloth_finetune.py'):
        shutil.copyfile(inputs / name, code / name)
    import torch
    gpus = torch.cuda.device_count()
    jobs = {}
    for index, method in enumerate(plan['methods']):
        settings = plan['settings'][method]
        candidate = WORK / f'candidate-{method}'
        argv = [sys.executable, str(code / 'unsloth_finetune.py'), '--method', method,
                '--checkpoint', str(start), '--checkpoint-manifest', str(manifest),
                '--data', str(inputs / 'train.jsonl'), '--data-manifest', str(inputs / 'data-manifest.json'),
                '--head', plan['heads'], '--output', str(candidate), '--approved',
                '--steps', str(plan['steps']), '--max-seconds', str(plan['trainerSeconds']),
                '--max-length', str(plan['maxLength']), '--accumulation', str(plan['accumulation']),
                '--learning-rate', str(settings['learningRate']), '--initial-scale', str(plan['initialScale']),
                '--sample-seed', str(plan['sampleSeed'])]
        if method == 'lora':
            argv += ['--lora-rank', str(settings['rank']), '--lora-alpha', str(settings['alpha'])]
        env = {**os.environ, 'CUDA_VISIBLE_DEVICES': str(index % max(gpus, 1)), 'HF_HUB_OFFLINE': '1'}
        log = (WORK / f'training-{method}.log').open('w')
        jobs[method] = (subprocess.Popen(argv, cwd=code, env=env, stdout=log, stderr=subprocess.STDOUT), log, candidate)
        if gpus < 2:
            jobs[method][0].wait()
    results = {}
    for method, (process, log, candidate) in jobs.items():
        code_ = process.wait()
        log.close()
        receipt_file = candidate / 'training-receipt.json'
        receipt = json.loads(receipt_file.read_text()) if receipt_file.exists() else {}
        if not code_ and receipt.get('checkpointSaved'):
            # Ship the same generation file as v2 so the candidate converts and runs like it.
            shutil.copyfile(start / 'generation_config.json', candidate / 'generation_config.json')
        results[method] = {'exit': code_, 'training': receipt,
                           'candidateFiles': {f.name: digest(f) for f in candidate.iterdir() if f.is_file()} if candidate.exists() else {}}
    complete = all(r['exit'] == 0 and r['training'].get('checkpointSaved') for r in results.values())
    (WORK / 'unsloth-summary.json').write_text(json.dumps({'complete': complete, 'plan': plan, 'gpus': gpus,
        'results': results, 'elapsedSeconds': time.monotonic() - START, 'published': False}, indent=2))
    if not complete:
        raise RuntimeError('An Unsloth run did not save a checkpoint: ' + ', '.join(f'{m} exit {r["exit"]}' for m, r in results.items()))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        (WORK / 'unsloth-failure.json').write_text(json.dumps({'error': str(error), 'elapsedSeconds': time.monotonic() - START}))
        raise
