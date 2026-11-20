"""Prepare and manage the one-time 10,000-task holdout3 evaluation of Hydra Nano v2 on a private Kaggle T4.
No training, no sealed git1 input, no paid API. Only per-head aggregates come back."""
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
STAGING = Path.home() / '.hydra/kaggle-holdout3'
SOURCES = Path.home() / '.hydra/quality-sources/files'
TIMEOUT = 7200


def digest(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def prepare(username):
    dataset, kernel = STAGING / 'dataset', STAGING / 'kernel'
    shutil.rmtree(STAGING, ignore_errors=True)
    dataset.mkdir(parents=True)
    kernel.mkdir(parents=True)
    # An explicit allowlist: the CLI, the two runners, the world builder, and the five frozen holdout3 sets.
    files = [file for file in (ROOT / 'skills/hydra/scripts').rglob('*') if file.is_file()]
    files += [ROOT / name for name in ('evals/run_dev.mjs', 'evals/live_reporter.mjs', 'train/world.mjs',
        'evals/suite/run.mjs', 'evals/suite/scoring.mjs', 'train/kaggle/kernel.py', 'train/kaggle/holdout3_kernel.py',
        'evals/git_dev/build.mjs', 'evals/git_dev/phrasings.json', 'evals/git_dev/tasks.jsonl', 'evals/git_dev/worlds.json')]
    files += [ROOT / 'evals/git_holdout3' / name for name in ('phrasings.json', 'tasks.jsonl', 'worlds.json')]
    files += [ROOT / 'evals/suite/quality/holdout3' / f'{head}.json' for head in ('files', 'read', 'test', 'os')]
    hashes = {}
    with zipfile.ZipFile(dataset / 'frozen.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(set(files)):
            name = file.relative_to(ROOT).as_posix()
            if 'git1' in name or '__pycache__' in name or file.suffix in ('.env', '.gguf', '.safetensors', '.pyc'):
                continue
            archive.write(file, name)
            hashes[name] = digest(file)
    # Only the pinned source files the Files and Read tasks name.
    needed = set()
    for head in ('files', 'read'):
        for task in json.loads((ROOT / f'evals/suite/quality/holdout3/{head}.json').read_text()):
            needed.update(ref['source'] for ref in task.get('sourceFiles', {}).values())
            if task.get('sourceRef'):
                needed.add(task['sourceRef']['source'])
    inventory = json.loads((ROOT / 'evals/suite/source-inventory.json').read_text())
    with zipfile.ZipFile(dataset / 'sources.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for key in sorted(needed):
            if digest(SOURCES / key) != inventory['files'][key]:
                raise ValueError(f'Pinned source changed: {key}')
            archive.write(SOURCES / key, key)
    tasks = {head: len(json.loads((ROOT / f'evals/suite/quality/holdout3/{head}.json').read_text())) for head in ('files', 'read', 'test', 'os')}
    tasks['git'] = sum(1 for line in (ROOT / 'evals/git_holdout3/tasks.jsonl').read_text().splitlines() if line.strip())
    if set(tasks.values()) != {2000}:
        raise ValueError(f'Expected 2,000 tasks per head: {tasks}')
    runtime = json.loads((ROOT / 'skills/hydra/scripts/runtime-manifest.json').read_text())
    plan = {'version': 1, 'split': 'holdout3', 'tasks': 10000, 'tasksByHead': tasks, 'training': False,
        'sealedEvaluation': False, 'timeoutSeconds': TIMEOUT, 'sourceHashes': hashes,
        'frozen.zip': digest(dataset / 'frozen.zip'), 'sources.zip': digest(dataset / 'sources.zip'),
        'sourceFiles': len(needed), 'model': runtime['model'],
        'commit': subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
        'scope': 'Third holdout, frozen before scoring and scored once; per-head aggregates only.'}
    (dataset / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    dataset_id = f'{username}/hydra-holdout3-input'
    (dataset / 'dataset-metadata.json').write_text(json.dumps({'id': dataset_id, 'title': 'Hydra holdout3 evaluation input',
        'licenses': [{'name': 'apache-2.0'}], 'description': 'Frozen holdout3 tasks, Hydra CLI and pinned public source files; no credentials, sealed tasks or training data.'}, indent=2))
    shutil.copyfile(ROOT / 'train/kaggle/holdout3_kernel.py', kernel / 'holdout3_kernel.py')
    (kernel / 'kernel-metadata.json').write_text(json.dumps({'id': f'{username}/hydra-holdout3-evaluation',
        'title': 'Hydra holdout3 evaluation', 'code_file': 'holdout3_kernel.py', 'language': 'python', 'kernel_type': 'script',
        'is_private': True, 'enable_gpu': True, 'enable_internet': True, 'dataset_sources': [dataset_id],
        'competition_sources': [], 'kernel_sources': []}, indent=2))
    receipt = {'planSha256': digest(dataset / 'plan.json'), 'frozenSha256': plan['frozen.zip'], 'sourcesSha256': plan['sources.zip'],
        'files': len(hashes), 'sourceFiles': len(needed), 'tasksByHead': tasks, 'commit': plan['commit'],
        'bytes': {name: (dataset / name).stat().st_size for name in ('frozen.zip', 'sources.zip')}}
    print(json.dumps(receipt, indent=2))


def main():
    load_dotenv(ROOT / '.env')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'upload', 'run', 'status', 'output'])
    parser.add_argument('--approved', action='store_true')
    args = parser.parse_args()
    username = os.environ.get('KAGGLE_USERNAME', '')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', username):
        parser.error('Set KAGGLE_USERNAME in root .env')
    if args.action == 'prepare':
        prepare(username)
        return
    if args.action == 'run' and not args.approved:
        parser.error('Requires the user\'s approval: one private Kaggle T4, up to 2 hours, evaluation only')
    kernel_id = f'{username}/hydra-holdout3-evaluation'
    commands = {'upload': ['datasets', 'create', '-p', str(STAGING / 'dataset')],
        'run': ['kernels', 'push', '-p', str(STAGING / 'kernel'), '--accelerator', 'NvidiaTeslaT4', '--timeout', str(TIMEOUT)],
        'status': ['kernels', 'status', kernel_id],
        'output': ['kernels', 'output', kernel_id, '-p', str(ROOT / 'evals/results/suite/holdout3'), '--force']}
    subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', *commands[args.action]], check=True)


if __name__ == '__main__':
    main()
