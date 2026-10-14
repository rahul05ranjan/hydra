"""Freeze/manage the next Git prompt validation; sealed scoring is development-gated."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dotenv import load_dotenv
from balanced_control import ROOT, digest, save

STAGE = Path.home() / '.hydra/kaggle-git-prompt-validation'
RESULT = ROOT / 'evals/results/suite/git-prompt-validation'
KERNEL = 'rahulswt7/hydra-git-prompt-validation'
DATASET = KERNEL + '-input'


def prepare():
    previous = json.loads((ROOT / 'evals/results/suite/final-git-validation/eval-plan.json').read_text())
    broad = json.loads((ROOT / 'evals/results/suite/broad-git/quality-plan.json').read_text())
    dataset, kernel = STAGE / 'dataset', STAGE / 'kernel'
    dataset.mkdir(parents=True, exist_ok=True); kernel.mkdir(parents=True, exist_ok=True)
    names = set(previous['sourceHashes']) | {name for name in broad['sourceHashes'] if name.startswith('evals/git_dev/extended/')}
    hashes = {name: digest(ROOT / name) for name in sorted(names)}
    for name, sha in previous['sourceHashes'].items():
        if name.startswith('evals/git1/') and hashes[name] != sha: raise ValueError('Sealed input changed')
    with zipfile.ZipFile(dataset / 'frozen.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(names): archive.write(ROOT / name, name)
    shutil.copyfile(Path.home() / '.hydra/kaggle-final-git/dataset/converter.zip', dataset / 'converter.zip')
    plan = {**previous, 'deadlineSeconds': 1200, 'sourceHashes': hashes,
        'frozenSha256': digest(dataset / 'frozen.zip'), 'converterSha256': digest(dataset / 'converter.zip'),
        'includeExtendedDevelopment': True, 'sealedMinimumDevelopmentSolved': 0.95,
        'scope': 'Best refined checkpoint with development-diagnosed prompt/scope fixes. Original200 + extended800 development and 84 non-Git fixtures; sealed aggregate only if both development sets reach95%. Evaluation only.'}
    save(dataset / 'eval-plan.json', plan)
    plan_hash = digest(dataset / 'eval-plan.json')
    prefix = ("from pathlib import Path as _P\nimport hashlib as _H\n"
        "_f = next(_P('/kaggle/input').rglob('eval-plan.json'))\n"
        f"if _H.sha256(_f.read_bytes()).hexdigest() != '{plan_hash}':\n"
        "    raise ValueError('Mounted evaluation plan differs from frozen input')\n\n")
    (kernel / 'candidate_eval.py').write_text(prefix + (ROOT / 'train/kaggle/candidate_eval.py').read_text(), encoding='utf-8')
    save(dataset / 'dataset-metadata.json', {'id': DATASET, 'title': 'Hydra Git prompt validation input', 'licenses': [{'name': 'apache-2.0'}], 'description': plan['scope']})
    save(kernel / 'kernel-metadata.json', {'id': KERNEL, 'title': 'Hydra Git prompt validation',
        'code_file': 'candidate_eval.py', 'language': 'python', 'kernel_type': 'script', 'is_private': True,
        'enable_gpu': True, 'enable_internet': True, 'dataset_sources': [DATASET],
        'kernel_sources': ['rahulswt7/hydra-balanced-git-refinement/1'], 'competition_sources': []})
    receipt = {'prepared': True, 'submitted': False, 'planSha256': plan_hash,
        'kernelSha256': digest(kernel / 'candidate_eval.py'), 'plan': plan}
    save(RESULT / 'prepared.json', receipt); save(RESULT / 'eval-plan.json', plan)
    shutil.copyfile(kernel / 'candidate_eval.py', RESULT / 'submitted-kernel.py')
    print(json.dumps({key: receipt[key] for key in ('prepared', 'submitted', 'planSha256')}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'upload', 'run', 'status', 'output'])
    parser.add_argument('--approved', action='store_true')
    args = parser.parse_args()
    if args.action == 'prepare': prepare(); return
    load_dotenv(ROOT / '.env')
    from kaggle.api.kaggle_api_extended import KaggleApi
    api = KaggleApi(); api.authenticate()
    if args.action == 'status': print(api.kernels_status(KERNEL)); return
    if args.action == 'output':
        print(api.kernels_output(KERNEL, str(RESULT), force=True, quiet=True,
            file_pattern=r'(candidate-summary\.json|candidate-failure\.json|gpu-evidence\.json|candidate-q8-development\.json|candidate-q8-extended-development\.json|candidate-q8-suite\.json)$'))
        return
    receipt = json.loads((RESULT / 'prepared.json').read_text())
    if digest(STAGE / 'dataset/eval-plan.json') != receipt['planSha256']: raise ValueError('Frozen plan changed')
    if args.action == 'upload':
        subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', 'datasets', 'create', '-p', str(STAGE / 'dataset'), '--dir-mode', 'skip'], check=True)
        return
    if not args.approved: parser.error('Requires prior concrete 20-minute single-T4 evaluation notice and user authorization')
    for name in ('frozen', 'converter'):
        if digest(STAGE / f'dataset/{name}.zip') != receipt['plan'][name + 'Sha256']: raise ValueError(f'Frozen {name} changed')
    if digest(STAGE / 'kernel/candidate_eval.py') != receipt['kernelSha256']: raise ValueError('Frozen kernel changed')
    status = json.loads(api.dataset_status(DATASET, format='json(status,current_version_number)'))
    if status.get('status') != 'ready': raise ValueError('Dataset not ready; no GPU job submitted')
    source = f"{DATASET}/{status['current_version_number']}"
    with tempfile.TemporaryDirectory(prefix='hydra-eval-plan-') as directory:
        api.dataset_download_file(source, 'eval-plan.json', path=directory, force=True, quiet=True)
        if digest(Path(directory) / 'eval-plan.json') != receipt['planSha256']: raise ValueError('Remote plan differs from frozen input')
    metadata = json.loads((STAGE / 'kernel/kernel-metadata.json').read_text())
    metadata['dataset_sources'] = [source]; save(STAGE / 'kernel/kernel-metadata.json', metadata)
    subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', 'kernels', 'push', '-p', str(STAGE / 'kernel'), '--accelerator', 'NvidiaTeslaT4', '--timeout', '1200'], check=True)
    receipt.update(submitted=True, datasetSource=source); save(RESULT / 'prepared.json', receipt)


if __name__ == '__main__': main()
