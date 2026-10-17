#!/usr/bin/env bash
# Hydra head gates on development sets only (no holdout or sealed input) for a model served by
# llama.cpp. Used to accept or reject a candidate trained from public-benchmark findings.
# Usage: evals/public/head_gates.sh <llama url> <model name> <out dir>
set -euo pipefail
URL=$1 MODEL=$2 OUT=$3
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$OUT"
export HYDRA_LLAMA_URL=$URL HYDRA_MODEL=$MODEL
cd "$ROOT"
for set in original extended paraphrase; do
  HYDRA_GIT_DEV_SET=$set node evals/run_dev.mjs > "$OUT/git-$set.log" 2>&1
done
node evals/suite/run.mjs --heads files,read,test,os --split development --output "$OUT/development.json" > "$OUT/development.log" 2>&1
node evals/suite/run.mjs --heads test,os --split extended --output "$OUT/extended.json" > "$OUT/extended.log" 2>&1
node evals/suite/run.mjs --heads test --split dev2 --output "$OUT/dev2.json" > "$OUT/dev2.log" 2>&1
echo "gates done $(date -u +%FT%TZ)"
