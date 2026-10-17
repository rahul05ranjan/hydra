"""Freeze, upload, run and collect toolcall_eval.py on a private Kaggle 2x T4 notebook. The candidate
comes straight from the training notebook's output (attached as a kernel source), so it is never
downloaded and re-uploaded. Credentials come from the root .env and are never printed.
Usage: python train/kaggle/toolcall_eval_control.py prepare|upload|run --approved|status|output"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / '.env')
STAGE = Path.home() / '.hydra/kaggle-toolcall-eval'
TRAINING = Path.home() / '.hydra/build/toolcall-candidate'
RESULT = Path.home() / '.hydra/build/toolcall-eval'
USER = os.environ.get('KAGGLE_USERNAME', '')
KERNEL = f'{USER}/hydra-toolcall-evaluation'
DATASET = KERNEL + '-input'
TRAINING_KERNEL = f'{USER}/hydra-toolcall-training'
TIMEOUT = 8 * 3600
SOURCES = ['skills/hydra/scripts', 'evals/run.mjs', 'evals/run_dev.mjs', 'evals/live_reporter.mjs', 'evals/git1',
           'evals/git_dev', 'evals/suite/run.mjs', 'evals/suite/scoring.mjs', 'evals/public/bfcl_qwen35.py',
           'train/world.mjs', 'train/kaggle/kernel.py']
SPLITS = ['development', 'extended', 'dev2', 'holdout', 'holdout2']


def digest(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def kaggle(*args):
    subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', *args], check=True)


def prepare():
    dataset, kernel = STAGE / 'dataset', STAGE / 'kernel'
    for d in (dataset, kernel):
        d.mkdir(parents=True, exist_ok=True)
    training = json.loads((TRAINING / 'toolcall-summary.json').read_text())
    if not training.get('complete'):
        raise ValueError('Training did not complete')
    files = []
    for entry in SOURCES:
        path = ROOT / entry
        files += sorted(p for p in path.rglob('*') if p.is_file()) if path.is_dir() else [path]
    for split in SPLITS:
        files += sorted((ROOT / 'evals/suite/quality' / split).glob('*.json'))
    names = [f.relative_to(ROOT).as_posix() for f in files if '/results/' not in f.as_posix()]
    with zipfile.ZipFile(dataset / 'frozen.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        for name in names:
            z.write(ROOT / name, name)
    quality = Path.home() / '.hydra/quality-sources/files'
    tree = {}
    with zipfile.ZipFile(dataset / 'quality-sources.bin', 'w', zipfile.ZIP_DEFLATED) as z:
        for file in sorted(p for p in quality.rglob('*') if p.is_file()):
            name = 'files/' + file.relative_to(quality).as_posix()
            z.write(file, name)
            tree[name] = digest(file)
    v2 = Path.home() / '.hydra/build/bench-models/hydra-nano-v2'
    candidate = training['candidateFiles']
    for name in ('tokenizer.json', 'chat_template.jinja'):
        if candidate.get(name) != digest(v2 / name):
            raise ValueError(f'Candidate {name} differs from v2; one BFCL tokenizer cannot serve both')
    plan = {'deadlineSeconds': TIMEOUT - 600, 'gateTolerance': 0.005,
            'sourceHashes': {name: digest(ROOT / name) for name in names},
            'converterFiles': json.loads((STAGE / 'converter-files.json').read_text()),
            'candidateFiles': {k: v for k, v in candidate.items() if k != 'training-receipt.json'},
            'trainingPlanSha256': training['plan'].get('inputs'),
            'inputs': {name: digest(dataset / name) for name in ('frozen.zip', 'converter.zip', 'quality-sources.bin')},
            'qualitySourcesTree': hashlib.sha256(json.dumps(tree, sort_keys=True).encode()).hexdigest(),
            'scope': 'Side-by-side evaluation of the toolcall candidate and Hydra Nano v2 (development gates; '
                     'held-out and sealed aggregate only if the gates pass; BFCL; lm-eval on the candidate).'}
    (dataset / 'toolcall-eval-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    plan_hash = digest(dataset / 'toolcall-eval-plan.json')
    guard = ("from pathlib import Path as _P\nimport hashlib as _H\n"
             "_f = next(_P('/kaggle/input').rglob('toolcall-eval-plan.json'))\n"
             f"if _H.sha256(_f.read_bytes()).hexdigest() != '{plan_hash}':\n"
             "    raise ValueError('Mounted plan differs from the frozen plan')\n\n")
    (kernel / 'toolcall_eval.py').write_text(guard + (ROOT / 'train/kaggle/toolcall_eval.py').read_text())
    (dataset / 'dataset-metadata.json').write_text(json.dumps({'id': DATASET, 'title': 'Hydra toolcall evaluation input',
        'licenses': [{'name': 'apache-2.0'}], 'description': plan['scope']}, indent=2))
    (kernel / 'kernel-metadata.json').write_text(json.dumps({'id': KERNEL, 'title': 'Hydra toolcall evaluation',
        'code_file': 'toolcall_eval.py', 'language': 'python', 'kernel_type': 'script', 'is_private': True,
        'enable_gpu': True, 'enable_internet': True, 'dataset_sources': [DATASET], 'competition_sources': [],
        'kernel_sources': [TRAINING_KERNEL]}, indent=2))
    RESULT.mkdir(parents=True, exist_ok=True)
    (RESULT / 'prepared.json').write_text(json.dumps({'planSha256': plan_hash, 'sources': len(names)}, indent=2) + '\n')
    print(json.dumps({'planSha256': plan_hash, 'sources': len(names),
                      'inputBytes': {n: (dataset / n).stat().st_size for n in plan['inputs']}}, indent=1))


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
    if digest(STAGE / 'dataset/toolcall-eval-plan.json') != receipt['planSha256']:
        raise ValueError('Frozen plan changed')
    if args.action == 'upload':
        return kaggle('datasets', 'create', '-p', str(STAGE / 'dataset'), '--dir-mode', 'skip')
    if not args.approved:
        parser.error("Run needs a concrete runtime notice and the user's clear yes")
    from kaggle.api.kaggle_api_extended import KaggleApi
    api = KaggleApi()
    api.authenticate()
    status = json.loads(api.dataset_status(DATASET, format='json(status,current_version_number)'))
    if status.get('status') != 'ready':
        raise ValueError('Dataset not ready; no GPU job submitted')
    source = f"{DATASET}/{status['current_version_number']}"
    with tempfile.TemporaryDirectory() as directory:
        api.dataset_download_file(source, 'toolcall-eval-plan.json', path=directory, force=True, quiet=True)
        if digest(Path(directory) / 'toolcall-eval-plan.json') != receipt['planSha256']:
            raise ValueError('Remote dataset differs from the frozen plan; no GPU job submitted')
    metadata = json.loads((STAGE / 'kernel/kernel-metadata.json').read_text())
    metadata['dataset_sources'] = [source]
    (STAGE / 'kernel/kernel-metadata.json').write_text(json.dumps(metadata, indent=2))
    kaggle('kernels', 'push', '-p', str(STAGE / 'kernel'), '--accelerator', 'NvidiaTeslaT4', '--timeout', str(TIMEOUT))


if __name__ == '__main__':
    main()
