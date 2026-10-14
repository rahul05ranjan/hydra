"""Publish a validated Hydra Nano release to the Hugging Face Hub and pin the installer to it.

Uploads the full-precision checkpoint, its Q8_0 GGUF and the model card to
`rahul05ranjan/hydra-nano-git`, removes files that no longer describe the release,
and updates the four per-head repositories' cards. Every uploaded weight file must
match the hashes in the frozen validation receipt; nothing else is published.
"""
import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from huggingface_hub import CommitOperationAdd, CommitOperationDelete, HfApi

ROOT = Path(__file__).resolve().parent.parent
OWNER = 'rahul05ranjan'
MAIN = f'{OWNER}/hydra-nano-git'
HEADS = ['hydra-nano-files', 'hydra-nano-read', 'hydra-nano-test', 'hydra-nano-os']
CHECKPOINT_FILES = ['model.safetensors', 'config.json', 'generation_config.json', 'tokenizer.json',
                    'tokenizer_config.json', 'chat_template.jinja']
GGUF_NAME = 'hydra-nano-git-Q8_0.gguf'
# The validated checkpoint ends generation at token 248044, but chat turns end with
# <|im_end|> (248046); transformers' generate() then runs past the answer. llama.cpp
# reads the tokenizer's EOS, so the GGUF is unaffected. Publish the chat EOS first.
CHAT_EOS, MODEL_EOS = 248046, 248044
# Files from earlier releases that no longer match the published weights.
STALE = ['model.safetensors.index.json', 'merges.txt', 'vocab.json', 'Modelfile', 'GGUF.md', 'GGUF-EVALUATION.md']


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(16 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    load_dotenv(ROOT / '.env')
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--gguf', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, default=ROOT / 'evals/results/suite/final-git-validation')
    parser.add_argument('--cards', type=Path, default=ROOT / 'hub')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    plan = json.loads((args.receipt / 'prepared.json').read_text())['plan']
    summary = json.loads((args.receipt / 'SUMMARY.json').read_text())
    for name in CHECKPOINT_FILES:
        if sha256(args.checkpoint / name) != plan['checkpointFiles'][name]:
            raise ValueError(f'{name} differs from the validated checkpoint')
    gguf_sha = sha256(args.gguf)
    if gguf_sha != summary['ggufSha256']:
        raise ValueError('GGUF differs from the validated artifact')
    cards = {repo: (args.cards / repo / 'README.md') for repo in ['hydra-nano-git', *HEADS]}
    missing = [str(path) for path in cards.values() if not path.exists()]
    if missing:
        raise ValueError(f'Missing model cards: {missing}')

    generation = json.loads((args.checkpoint / 'generation_config.json').read_text())
    generation['eos_token_id'] = [CHAT_EOS, MODEL_EOS]
    staged = Path(tempfile.mkdtemp()) / 'generation_config.json'
    staged.write_text(json.dumps(generation, indent=2) + '\n')

    token = os.environ.get('HF_TOKEN') or os.environ.get('HUGGINGFACE_API_KEY')
    api = HfApi(token=token)
    if api.whoami()['name'] != OWNER:
        raise ValueError('Authenticated Hub account differs from model owner')
    present = {item.rfilename for item in api.model_info(MAIN).siblings}
    extras = sorted(path for path in (args.cards / 'hydra-nano-git').iterdir() if path.name != 'README.md')
    operations = [CommitOperationAdd(path_in_repo=name, path_or_fileobj=str(staged if name == 'generation_config.json' else args.checkpoint / name))
                  for name in CHECKPOINT_FILES]
    operations += [CommitOperationAdd(path_in_repo=GGUF_NAME, path_or_fileobj=str(args.gguf)),
                   CommitOperationAdd(path_in_repo='README.md', path_or_fileobj=str(cards['hydra-nano-git']))]
    operations += [CommitOperationAdd(path_in_repo=path.name, path_or_fileobj=str(path)) for path in extras]
    operations += [CommitOperationDelete(path_in_repo=name) for name in STALE if name in present]
    print(json.dumps({'repo': MAIN, 'add': [op.path_in_repo for op in operations if isinstance(op, CommitOperationAdd)],
                      'delete': [op.path_in_repo for op in operations if isinstance(op, CommitOperationDelete)],
                      'ggufSha256': gguf_sha, 'heads': HEADS}, indent=2))
    if args.dry_run:
        return

    result = api.create_commit(repo_id=MAIN, operations=operations,
        commit_message='Hydra Nano v2: full-parameter Git fine-tune (sealed git1 92.7%), standard HF weights and Q8_0 GGUF')
    for repo in HEADS:
        api.create_commit(repo_id=f'{OWNER}/{repo}', operations=[CommitOperationAdd(path_in_repo='README.md', path_or_fileobj=str(cards[repo]))],
            commit_message='Point to the Hydra Nano release that serves this head')

    manifest_file = ROOT / 'skills/hydra/scripts/runtime-manifest.json'
    manifest = json.loads(manifest_file.read_text())
    manifest['model'] = {
        'url': f'https://huggingface.co/{MAIN}/resolve/{result.oid}/{GGUF_NAME}',
        'size': args.gguf.stat().st_size,
        'sha256': gguf_sha,
        'sourceRevision': result.oid,
        'checkpointSha256': plan['checkpointFiles']['model.safetensors'],
        'quantization': 'Q8_0',
        'revision': result.oid,
    }
    manifest_file.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Published {MAIN} at immutable revision {result.oid}; installer manifest pinned to it')


if __name__ == '__main__':
    main()
