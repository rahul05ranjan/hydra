"""Ten-minute full-parameter GPU feasibility job. Never evaluates sealed data or publishes."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import zipfile

WORK = Path('/kaggle/working')
START = time.monotonic()
LIMIT = 590


def remaining():
    result = LIMIT - (time.monotonic() - START)
    if result <= 0:
        raise TimeoutError('Full-training feasibility deadline reached')
    return result


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, timeout=remaining(), **kwargs)


def digest(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def main():
    global LIMIT
    inputs = next(Path('/kaggle/input').rglob('plan.json')).parent
    plan = json.loads((inputs / 'plan.json').read_text())
    if not plan['training'] or plan['sealedEvaluation'] or not 180 <= plan['deadlineSeconds'] <= 600 or plan['steps'] != 10:
        raise ValueError('Unexpected training plan')
    LIMIT = plan['deadlineSeconds'] - 10
    checkpoint = inputs / 'checkpoint'
    if (inputs / 'checkpoint.zip').exists():
        if digest(inputs / 'checkpoint.zip') != plan['checkpointArchiveSha256']:
            raise ValueError('Checkpoint archive changed')
        checkpoint = Path('/tmp/hydra-full-checkpoint')
        with zipfile.ZipFile(inputs / 'checkpoint.zip') as archive:
            archive.extractall(checkpoint)
    for name, expected in plan['files'].items():
        file = checkpoint / name.removeprefix('checkpoint/') if name.startswith('checkpoint/') else inputs / name
        if digest(file) != expected:
            raise ValueError(f'Frozen training input changed: {name}')
    run(['nvidia-smi'])
    run([sys.executable, '-m', 'pip', 'install', '--quiet', 'transformers==5.19.0'])
    env = {**os.environ, 'CUDA_VISIBLE_DEVICES': '0', 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'}
    output = WORK / 'candidate'
    # The subprocess timeout and Kaggle's 600s worker timeout enforce the hard cap.
    with open(WORK / 'full-training.log', 'w') as log:
        run([sys.executable, str(inputs / 'full_finetune.py'), '--checkpoint', str(checkpoint),
            '--checkpoint-manifest', str(inputs / 'checkpoint-manifest.json'), '--data', str(inputs / 'train.jsonl'),
            '--data-manifest', str(inputs / 'data-manifest.json'), '--head', plan['head'], '--output', str(output),
            '--approved', '--steps', str(plan['steps']), '--max-seconds', str(min(plan['trainerSeconds'], int(remaining()) - 10)),
            '--accumulation', str(plan['accumulation']), '--learning-rate', str(plan['learningRate']),
            '--max-length', str(plan['maximumLength'])], env=env, stdout=log, stderr=subprocess.STDOUT)
    receipt = json.loads((output / 'training-receipt.json').read_text())
    if not receipt.get('checkpointSaved') or receipt['trainableParameters'] != receipt['totalParameters'] or receipt['completedSteps'] < 1:
        raise ValueError('No verified full-parameter optimizer step/checkpoint')
    if receipt.get('lossMethod') != plan.get('lossMethod'):
        raise ValueError('Trainer loss method differs from the frozen plan')
    summary = {'complete': True, 'purpose': plan['purpose'], 'plan': plan,
        'receipt': receipt, 'elapsedSeconds': time.monotonic() - START,
        'sealedEvaluation': False, 'published': False, 'defaultChanged': False}
    (WORK / 'full-summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps({key: receipt[key] for key in ('completedSteps', 'trainingSeconds', 'peakMemoryBytes', 'totalParameters', 'trainableParameters')}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        (WORK / 'full-failure.json').write_text(json.dumps({'error': str(error),
            'elapsedSeconds': time.monotonic() - START, 'sealedEvaluation': False}))
        raise
