"""Freeze and control the bounded broad Git development-only training experiment."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
STAGE = Path.home() / '.hydra/kaggle-broad-git'
RESULT = ROOT / 'evals/results/suite/broad-git'
KERNEL = 'rahulswt7/hydra-broad-git-quality'
DATASET = KERNEL + '-input'


def digest(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def prepare():
    dataset, kernel = STAGE / 'dataset', STAGE / 'kernel'
    dataset.mkdir(parents=True, exist_ok=True); kernel.mkdir(parents=True, exist_ok=True)
    previous = json.loads((ROOT / 'evals/results/suite/balanced-refinement/quality-plan.json').read_text())
    names = set(previous['sourceHashes']) | {
        'evals/git_dev/extended/phrasings.json', 'evals/git_dev/extended/tasks.jsonl',
        'evals/git_dev/extended/worlds.json'}
    if any(name.startswith('evals/git1/') or not (ROOT / name).is_file() for name in names):
        raise ValueError('Missing or disallowed source')
    hashes = {name: digest(ROOT / name) for name in sorted(names)}
    with zipfile.ZipFile(dataset / 'frozen.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(names): archive.write(ROOT / name, name)
    base = ROOT / 'evals/results/suite/final-git-validation/candidate-summary.json'
    final = json.loads(base.read_text())
    if not final['complete']: raise ValueError('Starting checkpoint has no completed validation receipt')
    checkpoint = {'sourceModel': 'private refined Git checkpoint',
        'sourceRevision': 'kaggle:rahulswt7/hydra-balanced-git-refinement/1',
        'weightsOnlyResume': True, 'optimizerStateResumed': False,
        'files': final['plan']['checkpointFiles']}
    save(dataset / 'checkpoint-manifest.json', checkpoint)
    shutil.copyfile(ROOT / 'train/data-balanced-git/train.jsonl', dataset / 'train.jsonl')
    shutil.copyfile(ROOT / 'train/data-balanced-git/manifest.json', dataset / 'data-manifest.json')
    data = json.loads((dataset / 'data-manifest.json').read_text())
    if data['sealedInputsUsed'] or data['developmentInputsUsed'] or data['dataSha256'] != digest(dataset / 'train.jsonl'):
        raise ValueError('Unverified or contaminated training data')
    shutil.copyfile(Path.home() / '.hydra/kaggle-balanced-refinement/dataset/converter.zip', dataset / 'converter.zip')
    plan = {**previous, 'deadlineSeconds': 1800, 'trainerSeconds': 1050, 'steps': 120,
        'learningRate': 1e-6, 'sampleSeed': 20261014, 'examples': data['samplesByHead']['git'],
        'startingCheckpoint': checkpoint['sourceRevision'], 'sourceHashes': hashes,
        'frozenSha256': digest(dataset / 'frozen.zip'),
        'trainingFiles': {name: digest(dataset / name) for name in ('train.jsonl', 'data-manifest.json', 'checkpoint-manifest.json')},
        'includeExtendedDevelopment': True, 'comparisonCheckpointFiles': checkpoint['files'],
        'converterSha256': digest(dataset / 'converter.zip'), 'includeF16': True,
        'scope': 'Independent synthetic broad Git training; original 200 and extended 800 development tasks, comparison checkpoint Q8 and new F16/Q8. No sealed inputs/scoring.'}
    save(dataset / 'quality-plan.json', plan)
    plan_hash = digest(dataset / 'quality-plan.json')
    prefix = ("from pathlib import Path as _P\nimport hashlib as _H\n"
        "_f = next(_P('/kaggle/input').rglob('quality-plan.json'))\n"
        f"if _H.sha256(_f.read_bytes()).hexdigest() != '{plan_hash}':\n"
        "    raise ValueError('Mounted broad training plan differs from frozen input')\n\n")
    (kernel / 'balanced_train.py').write_text(prefix + (ROOT / 'train/kaggle/balanced_train.py').read_text(), encoding='utf-8')
    save(dataset / 'dataset-metadata.json', {'id': DATASET, 'title': 'Hydra broad Git quality input',
        'licenses': [{'name': 'apache-2.0'}], 'description': plan['scope']})
    save(kernel / 'kernel-metadata.json', {'id': KERNEL, 'title': 'Hydra broad Git quality',
        'code_file': 'balanced_train.py', 'language': 'python', 'kernel_type': 'script',
        'is_private': True, 'enable_gpu': True, 'enable_internet': True,
        'dataset_sources': [DATASET], 'kernel_sources': ['rahulswt7/hydra-balanced-git-refinement/1'], 'competition_sources': []})
    receipt = {'prepared': True, 'submitted': False, 'planSha256': plan_hash,
        'kernelSha256': digest(kernel / 'balanced_train.py'), 'plan': plan,
        'inputBytes': sum(f.stat().st_size for f in dataset.iterdir() if f.is_file() and f.name != 'dataset-metadata.json')}
    save(RESULT / 'prepared.json', receipt)
    save(RESULT / 'quality-plan.json', plan)
    shutil.copyfile(dataset / 'checkpoint-manifest.json', RESULT / 'checkpoint-manifest.json')
    shutil.copyfile(kernel / 'balanced_train.py', RESULT / 'submitted-kernel.py')
    print(json.dumps({key: receipt[key] for key in ('prepared', 'submitted', 'planSha256', 'inputBytes')}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'upload', 'update-input', 'run', 'status', 'output'])
    parser.add_argument('--approved', action='store_true')
    args = parser.parse_args()
    if args.action == 'prepare': prepare(); return
    load_dotenv(ROOT / '.env')
    from kaggle.api.kaggle_api_extended import KaggleApi
    api = KaggleApi(); api.authenticate()
    if args.action == 'status': print(api.kernels_status(KERNEL)); return
    if args.action == 'output':
        print(api.kernels_output(KERNEL, str(RESULT), force=True, quiet=True,
            file_pattern=r'(balanced-summary\.json|balanced-training-receipt\.json|candidate-summary\.json|gpu-evidence\.json|balanced-failure\.json|candidate-failure\.json|.*-development\.json)$'))
        return
    receipt = json.loads((RESULT / 'prepared.json').read_text())
    if digest(STAGE / 'dataset/quality-plan.json') != receipt['planSha256']:
        raise ValueError('Frozen plan changed')
    for name, sha in receipt['plan']['trainingFiles'].items():
        if digest(STAGE / 'dataset' / name) != sha: raise ValueError(f'Training asset changed: {name}')
    if args.action in ('upload', 'update-input'):
        extra = ['-m', 'Verified broad development scoring for both precision variants'] if args.action == 'update-input' else []
        subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', 'datasets',
            'version' if args.action == 'update-input' else 'create', '-p', str(STAGE / 'dataset'),
            '--dir-mode', 'skip', *extra], check=True)
        return
    if not args.approved: parser.error('Requires prior concrete 30-minute single-T4 training notice and user authorization')
    preflight = json.loads((RESULT / 'preflight.json').read_text())
    if preflight['examples'] != receipt['plan']['examples'] or preflight['dataSha256'] != receipt['plan']['trainingFiles']['train.jsonl']:
        raise ValueError('Tokenizer preflight does not match frozen training data')
    qa = json.loads((ROOT / 'evals/results/suite/extended-development-gold-qa.json').read_text())
    if qa['tasks'] != 800 or qa['valid'] != 800:
        raise ValueError('Extended development gold is incomplete/unreachable')
    for name, sha in qa['hashes'].items():
        if receipt['plan']['sourceHashes']['evals/git_dev/extended/' + name] != sha:
            raise ValueError('Gold verification does not match frozen development inputs')
    if digest(STAGE / 'kernel/balanced_train.py') != receipt['kernelSha256']:
        raise ValueError('Frozen kernel changed')
    for name in ('frozen', 'converter'):
        if digest(STAGE / f'dataset/{name}.zip') != receipt['plan'][name + 'Sha256']:
            raise ValueError(f'Frozen {name} archive changed')
    status = json.loads(api.dataset_status(DATASET, format='json(status,current_version_number)'))
    if status.get('status') != 'ready': raise ValueError('Dataset not ready; no GPU job submitted')
    source = f"{DATASET}/{status['current_version_number']}"
    with tempfile.TemporaryDirectory(prefix='hydra-broad-plan-') as directory:
        api.dataset_download_file(source, 'quality-plan.json', path=directory, force=True, quiet=True)
        if digest(Path(directory) / 'quality-plan.json') != receipt['planSha256']:
            raise ValueError('Remote dataset differs from frozen plan; no GPU job submitted')
    metadata = json.loads((STAGE / 'kernel/kernel-metadata.json').read_text())
    metadata['dataset_sources'] = [source]; save(STAGE / 'kernel/kernel-metadata.json', metadata)
    subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', 'kernels', 'push', '-p', str(STAGE / 'kernel'),
        '--accelerator', 'NvidiaTeslaT4', '--timeout', '1800'], check=True)
    receipt.update(submitted=True, datasetSource=source); save(RESULT / 'prepared.json', receipt)


if __name__ == '__main__': main()
