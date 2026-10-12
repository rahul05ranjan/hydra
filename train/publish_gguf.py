"""Publish only GGUF and its provenance; retain existing Hub model files."""
import argparse
import hashlib
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from huggingface_hub import HfApi, CommitOperationAdd, get_token

ROOT = Path(__file__).resolve().parent.parent

def main():
    load_dotenv(ROOT / '.env')
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', default=str(Path.home() / '.hydra/build/hydra-nano-git-Q8_0.gguf'))
    args = parser.parse_args()
    file = Path(args.file)
    manifest_file = ROOT / 'skills/hydra/scripts/runtime-manifest.json'
    manifest = json.loads(manifest_file.read_text())
    spec = manifest['model']
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    if h.hexdigest() != spec['sha256'] or file.stat().st_size != spec['size']:
        raise ValueError('GGUF differs from pinned manifest')
    token = os.environ.get('HF_TOKEN') or os.environ.get('HUGGINGFACE_API_KEY') or get_token()
    if not token:
        raise ValueError('Log in with hf auth login or set HF_TOKEN in root .env')
    api = HfApi(token=token)
    if api.whoami()['name'] != 'rahul05ranjan':
        raise ValueError('Authenticated Hub account differs from model owner')
    card = f'''# GGUF runtime artifact

`hydra-nano-git-Q8_0.gguf` is converted from source revision `{spec['sourceRevision']}`.
Conversion/quantization uses llama.cpp `{manifest['llama']['tag']}`; SHA-256: `{spec['sha256']}`.
Size: {spec['size']} bytes. This is a format conversion and Q8_0 quantization, with no new training.

Run with a recent llama-server:

```bash
llama-server -m hydra-nano-git-Q8_0.gguf --alias hydra-nano:git --host 127.0.0.1 --port 8080 -c 8192
```

Hydra's installer verifies this file's hash. The initial bootstrap shares this Git model across heads;
it does not download five separate specialist models. Native Windows smoke checks pass;
the previous Ollama score does not establish this converted runtime's accuracy.
Token savings in actual-agent workflows remain unproven.
'''
    result = api.create_commit(repo_id='rahul05ranjan/hydra-nano-git',
        operations=[CommitOperationAdd(path_in_repo=file.name, path_or_fileobj=str(file)),
                    CommitOperationAdd(path_in_repo='GGUF.md', path_or_fileobj=card.encode())],
        commit_message='Add Q8 GGUF runtime artifact and reproducible conversion provenance')
    spec['url'] = f'https://huggingface.co/rahul05ranjan/hydra-nano-git/resolve/{result.oid}/{file.name}'
    spec['revision'] = result.oid
    manifest_file.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Published GGUF at immutable revision {result.oid}')

if __name__ == '__main__':
    main()
