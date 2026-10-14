"""Stage a bounded full-parameter feasibility run; never submits without run approval."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from full_finetune import digest

ROOT = Path(__file__).resolve().parents[2]
STAGING = Path.home() / '.hydra/kaggle-full-feasibility'


def verified_dataset_source(api, dataset, expected_plan_sha256):
    # A newly uploaded version can still be processing while status reports the
    # previous version as ready. Verify the actual versioned bytes before push.
    status = json.loads(api.dataset_status(dataset, format='json(status,current_version_number)'))
    version = status.get('current_version_number')
    if status.get('status') != 'ready' or not isinstance(version, int) or version < 1:
        raise ValueError('Private training input is not ready; no GPU job submitted')
    source = f'{dataset}/{version}'
    with tempfile.TemporaryDirectory(prefix='hydra-plan-') as directory:
        api.dataset_download_file(source, 'plan.json', path=directory, force=True, quiet=True)
        if digest(Path(directory) / 'plan.json') != expected_plan_sha256:
            raise ValueError('Remote input differs from the approved frozen plan; no GPU job submitted')
    return source


def pin_kernel():
    receipt_path = ROOT / 'evals/results/suite/full-prepared.json'
    receipt = json.loads(receipt_path.read_text())
    dataset = STAGING / 'dataset'
    if digest(dataset / 'plan.json') != receipt['planSha256']:
        raise ValueError('Prepared plan changed before kernel pinning')
    prefix = ("from pathlib import Path as _PinPath\nimport hashlib as _PinHash\n"
        "_pin_file = next(_PinPath('/kaggle/input').rglob('plan.json'))\n"
        f"if _PinHash.sha256(_pin_file.read_bytes()).hexdigest() != '{receipt['planSha256']}':\n"
        "    raise ValueError('Mounted dataset differs from the approved frozen plan')\n\n")
    body = (dataset / 'full_kernel.py').read_text(encoding='utf-8')
    destination = STAGING / 'kernel/full_kernel.py'
    destination.write_text(prefix + body, encoding='utf-8')
    receipt['submittedKernelSha256'] = digest(destination)
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')


def prepare(username, checkpoint, seconds=600):
    if not 180 <= seconds <= 600:
        raise ValueError('Feasibility execution limit must be between 180 and 600 seconds')
    dataset, kernel = STAGING / 'dataset', STAGING / 'kernel'
    (dataset / 'checkpoint').mkdir(parents=True, exist_ok=True)
    kernel.mkdir(parents=True, exist_ok=True)
    spec = json.loads((ROOT / 'evals/results/suite/full-checkpoint-manifest.json').read_text())
    hashes = {}
    for name, expected in spec['files'].items():
        source = (checkpoint / name).resolve()
        if not source.is_relative_to(checkpoint.resolve()) or digest(source) != expected:
            raise ValueError(f'Checkpoint changed: {name}')
        shutil.copyfile(source, dataset / 'checkpoint' / name)
        hashes['checkpoint/' + name] = expected
    # Flat upload: Kaggle skips directories by default and expands ZIP assets.
    with zipfile.ZipFile(dataset / 'checkpoint.zip', 'w', zipfile.ZIP_STORED) as archive:
        for name in spec['files']:
            archive.write(dataset / 'checkpoint' / name, name)
    files = {'full_finetune.py': ROOT / 'train/full_finetune.py',
        'full_kernel.py': ROOT / 'train/kaggle/full_kernel.py',
        'train.jsonl': ROOT / 'train/data-full-feasibility/train.jsonl',
        'data-manifest.json': ROOT / 'train/data-full-feasibility/manifest.json',
        'checkpoint-manifest.json': ROOT / 'evals/results/suite/full-checkpoint-manifest.json'}
    for name, source in files.items():
        shutil.copyfile(source, dataset / name)
        hashes[name] = digest(source)
    data_spec = json.loads((dataset / 'data-manifest.json').read_text())
    if data_spec['dataSha256'] != hashes['train.jsonl'] or data_spec['sealedInputsUsed'] is not False:
        raise ValueError('Unverified/disallowed training data')
    plan = {'training': True, 'method': 'full-parameter-supervised-fine-tuning', 'head': 'git',
        'purpose': 'GPU memory/step-time feasibility only; not a 95% quality claim',
        'lossMethod': 'assistant-selected-logits', 'optimizer': 'cpu-adamw-fp32',
        'steps': 10, 'accumulation': 4, 'learningRate': 1e-5, 'maximumLength': 2048,
        'deadlineSeconds': seconds, 'trainerSeconds': seconds - 60, 'sealedEvaluation': False,
        'files': hashes, 'checkpointArchiveSha256': digest(dataset / 'checkpoint.zip'),
        'samplesForHead': data_spec['samplesByHead']['git']}
    (dataset / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    (dataset / 'dataset-metadata.json').write_text(json.dumps({'id': f'{username}/hydra-full-feasibility-input',
        'title': 'Hydra full parameter feasibility input', 'licenses': [{'name': 'apache-2.0'}],
        'description': 'Verified text checkpoint, new synthetic data and bounded full-parameter feasibility trainer. No secrets or sealed data.'}, indent=2))
    shutil.copyfile(files['full_kernel.py'], kernel / 'full_kernel.py')
    (kernel / 'kernel-metadata.json').write_text(json.dumps({'id': f'{username}/hydra-full-parameter-feasibility',
        'title': 'Hydra full parameter feasibility', 'code_file': 'full_kernel.py', 'language': 'python',
        'kernel_type': 'script', 'is_private': True, 'enable_gpu': True, 'enable_internet': True,
        'dataset_sources': [f'{username}/hydra-full-feasibility-input'],
        'competition_sources': [], 'kernel_sources': []}, indent=2))
    receipt = {'prepared': True, 'submitted': False, 'planSha256': digest(dataset / 'plan.json'),
        'inputBytes': sum(file.stat().st_size for file in dataset.iterdir() if file.is_file() and file.name != 'dataset-metadata.json'), 'plan': plan}
    (ROOT / 'evals/results/suite/full-prepared.json').write_text(json.dumps(receipt, indent=2) + '\n')
    pin_kernel()
    print(json.dumps({k: receipt[k] for k in ('prepared', 'submitted', 'planSha256', 'inputBytes')}, indent=2))


def main():
    load_dotenv(ROOT / '.env')
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'pin-kernel', 'upload', 'update-input', 'run', 'status', 'output'])
    parser.add_argument('--checkpoint', type=Path, default=Path.home() / '.hydra/build/hf-git-normalized')
    parser.add_argument('--approved', action='store_true')
    parser.add_argument('--seconds', type=int, default=600)
    args = parser.parse_args()
    username = os.environ.get('KAGGLE_USERNAME', '')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', username):
        parser.error('Set KAGGLE_USERNAME in root .env')
    if args.action == 'prepare':
        prepare(username, args.checkpoint, args.seconds)
        return
    if args.action == 'pin-kernel':
        pin_kernel()
        return
    if not (os.environ.get('KAGGLE_API_TOKEN') or os.environ.get('KAGGLE_KEY')):
        parser.error('Set Kaggle credentials in root .env')
    if args.action == 'run':
        if not args.approved:
            parser.error('Requires explicit full-training approval: private T4, <=10 minutes, up to10 full optimizer steps, no paid API/sealed test')
        spec = json.loads((ROOT / 'evals/results/suite/full-prepared.json').read_text())
        if digest(STAGING / 'dataset/plan.json') != spec['planSha256']:
            raise ValueError('Prepared training plan changed')
        for name, expected in spec['plan']['files'].items():
            if digest(STAGING / 'dataset' / name) != expected:
                raise ValueError(f'Prepared input changed: {name}')
        if digest(STAGING / 'kernel/full_kernel.py') != spec.get('submittedKernelSha256', spec['plan']['files']['full_kernel.py']):
            raise ValueError('Submitted kernel differs from the prepared training kernel')
        from kaggle.api.kaggle_api_extended import KaggleApi
        api = KaggleApi()
        api.authenticate()
        source = verified_dataset_source(api, f'{username}/hydra-full-feasibility-input', spec['planSha256'])
        metadata_path = STAGING / 'kernel/kernel-metadata.json'
        metadata = json.loads(metadata_path.read_text())
        metadata['dataset_sources'] = [source]
        metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
    kernel_id = f'{username}/hydra-full-parameter-feasibility'
    commands = {'upload': ['datasets', 'create', '-p', str(STAGING / 'dataset'), '--dir-mode', 'skip'],
        'update-input': ['datasets', 'version', '-p', str(STAGING / 'dataset'), '--dir-mode', 'skip', '-m', 'Full-parameter training with CPU AdamW optimizer state'],
        'run': ['kernels', 'push', '-p', str(STAGING / 'kernel'), '--accelerator', 'NvidiaTeslaT4', '--timeout', str(spec['plan']['deadlineSeconds']) if args.action == 'run' else '600'],
        'status': ['kernels', 'status', kernel_id],
        'output': ['kernels', 'output', kernel_id, '-p', str(ROOT / 'evals/results/suite/full-kaggle'),
            '--force', '--file-pattern', r'(training-receipt\.json|full-summary\.json|full-failure\.json|full-training\.log)$']}
    subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', *commands[args.action]], check=True)


if __name__ == '__main__':
    main()
