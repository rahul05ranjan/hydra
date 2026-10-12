"""Prepare/manage a private Kaggle evaluation; secrets stay in root .env."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / '.env')
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
STAGING = Path.home() / '.hydra' / 'kaggle'

def digest(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def prepare(username, model, diagnostic=False, validation=False):
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', username):
        raise ValueError('Set KAGGLE_USERNAME to your actual username in root .env')
    dataset = STAGING / 'dataset'
    kernel = STAGING / 'kernel'
    dataset.mkdir(parents=True, exist_ok=True)
    kernel.mkdir(parents=True, exist_ok=True)
    runtime = json.loads((ROOT / 'skills/hydra/scripts/runtime-manifest.json').read_text())
    model_hash = digest(model)
    if not validation and model_hash != runtime['model']['sha256']:
        raise ValueError('Model SHA-256 differs from runtime manifest')
    shutil.copyfile(model, dataset / 'hydra-nano-git-Q8_0.gguf')
    sources = list((ROOT / 'skills/hydra/scripts').rglob('*'))
    if diagnostic:
        sources += [ROOT / 'evals/git_dev/tasks.jsonl', ROOT / 'train/kaggle/diagnose.py']
    else:
        sources += list((ROOT / 'evals/git1').glob('*')) + [ROOT / 'evals/run.mjs', ROOT / 'evals/live_reporter.mjs']
    if validation:
        sources += list((ROOT / 'evals/git_dev').glob('*')) + [ROOT / 'evals/run_dev.mjs', ROOT / 'train/world.mjs']
    hashes = {}
    with zipfile.ZipFile(dataset / 'frozen.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(f for f in sources if f.is_file()):
            name = file.relative_to(ROOT).as_posix()
            archive.write(file, name)
            hashes[name] = digest(file)
    plan = {'version': 1, 'modelSha256': model_hash, 'sources': hashes,
            'frozenSha256': digest(dataset / 'frozen.zip'), 'tasks': 1000, 'deadlineSeconds': 1800,
            'runtimeTag': runtime['llama']['tag'], 'training': False, 'diagnostic': diagnostic,
            'validation': validation, 'minimumDevelopmentSolved': 0.68}
    if diagnostic:
        plan.update(tasks=20, deadlineSeconds=1200)
    (dataset / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    dataset_id = f'{username}/hydra-q8-' + ('validation-input' if validation else 'diagnostic-input' if diagnostic else 'eval-input')
    (dataset / 'dataset-metadata.json').write_text(json.dumps({
        'id': dataset_id, 'title': 'Hydra Q8 development diagnosis input' if diagnostic else 'Hydra Q8 sealed evaluation input',
        'licenses': [{'name': 'apache-2.0'}],
        'description': 'Frozen Hydra code and converted Q8 model. Evaluation only; no training.'}, indent=2))
    shutil.copyfile(ROOT / 'train/kaggle/kernel.py', kernel / 'kernel.py')
    (kernel / 'kernel-metadata.json').write_text(json.dumps({
        'id': f'{username}/hydra-q8-' + ('corrected-validation' if validation else 'development-diagnosis' if diagnostic else 'sealed-evaluation'), 'title': 'Hydra Q8 corrected validation' if validation else 'Hydra Q8 development diagnosis' if diagnostic else 'Hydra Q8 sealed evaluation',
        'code_file': 'kernel.py', 'language': 'python', 'kernel_type': 'script',
        'is_private': True, 'enable_gpu': True, 'enable_internet': True,
        'dataset_sources': [dataset_id], 'competition_sources': [], 'kernel_sources': []}, indent=2))
    print(f'Prepared private evaluation input at {STAGING}; no remote job submitted.')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'upload', 'update-input', 'run', 'status', 'logs', 'output', 'auth-check'])
    parser.add_argument('--model', default=str(Path.home() / '.hydra/build/hydra-nano-git-Q8_0.gguf'))
    parser.add_argument('--approved', action='store_true', help='Use only after explicit run notice/approval')
    parser.add_argument('--diagnostic', action='store_true', help='Development-only original-weights versus GGUF comparison')
    parser.add_argument('--validation', action='store_true', help='Corrected candidate: 200 development tasks, then sealed evaluation only if solved >=68%')
    args = parser.parse_args()
    if args.diagnostic and args.validation:
        parser.error('Choose diagnostic or validation, not both')
    username = os.environ.get('KAGGLE_USERNAME', '')
    if args.action == 'prepare':
        prepare(username, Path(args.model), args.diagnostic, args.validation)
        return
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', username):
        parser.error('Set KAGGLE_USERNAME in root .env')
    if not (os.environ.get('KAGGLE_API_TOKEN') or os.environ.get('KAGGLE_KEY')):
        parser.error('Set KAGGLE_API_TOKEN (or legacy KAGGLE_KEY) in root .env')
    kernel_id = f'{username}/hydra-q8-' + ('corrected-validation' if args.validation else 'development-diagnosis' if args.diagnostic else 'sealed-evaluation')
    commands = {
        'auth-check': ['datasets', 'list', '--mine', '--page-size', '1'],
        'upload': ['datasets', 'create', '-p', str(STAGING / 'dataset')],
        'update-input': ['datasets', 'version', '-p', str(STAGING / 'dataset'), '-m', 'Fix diagnostic Transformers compatibility'],
        'run': ['kernels', 'push', '-p', str(STAGING / 'kernel'), '--accelerator', 'NvidiaTeslaT4', '--timeout', '750' if args.diagnostic else '1530' if args.validation else '1800'],
        'status': ['kernels', 'status', kernel_id],
        'logs': ['kernels', 'logs', kernel_id],
        'output': ['kernels', 'output', kernel_id, '-p', str(ROOT / ('evals/results/kaggle-corrected' if args.validation else 'evals/results/kaggle-q8')),
                   '--force',
                   '--file-pattern', r'(development\.json|development\.log|diagnosis\.json|git1\.llamacpp-q8\.kaggle\.json|partial-progress\.json|live_progress\.json|failure\.json|eval\.log|server\.log)$'],
    }
    if args.action == 'run' and not args.approved:
        parser.error('Run approval required: private Kaggle T4, ' + ('20 development questions, 20-minute diagnosis' if args.diagnostic else '1000 sealed tasks, 30-minute evaluation') + ', no training')
    subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', *commands[args.action]], check=True)

if __name__ == '__main__':
    main()
