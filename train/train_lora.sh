#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="/Users/rivansh/Desktop/code/vasuki/.venv/bin/python"

export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1

rm -rf "$DIR/adapter" "$DIR/merged"

echo "==> 1. Training gentle LoRA adapter on Qwen/Qwen3.5-0.8B (scale=1.0, lr=5e-5)..."
$PYTHON -m mlx_lm lora \
  --config "$DIR/lora_config.yaml" \
  --data "$DIR/data" \
  --adapter-path "$DIR/adapter"

echo "==> 2. Fusing adapter into standalone model..."
$PYTHON -m mlx_lm fuse \
  --model Qwen/Qwen3.5-0.8B \
  --adapter-path "$DIR/adapter" \
  --save-path "$DIR/merged"

echo "==> 3. Installing into Ollama as hydra-nano:git..."
$PYTHON "$DIR/to_ollama.py" --model-dir "$DIR/merged" --name "hydra-nano:git"
ollama cp hydra-nano:git hydra-nano-git
ollama cp hydra-nano:git rahul05ranjan/hydra-nano-git
