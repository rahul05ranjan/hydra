"""Freeze, upload, run and collect the tool-calling fine-tune (toolcall_train.py) on a private Kaggle T4.
Credentials come from the root .env and are never printed.
Usage: python train/kaggle/toolcall_control.py prepare|upload|run --approved|status|output"""
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
# HYDRA_TOOLCALL_RUN=v2 or v3 selects the second or third mix (train/data-toolcall-v2, -v3) under its own
# names, so earlier runs' kernels, datasets and receipts stay as they were.
RUN = os.environ.get('HYDRA_TOOLCALL_RUN', 'v1')
SUFFIX = '' if RUN == 'v1' else f'-{RUN}'
DATA = ROOT / {'v1': 'train/data-toolcall', 'v2': 'train/data-toolcall-v2', 'v3': 'train/data-toolcall-v3'}[RUN]
STAGE = Path.home() / f'.hydra/kaggle-toolcall{SUFFIX}'
RESULT = Path.home() / f'.hydra/build/toolcall-candidate{SUFFIX}'
USER = os.environ.get('KAGGLE_USERNAME', '')
KERNEL = f'{USER}/hydra-toolcall-training{SUFFIX}'
DATASET = KERNEL + '-input'
V2 = Path.home() / '.hydra/build/bench-models/hydra-nano-v2'
PLAN = {'heads': {'v1': 'git,toolcall', 'v2': 'git,toolcall,chat', 'v3': 'git,toolcall,chat'}[RUN], 'steps': 200, 'accumulation': 8,
        'learningRate': 2e-6, 'initialScale': 128, 'maxLength': 2048,
        'sampleSeed': {'v1': 20261017, 'v2': 20261018, 'v3': 20261019}[RUN], 'trainerSeconds': 7200, 'kernelTimeoutSeconds': 3 * 3600,
        'checkpoint': {'repo': 'rahul05ranjan/hydra-nano-git', 'revision': '8129125fad1c664bbb58ebd3238f6598c879eb23'}}


def digest(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def kaggle(*args):
    subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', *args], check=True)


def prepare():
    dataset, kernel = STAGE / 'dataset', STAGE / 'kernel'
    for d in (dataset, kernel):
        d.mkdir(parents=True, exist_ok=True)
    data = json.loads((DATA / 'manifest.json').read_text())
    if data['dataSha256'] != digest(DATA / 'train.jsonl') or any(
            data[k] for k in ('sealedInputsUsed', 'developmentInputsUsed', 'holdoutInputsUsed', 'benchmarkInputsUsed')):
        raise ValueError('Unverified or contaminated training data')
    shutil.copyfile(DATA / 'train.jsonl', dataset / 'train.jsonl')
    shutil.copyfile(DATA / 'manifest.json', dataset / 'data-manifest.json')
    shutil.copyfile(ROOT / 'train/full_finetune.py', dataset / 'full_finetune.py')
    files = ('model.safetensors', 'config.json', 'tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja', 'generation_config.json')
    plan = {**PLAN, 'checkpoint': {**PLAN['checkpoint'], 'files': {name: digest(V2 / name) for name in files}},
            'inputs': {name: digest(dataset / name) for name in ('train.jsonl', 'data-manifest.json', 'full_finetune.py')},
            'examples': data['examples'], 'scope': data['scope']}
    if plan['checkpoint']['files']['model.safetensors'] != '7b6b4662dbba3542fd296696b1c94e06240b28931e5b8ac6eec5cb99fc3dc8f0':
        raise ValueError('Local v2 copy is not the published v2 checkpoint')
    (dataset / 'toolcall-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    plan_hash = digest(dataset / 'toolcall-plan.json')
    guard = ("from pathlib import Path as _P\nimport hashlib as _H\n"
             "_f = next(_P('/kaggle/input').rglob('toolcall-plan.json'))\n"
             f"if _H.sha256(_f.read_bytes()).hexdigest() != '{plan_hash}':\n"
             "    raise ValueError('Mounted plan differs from the frozen plan')\n\n")
    (kernel / 'toolcall_train.py').write_text(guard + (ROOT / 'train/kaggle/toolcall_train.py').read_text())
    (dataset / 'dataset-metadata.json').write_text(json.dumps({'id': DATASET, 'title': f'Hydra toolcall training input{SUFFIX}',
        'licenses': [{'name': 'CC-BY-4.0'}], 'description': plan['scope']}, indent=2))
    (kernel / 'kernel-metadata.json').write_text(json.dumps({'id': KERNEL, 'title': f'Hydra toolcall training{SUFFIX}',
        'code_file': 'toolcall_train.py', 'language': 'python', 'kernel_type': 'script', 'is_private': True,
        'enable_gpu': True, 'enable_internet': True, 'dataset_sources': [DATASET], 'competition_sources': [],
        'kernel_sources': []}, indent=2))
    RESULT.mkdir(parents=True, exist_ok=True)
    (RESULT / 'prepared.json').write_text(json.dumps({'planSha256': plan_hash, 'plan': plan,
        'kernelSha256': digest(kernel / 'toolcall_train.py')}, indent=2) + '\n')
    print(json.dumps({'planSha256': plan_hash, 'examples': plan['examples'], 'inputs': plan['inputs']}, indent=1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'upload', 'run', 'status', 'output'])
    parser.add_argument('--approved', action='store_true', help='Only after a concrete runtime notice and a clear yes')
    args = parser.parse_args()
    if args.action == 'prepare':
        return prepare()
    if args.action == 'status':
        return kaggle('kernels', 'status', KERNEL)
    if args.action == 'output':
        return kaggle('kernels', 'output', KERNEL, '-p', str(RESULT), '--force')
    receipt = json.loads((RESULT / 'prepared.json').read_text())
    if digest(STAGE / 'dataset/toolcall-plan.json') != receipt['planSha256']:
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
        api.dataset_download_file(source, 'toolcall-plan.json', path=directory, force=True, quiet=True)
        if digest(Path(directory) / 'toolcall-plan.json') != receipt['planSha256']:
            raise ValueError('Remote dataset differs from the frozen plan; no GPU job submitted')
    metadata = json.loads((STAGE / 'kernel/kernel-metadata.json').read_text())
    metadata['dataset_sources'] = [source]
    (STAGE / 'kernel/kernel-metadata.json').write_text(json.dumps(metadata, indent=2))
    kaggle('kernels', 'push', '-p', str(STAGE / 'kernel'), '--accelerator', 'NvidiaTeslaT4',
           '--timeout', str(receipt['plan']['kernelTimeoutSeconds']))


if __name__ == '__main__':
    main()
