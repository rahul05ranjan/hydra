"""Bounded balanced full-parameter Git training followed by development scoring."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import zipfile

START = time.monotonic()
WORK = Path('/kaggle/working')
TEMP = Path('/tmp/hydra-balanced-training')


def main():
    inputs = next(Path('/kaggle/input').rglob('quality-plan.json')).parent
    plan = json.loads((inputs / 'quality-plan.json').read_text())
    if not plan['training'] or plan['sealedEvaluation'] or not 1200 <= plan['deadlineSeconds'] <= 1800:
        raise ValueError('Expected bounded training/development-only package')
    TEMP.mkdir(parents=True, exist_ok=True)
    source = TEMP / 'source'
    if (inputs / 'frozen.zip').exists():
        if hashlib.sha256((inputs / 'frozen.zip').read_bytes()).hexdigest() != plan['frozenSha256']:
            raise ValueError('Source archive changed')
        with zipfile.ZipFile(inputs / 'frozen.zip') as archive: archive.extractall(source)
    else:
        shutil.copytree(inputs / 'frozen', source)
    for name, expected in plan['sourceHashes'].items():
        if name.startswith('evals/git1/') or hashlib.sha256((source / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Unexpected/changed source: {name}')
    for name, expected in plan['trainingFiles'].items():
        if hashlib.sha256((inputs / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Training asset changed: {name}')
    sys.path.insert(0, str(source / 'train/kaggle'))
    import kernel as helpers
    helpers.START, helpers.LIMIT = START, plan['deadlineSeconds'] - 20
    spec = json.loads((inputs / 'checkpoint-manifest.json').read_text())
    checkpoint = next((file.parent for file in Path('/kaggle/input').rglob('model.safetensors')
                       if helpers.digest(file) == spec['files']['model.safetensors']), None)
    if checkpoint is None:
        old_inputs = next(Path('/kaggle/input').rglob('plan.json')).parent
        if helpers.digest(old_inputs / 'checkpoint.zip') != plan['checkpointArchiveSha256']:
            raise ValueError('Starting checkpoint archive changed')
        checkpoint = TEMP / 'starting-checkpoint'
        with zipfile.ZipFile(old_inputs / 'checkpoint.zip') as archive: archive.extractall(checkpoint)
    for name, expected in spec['files'].items():
        if helpers.digest(checkpoint / name) != expected:
            raise ValueError(f'Starting checkpoint changed: {name}')
    helpers.run([sys.executable, '-m', 'pip', 'install', '--quiet', 'transformers==5.19.0'])
    candidate = WORK / 'candidate'
    with (WORK / 'balanced-training.log').open('w') as log:
        helpers.run([sys.executable, str(source / 'train/full_finetune.py'),
            '--checkpoint', str(checkpoint), '--checkpoint-manifest', str(inputs / 'checkpoint-manifest.json'),
            '--data', str(inputs / 'train.jsonl'), '--data-manifest', str(inputs / 'data-manifest.json'),
            '--head', 'git', '--output', str(candidate), '--approved', '--steps', str(plan['steps']),
            '--max-seconds', str(plan['trainerSeconds']), '--accumulation', str(plan['accumulation']),
            '--learning-rate', str(plan['learningRate']), '--initial-scale', str(plan['initialScale']),
            '--sample-seed', str(plan.get('sampleSeed', 1729))],
            env={**os.environ, 'CUDA_VISIBLE_DEVICES': '0', 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'},
            stdout=log, stderr=subprocess.STDOUT)
    receipt = json.loads((candidate / 'training-receipt.json').read_text())
    if not receipt.get('checkpointSaved') or not receipt['completedSteps'] or receipt['trainableParameters'] != receipt['totalParameters']:
        raise ValueError('No complete full-parameter checkpoint')
    (WORK / 'balanced-training-receipt.json').write_text(json.dumps(receipt, indent=2))
    evaluation_inputs = TEMP / 'evaluation-inputs'; evaluation_inputs.mkdir()
    for name in ('frozen.zip', 'converter.zip'):
        if (inputs / name).exists(): shutil.copyfile(inputs / name, evaluation_inputs / name)
        else: shutil.copytree(inputs / Path(name).stem, evaluation_inputs / Path(name).stem)
    assets = ('model.safetensors', 'config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja')
    evaluation_plan = {**plan, 'training': False, 'includeBaseline': False, 'includeSuite': False, 'includeSealed': False,
        'checkpointFiles': {name: helpers.digest(candidate / name) for name in assets}}
    if evaluation_plan['checkpointFiles']['model.safetensors'] != receipt['weights']['model.safetensors']:
        raise ValueError('Saved weights differ from training receipt')
    (evaluation_inputs / 'eval-plan.json').write_text(json.dumps(evaluation_plan, indent=2))
    (WORK / 'runtime-eval-plan.json').write_text(json.dumps(evaluation_plan, indent=2))
    import candidate_eval
    candidate_eval.START = START
    candidate_eval.main(evaluation_inputs, candidate)
    scoring = json.loads((WORK / 'candidate-summary.json').read_text())
    (WORK / 'balanced-summary.json').write_text(json.dumps({'complete': True, 'plan': plan,
        'training': receipt, 'scoring': scoring, 'elapsedSeconds': time.monotonic() - START,
        'sealedEvaluation': False, 'published': False, 'defaultChanged': False}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        (WORK / 'balanced-failure.json').write_text(json.dumps({'error': str(error), 'elapsedSeconds': time.monotonic() - START}))
        raise
