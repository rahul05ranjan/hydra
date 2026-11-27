"""Private Kaggle T4 run: full-parameter fine-tune of Hydra Nano v2 on the tool-calling mix
(train/data-toolcall: decline when no offered function fits, call when one does, Hydra Git replay).
Training only: no Hydra development, holdout or sealed input, no benchmark input, no publication.
The starting checkpoint is the published v2 at a pinned revision, checked file by file."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

START = time.monotonic()
WORK = Path('/kaggle/working')
TEMP = Path('/tmp/hydra-toolcall')


def digest(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


CLOUDFLARE_SECRETS = ('CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN')


def cloudflare_secrets():
    """The Cloudflare account ID and token, from the Kaggle secrets attached to this notebook. Never printed."""
    from kaggle_secrets import UserSecretsClient
    client, values = UserSecretsClient(), {}
    for name in CLOUDFLARE_SECRETS:
        try:
            values[name] = client.get_secret(name)
        except Exception:
            values[name] = ''
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise RuntimeError('Attach these Kaggle secrets to this notebook: ' + ', '.join(missing))
    return values


def build_data(inputs, plan, start, secrets):
    """v5: build the training mix here first. GLM-5.3 on Cloudflare Workers AI writes the tool-calling targets
    (train/build_toolcall_data_v5.py). Replies are cached in /kaggle/working as they arrive."""
    import zipfile
    build = plan['build']
    repo = TEMP / 'repo'
    with zipfile.ZipFile(inputs / 'build-inputs.bin') as z:
        z.extractall(repo)
    cache = WORK / 'toolcall-v5-glm.jsonl'
    shutil.copyfile(repo / 'seed-cache.jsonl', cache)
    env = {**os.environ, 'HF_HUB_OFFLINE': '1', **secrets}
    sources = repo / 'sources'
    with (WORK / 'build.log').open('w') as log:
        code = subprocess.run([sys.executable, '-u', str(repo / 'train/build_toolcall_data_v5.py'),
            '--tokenizer', str(start), '--glaive', str(sources / 'glaive-function-calling-v2.json'),
            '--hermes', str(sources / 'func-calling-singleturn.json'), '--xlam', str(sources / 'xlam-7.5k-irrelevancek.json'),
            '--bfcl', str(sources / 'bfcl'), '--cache', str(cache), '--workers', str(build['workers']),
            '--deadline-seconds', str(build['deadlineSeconds'])],
            cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT).returncode
    if code:
        raise RuntimeError(f'Data build failed (exit {code}); see build.log')
    data = repo / 'train/data-toolcall-v5'
    manifest = json.loads((data / 'manifest.json').read_text())
    if manifest['dataSha256'] != digest(data / 'train.jsonl') or any(
            manifest[k] for k in ('sealedInputsUsed', 'developmentInputsUsed', 'holdoutInputsUsed', 'benchmarkInputsUsed')):
        raise ValueError('Built data is unverified or contaminated')
    if manifest['heads'].get('toolcall', 0) < build['minToolcallRows']:
        raise RuntimeError(f"Only {manifest['heads'].get('toolcall', 0)} tool-calling rows were built; not training")
    kept = WORK / 'data-toolcall-v5'
    kept.mkdir(exist_ok=True)
    for name in ('train.jsonl', 'manifest.json'):
        shutil.copyfile(data / name, kept / name)
    return kept / 'train.jsonl', kept / 'manifest.json'


def main():
    inputs = next(Path('/kaggle/input').rglob('toolcall-plan.json')).parent
    plan = json.loads((inputs / 'toolcall-plan.json').read_text())
    for name, expected in plan['inputs'].items():
        if digest(inputs / name) != expected:
            raise ValueError(f'Input changed: {name}')
    secrets = cloudflare_secrets() if plan.get('build') else None  # fail in seconds, before any download
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'transformers==5.19.0',
                    *(['python-dotenv'] if plan.get('build') else [])], check=True)
    from huggingface_hub import snapshot_download
    start = Path(snapshot_download(plan['checkpoint']['repo'], revision=plan['checkpoint']['revision'],
                                   local_dir=TEMP / 'start', allow_patterns=list(plan['checkpoint']['files'])))
    for name, expected in plan['checkpoint']['files'].items():
        if digest(start / name) != expected:
            raise ValueError(f'Starting checkpoint changed: {name}')
    if plan.get('build'):
        data, data_manifest = build_data(inputs, plan, start, secrets)
    else:
        data, data_manifest = inputs / 'train.jsonl', inputs / 'data-manifest.json'
    manifest = TEMP / 'checkpoint-manifest.json'
    manifest.write_text(json.dumps({'source': plan['checkpoint'], 'weightsOnlyResume': True,
                                    'files': plan['checkpoint']['files']}, indent=2))
    candidate = WORK / 'candidate'
    with (WORK / 'training.log').open('w') as log:
        code = subprocess.run([sys.executable, str(inputs / 'full_finetune.py'),
            '--checkpoint', str(start), '--checkpoint-manifest', str(manifest),
            '--data', str(data), '--data-manifest', str(data_manifest),
            '--head', plan['heads'], '--output', str(candidate), '--approved',
            '--steps', str(plan['steps']), '--max-seconds', str(plan['trainerSeconds']),
            '--max-length', str(plan['maxLength']), '--accumulation', str(plan['accumulation']),
            '--learning-rate', str(plan['learningRate']), '--initial-scale', str(plan['initialScale']),
            '--sample-seed', str(plan['sampleSeed']), '--method', plan.get('method', 'full'),
            *(['--lora-rank', str(plan['loraRank']), '--lora-alpha', str(plan['loraAlpha'])]
              if plan.get('method') == 'lora' else [])],
            env={**os.environ, 'CUDA_VISIBLE_DEVICES': '0', 'HF_HUB_OFFLINE': '1'},
            stdout=log, stderr=subprocess.STDOUT).returncode
    receipt_file = candidate / 'training-receipt.json'
    receipt = json.loads(receipt_file.read_text()) if receipt_file.exists() else {}
    if plan.get('method') == 'lora':
        lora = receipt.get('lora') or {}
        complete = receipt.get('checkpointSaved') and lora.get('wrappedModules') and lora.get('mergedModules') == lora.get('wrappedModules')
    else:
        complete = receipt.get('checkpointSaved') and receipt.get('trainableParameters') == receipt.get('totalParameters')
    if code or not complete:
        raise RuntimeError(f'Training did not save a complete {plan.get("method", "full")} checkpoint (exit {code})')
    # Ship the same chat and generation files as v2 so the candidate converts and runs like it.
    for name in ('chat_template.jinja', 'generation_config.json'):
        shutil.copyfile(start / name, candidate / name)
    (WORK / 'toolcall-summary.json').write_text(json.dumps({'complete': True, 'plan': plan, 'training': receipt,
        'data': {'sha256': digest(data), 'manifest': json.loads(data_manifest.read_text())},
        'candidateFiles': {f.name: digest(f) for f in candidate.iterdir() if f.is_file()},
        'elapsedSeconds': time.monotonic() - START, 'published': False}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        (WORK / 'toolcall-failure.json').write_text(json.dumps({'error': str(error), 'elapsedSeconds': time.monotonic() - START}))
        raise
