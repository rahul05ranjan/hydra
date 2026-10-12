"""Convert a fused MLX Qwen3.5 text export to HF tensor conventions."""
import argparse
import json
from pathlib import Path
import shutil

import torch
from safetensors.torch import load_file, save_file

NORM_SUFFIXES = ('.input_layernorm.weight', '.post_attention_layernorm.weight',
                 'model.norm.weight', '.q_norm.weight', '.k_norm.weight')


def normalize(weights):
    if not any(key.startswith('language_model.') and key.endswith('.conv1d.weight') and value.shape[-1] == 1
               for key, value in weights.items()):
        raise ValueError('Expected an unquantized MLX Qwen3.5 export, not an HF checkpoint')
    result = {}
    for key, tensor in weights.items():
        key = key.removeprefix('language_model.')
        if key.endswith('.conv1d.weight'):
            tensor = tensor.transpose(1, 2).contiguous()
        elif key.endswith(NORM_SUFFIXES):
            # MLX RMSNorm stores the multiplier; HF stores multiplier minus one.
            tensor = tensor.float() - 1.0
        result[key] = tensor
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    if args.destination.exists():
        raise ValueError('Destination already exists; preserve previous artifacts')
    args.destination.mkdir(parents=True)
    for file in args.source.iterdir():
        if file.is_file() and file.suffix in ['.json', '.jinja', '.txt'] and not file.name.endswith('.index.json'):
            shutil.copyfile(file, args.destination / file.name)
    config = json.loads((args.source / 'config.json').read_text())['text_config']
    config.update(architectures=['Qwen3_5ForCausalLM'], model_type='qwen3_5_text')
    (args.destination / 'config.json').write_text(json.dumps(config, indent=2))
    weights = normalize(load_file(str(args.source / 'model.safetensors')))
    save_file(weights, str(args.destination / 'model.safetensors'), metadata={'format': 'pt'})
    print(f'Normalized {len(weights)} tensors; learned multipliers preserved.')


if __name__ == '__main__':
    main()
