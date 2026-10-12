"""Prepare/manage development-only five-head diagnosis. Training is never launched."""
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
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[2]
STAGING = Path.home() / '.hydra/kaggle-suite'
CONVERTER_REVISION = 'a05e58c981ea1ec863b2f5b11bbde66f7bb7aac6'
ASSETS = ('config.json', 'tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja', 'merges.txt', 'vocab.json', 'model.safetensors')


def digest(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def prepare(username, converter):
    audit = json.loads((ROOT / 'evals/results/suite/artifact-audit.json').read_text())
    models = {model['head']: model for model in audit['models']}
    # Reuse a conversion only when weights AND all tokenizer/config blobs match.
    def fingerprint(model):
        entries = {file['path']: file for file in model['files']}
        return [(name, entries[name]['sha256'] or entries[name]['gitBlobId']) for name in ASSETS]
    if any(fingerprint(models[head]) != fingerprint(models['files']) for head in ('read', 'test', 'os')):
        raise ValueError('Four non-Git artifacts differ; prepare individual conversions instead')
    dataset = STAGING / 'dataset'
    kernel = STAGING / 'kernel'
    dataset.mkdir(parents=True, exist_ok=True)
    kernel.mkdir(parents=True, exist_ok=True)
    # Only an explicit allowlist: sealed tasks, failure receipts and secrets cannot enter.
    sources = [file for file in (ROOT / 'skills/hydra/scripts').rglob('*') if file.is_file()]
    sources += [ROOT / name for name in ('evals/run_dev.mjs', 'evals/live_reporter.mjs', 'train/world.mjs',
        'evals/suite/run.mjs', 'evals/suite/scoring.mjs', 'evals/suite/os_tasks.json',
        'evals/files/tasks.json', 'evals/read/tasks.json', 'evals/test_logs/tasks.json',
        'train/kaggle/kernel.py', 'train/kaggle/suite_kernel.py')]
    sources += [ROOT / 'evals/git_dev' / name for name in ('build.mjs', 'phrasings.json', 'tasks.jsonl', 'worlds.json')]
    hashes = {}
    with zipfile.ZipFile(dataset / 'frozen.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(sources):
            name = file.relative_to(ROOT).as_posix()
            if 'git1' in name or file.suffix in ('.env', '.gguf', '.safetensors'):
                raise ValueError('Unexpected private/sealed source')
            archive.write(file, name)
            hashes[name] = digest(file)
    actual = subprocess.check_output(['git', '-C', str(converter), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != CONVERTER_REVISION:
        raise ValueError('Converter differs from the validated llama.cpp revision')
    names = subprocess.check_output(['git', '-C', str(converter), 'ls-tree', '-r', '--name-only', 'HEAD', '--',
        'convert_hf_to_gguf.py', 'conversion', 'gguf-py/gguf'], text=True).splitlines()
    with zipfile.ZipFile(dataset / 'converter.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            # Read immutable Git blobs, even if the working checkout was edited.
            archive.writestr('llama/' + name, subprocess.check_output(['git', '-C', str(converter), 'show', f'HEAD:{name}']))
    representative = models['files']
    assets = []
    for name in ASSETS:
        file = next(file for file in representative['files'] if file['path'] == name)
        sha = file['sha256']
        if not sha:
            cached = hf_hub_download(representative['repo'], name, revision=representative['revision'])
            sha = digest(cached)
        assets.append({'path': name, 'sha256': sha,
            'url': f"https://huggingface.co/{representative['repo']}/resolve/{representative['revision']}/{name}"})
    runtime = json.loads((ROOT / 'skills/hydra/scripts/runtime-manifest.json').read_text())
    plan = {'version': 1, 'training': False, 'sealedEvaluation': False, 'deadlineSeconds': 1800,
        'sourceHashes': hashes, 'frozenSha256': digest(dataset / 'frozen.zip'),
        'converterRevision': CONVERTER_REVISION, 'converterSha256': digest(dataset / 'converter.zip'),
        'models': audit['models'], 'nonGitAssets': assets, 'gitGGUF': runtime['model'],
        'nonGitTasks': 84, 'gitDevelopmentTasks': 200,
        'scope': 'Small development fixtures; diagnose gaps before full training. No release accuracy claim.'}
    (dataset / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n', encoding='utf-8')
    dataset_id = f'{username}/hydra-suite-development-input'
    (dataset / 'dataset-metadata.json').write_text(json.dumps({'id': dataset_id,
        'title': 'Hydra five-head development diagnosis input', 'licenses': [{'name': 'apache-2.0'}],
        'description': 'Frozen development inputs only; no sealed tasks, credentials, or training.'}, indent=2))
    shutil.copyfile(ROOT / 'train/kaggle/suite_kernel.py', kernel / 'suite_kernel.py')
    (kernel / 'kernel-metadata.json').write_text(json.dumps({'id': f'{username}/hydra-five-head-development-diagnosis',
        'title': 'Hydra five-head development diagnosis', 'code_file': 'suite_kernel.py', 'language': 'python',
        'kernel_type': 'script', 'is_private': True, 'enable_gpu': True, 'enable_internet': True,
        'dataset_sources': [dataset_id], 'competition_sources': [], 'kernel_sources': []}, indent=2))
    receipt = {'planSha256': digest(dataset / 'plan.json'), 'frozenSha256': plan['frozenSha256'],
        'converterSha256': plan['converterSha256'], 'sourceFiles': len(hashes), 'sealedFiles': 0,
        'training': False, 'submitted': False, 'deadlineSeconds': 1800, 'tasks': 284,
        'modelRevisions': {head: model['revision'] for head, model in models.items()}}
    dest = ROOT / 'evals/results/suite/prepared.json'
    dest.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))


def main():
    load_dotenv(ROOT / '.env')
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'upload', 'run', 'status', 'output'])
    parser.add_argument('--converter', type=Path, default=Path.home() / '.hydra/build/llama.cpp')
    parser.add_argument('--approved', action='store_true')
    args = parser.parse_args()
    username = os.environ.get('KAGGLE_USERNAME', '')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', username):
        parser.error('Set KAGGLE_USERNAME in root .env')
    if args.action == 'prepare':
        prepare(username, args.converter)
        return
    if not (os.environ.get('KAGGLE_API_TOKEN') or os.environ.get('KAGGLE_KEY')):
        parser.error('Set Kaggle credentials in root .env')
    if args.action == 'run' and not args.approved:
        parser.error('Requires explicit approval: private Kaggle T4, 284 development tasks, <=30 minutes, no training/paid API/sealed evaluation')
    kernel_id = f'{username}/hydra-five-head-development-diagnosis'
    commands = {'upload': ['datasets', 'create', '-p', str(STAGING / 'dataset')],
        'run': ['kernels', 'push', '-p', str(STAGING / 'kernel'), '--accelerator', 'NvidiaTeslaT4', '--timeout', '1800'],
        'status': ['kernels', 'status', kernel_id],
        'output': ['kernels', 'output', kernel_id, '-p', str(ROOT / 'evals/results/suite/kaggle'), '--force']}
    subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', *commands[args.action]], check=True)


if __name__ == '__main__':
    main()
