"""Freeze, upload, run and collect the Unsloth comparison (unsloth_train.py) on a private Kaggle 2x T4.
Data, seed, batches, accumulation and the full-parameter learning rate match the full_finetune.py
toolcall run, so its receipt is the baseline. Credentials come from the root .env and are never printed.
Usage: python train/kaggle/unsloth_control.py prepare|upload|run --approved|status|output|compare"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / '.env')
STAGE = Path.home() / '.hydra/kaggle-unsloth'
RESULT = Path.home() / '.hydra/build/unsloth-candidate'
BASELINE = Path.home() / '.hydra/build/toolcall-candidate/toolcall-summary.json'
USER = os.environ.get('KAGGLE_USERNAME', '')
KERNEL = f'{USER}/hydra-unsloth-training'
DATASET = KERNEL + '-input'
V2 = Path.home() / '.hydra/build/bench-models/hydra-nano-v2'
# unsloth 2026.10.6 requires transformers <= 5.17.0; the full_finetune.py baseline ran on 5.19.0.
PLAN = {'heads': 'git,toolcall', 'methods': ['full', 'lora'], 'steps': 20, 'accumulation': 8, 'initialScale': 128,
        'settings': {'full': {'learningRate': 2e-6}, 'lora': {'learningRate': 2e-4, 'rank': 16, 'alpha': 16}},
        'maxLength': 2048, 'sampleSeed': 20261017, 'trainerSeconds': 2400, 'kernelTimeoutSeconds': 5400,
        'packages': ['unsloth==2026.10.6', 'unsloth_zoo==2026.10.6', 'transformers==5.17.0'],
        'checkpoint': {'repo': 'rahul05ranjan/hydra-nano-git', 'revision': '8129125fad1c664bbb58ebd3238f6598c879eb23'}}
CODE = ('train.jsonl', 'data-manifest.json', 'full_finetune.py', 'unsloth_finetune.py')


def digest(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def kaggle(*args):
    subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', *args], check=True)


def prepare():
    dataset, kernel = STAGE / 'dataset', STAGE / 'kernel'
    for d in (dataset, kernel):
        d.mkdir(parents=True, exist_ok=True)
    data = json.loads((ROOT / 'train/data-toolcall/manifest.json').read_text())
    if data['dataSha256'] != digest(ROOT / 'train/data-toolcall/train.jsonl') or any(
            data[k] for k in ('sealedInputsUsed', 'developmentInputsUsed', 'holdoutInputsUsed', 'benchmarkInputsUsed')):
        raise ValueError('Unverified or contaminated training data')
    baseline = json.loads(BASELINE.read_text())['plan']
    if any(baseline[k] != PLAN[k] for k in ('heads', 'accumulation', 'initialScale', 'maxLength', 'sampleSeed')) \
            or baseline['learningRate'] != PLAN['settings']['full']['learningRate'] \
            or baseline['inputs']['train.jsonl'] != digest(ROOT / 'train/data-toolcall/train.jsonl'):
        raise ValueError('Plan no longer matches the full_finetune.py baseline run')
    shutil.copyfile(ROOT / 'train/data-toolcall/train.jsonl', dataset / 'train.jsonl')
    shutil.copyfile(ROOT / 'train/data-toolcall/manifest.json', dataset / 'data-manifest.json')
    for name in ('full_finetune.py', 'unsloth_finetune.py'):
        shutil.copyfile(ROOT / 'train' / name, dataset / name)
    files = ('model.safetensors', 'config.json', 'tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja', 'generation_config.json')
    plan = {**PLAN, 'checkpoint': {**PLAN['checkpoint'], 'files': {name: digest(V2 / name) for name in files}},
            'inputs': {name: digest(dataset / name) for name in CODE},
            'examples': data['examples'], 'scope': 'Unsloth full-parameter and LoRA fine-tunes of Hydra Nano v2 on the '
            'tool-calling mix, compared with the full_finetune.py run on the same batches. Training only.'}
    if plan['checkpoint']['files'] != baseline['checkpoint']['files']:
        raise ValueError('Local v2 copy is not the checkpoint the baseline started from')
    (dataset / 'unsloth-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    plan_hash = digest(dataset / 'unsloth-plan.json')
    guard = ("from pathlib import Path as _P\nimport hashlib as _H\n"
             "_f = next(_P('/kaggle/input').rglob('unsloth-plan.json'))\n"
             f"if _H.sha256(_f.read_bytes()).hexdigest() != '{plan_hash}':\n"
             "    raise ValueError('Mounted plan differs from the frozen plan')\n\n")
    (kernel / 'unsloth_train.py').write_text(guard + (ROOT / 'train/kaggle/unsloth_train.py').read_text())
    (dataset / 'dataset-metadata.json').write_text(json.dumps({'id': DATASET, 'title': 'Hydra Unsloth training input',
        'licenses': [{'name': 'CC-BY-4.0'}], 'description': plan['scope']}, indent=2))
    (kernel / 'kernel-metadata.json').write_text(json.dumps({'id': KERNEL, 'title': 'Hydra Unsloth training',
        'code_file': 'unsloth_train.py', 'language': 'python', 'kernel_type': 'script', 'is_private': True,
        'enable_gpu': True, 'enable_internet': True, 'dataset_sources': [DATASET], 'competition_sources': [],
        'kernel_sources': []}, indent=2))
    RESULT.mkdir(parents=True, exist_ok=True)
    (RESULT / 'prepared.json').write_text(json.dumps({'planSha256': plan_hash, 'plan': plan,
        'kernelSha256': digest(kernel / 'unsloth_train.py')}, indent=2) + '\n')
    print(json.dumps({'planSha256': plan_hash, 'examples': plan['examples'], 'inputs': plan['inputs']}, indent=1))


def compare():
    """Side by side with the baseline over the steps both ran; the first batch is the same for all."""
    base = json.loads(BASELINE.read_text())['training']
    runs = json.loads((RESULT / 'unsloth-summary.json').read_text())['results']
    rows = {'full_finetune.py': base, **{f'unsloth-{m}': r['training'] for m, r in runs.items()}}
    steps = min(len(r.get('losses') or []) for r in rows.values())
    for name, r in rows.items():
        losses = r.get('losses') or []
        per_step = r['trainingSeconds'] / r['completedSteps'] if r.get('completedSteps') else None
        print(json.dumps({'run': name, 'firstLoss': losses[0] if losses else None,
            f'meanLoss{steps}': sum(losses[:steps]) / steps if steps else None,
            'secondsPerStep': per_step, 'peakGiB': (r.get('peakMemoryBytes') or 0) / 2**30,
            'trainable': r.get('trainableParameters'), 'error': r.get('error')}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'upload', 'run', 'status', 'output', 'compare'])
    parser.add_argument('--approved', action='store_true', help='Only after a concrete runtime notice and a clear yes')
    args = parser.parse_args()
    if args.action == 'prepare':
        return prepare()
    if args.action == 'compare':
        return compare()
    if args.action == 'status':
        return kaggle('kernels', 'status', KERNEL)
    if args.action == 'output':
        # Receipts and logs only; the candidate weights stay on Kaggle for an evaluation kernel to attach.
        return kaggle('kernels', 'output', KERNEL, '-p', str(RESULT), '--force',
                      '--file-pattern', r'.*(\.json|\.log)$')
    receipt = json.loads((RESULT / 'prepared.json').read_text())
    if digest(STAGE / 'dataset/unsloth-plan.json') != receipt['planSha256']:
        raise ValueError('Frozen plan changed')
    if args.action == 'upload':
        return kaggle('datasets', 'create', '-p', str(STAGE / 'dataset'), '--dir-mode', 'skip')
    if not args.approved:
        parser.error('Run needs a concrete runtime notice and the user\'s clear yes')
    from kaggle.api.kaggle_api_extended import KaggleApi
    api = KaggleApi()
    api.authenticate()
    status = json.loads(api.dataset_status(DATASET, format='json(status,current_version_number)'))
    if status.get('status') != 'ready':
        raise ValueError('Dataset not ready; no GPU job submitted')
    source = f"{DATASET}/{status['current_version_number']}"
    with tempfile.TemporaryDirectory() as directory:
        api.dataset_download_file(source, 'unsloth-plan.json', path=directory, force=True, quiet=True)
        if digest(Path(directory) / 'unsloth-plan.json') != receipt['planSha256']:
            raise ValueError('Remote dataset differs from the frozen plan; no GPU job submitted')
    metadata = json.loads((STAGE / 'kernel/kernel-metadata.json').read_text())
    metadata['dataset_sources'] = [source]
    (STAGE / 'kernel/kernel-metadata.json').write_text(json.dumps(metadata, indent=2))
    kaggle('kernels', 'push', '-p', str(STAGE / 'kernel'), '--accelerator', 'NvidiaTeslaT4',
           '--timeout', str(receipt['plan']['kernelTimeoutSeconds']))


if __name__ == '__main__':
    main()
