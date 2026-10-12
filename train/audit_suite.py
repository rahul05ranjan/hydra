"""Read-only Hub audit. No weight download, inference, upload or training."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download

HEADS = ('git', 'files', 'read', 'test', 'os')
ROOT = Path(__file__).resolve().parents[1]


def inspect_head(head):
    repo = f'rahul05ranjan/hydra-nano-{head}'
    info = HfApi().model_info(repo, files_metadata=True)
    files = []
    for item in info.siblings:
        lfs = item.lfs
        files.append({'path': item.rfilename, 'size': item.size, 'gitBlobId': item.blob_id,
                      'sha256': lfs.sha256 if lfs else None})
    config_path = hf_hub_download(repo, 'config.json', revision=info.sha)
    card_path = hf_hub_download(repo, 'README.md', revision=info.sha)
    config = json.loads(Path(config_path).read_text(encoding='utf-8'))
    card_bytes = Path(card_path).read_bytes()
    card = card_bytes.decode('utf-8')
    claims = [line.strip() for line in card.splitlines()
              if any(word in line.lower() for word in
                     ('95%', '100%', 'fine-tun', 'trained', 'solved', 'lora', '87.4', '83.5'))]
    return {'head': head, 'repo': repo, 'revision': info.sha, 'files': files,
            'architectures': config.get('architectures'), 'modelType': config.get('model_type'),
            'textModelType': config.get('text_config', {}).get('model_type'),
            'cardSha256': hashlib.sha256(card_bytes).hexdigest(), 'cardClaims': claims,
            'inferenceValidatedByThisAudit': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path,
                        default=ROOT / 'evals/results/suite/artifact-audit.json')
    args = parser.parse_args()
    with ThreadPoolExecutor(max_workers=5) as pool:
        models = list(pool.map(inspect_head, HEADS))
    groups = {}
    for model in models:
        for file in model['files']:
            if file['path'].endswith('.safetensors') and file['sha256']:
                groups.setdefault(file['sha256'], []).append(model['head'])
    result = {'timestamp': datetime.now(timezone.utc).isoformat(), 'models': models,
              'identicalSafetensorsGroups': list(groups.values()),
              'scope': 'Hub provenance only; metadata or identical weights do not prove inference correctness.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'models': [{'head': m['head'], 'revision': m['revision'],
                                  'ggufFiles': sum(f['path'].endswith('.gguf') for f in m['files'])}
                                 for m in models], 'identicalSafetensorsGroups': result['identicalSafetensorsGroups'],
                      'receipt': str(args.output)}, indent=2))


if __name__ == '__main__':
    main()
