"""Private Kaggle T4 run: full-parameter fine-tune of Hydra Nano v2 on the tool-calling mix
(train/data-toolcall: decline when no offered function fits, call when one does, Hydra Git replay).
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
TEMP = Path('/tmp/hydra-toolcall')


def digest(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    inputs = next(Path('/kaggle/input').rglob('toolcall-plan.json')).parent
    plan = json.loads((inputs / 'toolcall-plan.json').read_text())
    for name, expected in plan['inputs'].items():
        if digest(inputs / name) != expected:
            raise ValueError(f'Input changed: {name}')
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'transformers==5.19.0'], check=True)
    from huggingface_hub import snapshot_download
    start = Path(snapshot_download(plan['checkpoint']['repo'], revision=plan['checkpoint']['revision'],
                                   local_dir=TEMP / 'start', allow_patterns=list(plan['checkpoint']['files'])))
    for name, expected in plan['checkpoint']['files'].items():
        if digest(start / name) != expected:
            raise ValueError(f'Starting checkpoint changed: {name}')
    manifest = TEMP / 'checkpoint-manifest.json'
    manifest.write_text(json.dumps({'source': plan['checkpoint'], 'weightsOnlyResume': True,
                                    'files': plan['checkpoint']['files']}, indent=2))
    candidate = WORK / 'candidate'
    with (WORK / 'training.log').open('w') as log:
        code = subprocess.run([sys.executable, str(inputs / 'full_finetune.py'),
            '--checkpoint', str(start), '--checkpoint-manifest', str(manifest),
            '--data', str(inputs / 'train.jsonl'), '--data-manifest', str(inputs / 'data-manifest.json'),
            '--head', plan['heads'], '--output', str(candidate), '--approved',
            '--steps', str(plan['steps']), '--max-seconds', str(plan['trainerSeconds']),
            '--max-length', str(plan['maxLength']), '--accumulation', str(plan['accumulation']),
            '--learning-rate', str(plan['learningRate']), '--initial-scale', str(plan['initialScale']),
            '--sample-seed', str(plan['sampleSeed'])],
            env={**os.environ, 'CUDA_VISIBLE_DEVICES': '0', 'HF_HUB_OFFLINE': '1'},
            stdout=log, stderr=subprocess.STDOUT).returncode
    receipt_file = candidate / 'training-receipt.json'
    receipt = json.loads(receipt_file.read_text()) if receipt_file.exists() else {}
    if code or not receipt.get('checkpointSaved') or receipt.get('trainableParameters') != receipt.get('totalParameters'):
        raise RuntimeError(f'Training did not save a complete full-parameter checkpoint (exit {code})')
    # Ship the same chat and generation files as v2 so the candidate converts and runs like it.
    for name in ('chat_template.jinja', 'generation_config.json'):
        shutil.copyfile(start / name, candidate / name)
    (WORK / 'toolcall-summary.json').write_text(json.dumps({'complete': True, 'plan': plan, 'training': receipt,
        'candidateFiles': {f.name: digest(f) for f in candidate.iterdir() if f.is_file()},
        'elapsedSeconds': time.monotonic() - START, 'published': False}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        (WORK / 'toolcall-failure.json').write_text(json.dumps({'error': str(error), 'elapsedSeconds': time.monotonic() - START}))
        raise
