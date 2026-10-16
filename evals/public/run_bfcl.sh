#!/usr/bin/env bash
# BFCL v4 non-live, live and multi-turn categories (the ones that need no third-party API key) for
# Qwen3.5-family models served by llama.cpp. Usage:
#   evals/public/run_bfcl.sh <out_dir> <name=port=hf_dir> [...]
# Each model needs a llama-server already listening on its port.
set -euo pipefail
OUT=$1; shift
HERE=$(cd "$(dirname "$0")" && pwd)
PY=${HYDRA_BUILD:-$HOME/.hydra/build}/bench-bfcl/bin/python
run() {
  local name=$1 port=$2 model=$3
  export BFCL_PROJECT_ROOT="$OUT/$name" LOCAL_SERVER_PORT=$port
  mkdir -p "$BFCL_PROJECT_ROOT"
  "$PY" "$HERE/bfcl_qwen35.py" generate --model "$name-FC" --local-model-path "$model" --skip-server-setup \
    --test-category non_live,live,multi_turn --num-threads 4 > "$BFCL_PROJECT_ROOT/generate.log" 2>&1
  "$PY" "$HERE/bfcl_qwen35.py" evaluate --model "$name-FC" --test-category non_live,live,multi_turn \
    > "$BFCL_PROJECT_ROOT/evaluate.log" 2>&1
  echo "$name done $(date -u +%FT%TZ)"
}
for spec in "$@"; do
  IFS='=' read -r name port model <<< "$spec"
  run "$name" "$port" "$model" &
done
wait
