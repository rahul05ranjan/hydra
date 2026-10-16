#!/usr/bin/env bash
# Public multiple-choice benchmarks (MMLU, ARC-Challenge, HellaSwag) through lm-evaluation-harness,
# scored by log-likelihood on the bf16 Hugging Face weights. Runs base Qwen3.5-0.8B and Hydra Nano
# with identical settings so the difference is what fine-tuning changed. Usage:
#   evals/public/run_lmeval_ll.sh <out_dir> <name=model_dir> [<name=model_dir> ...]
set -euo pipefail
OUT=$1; shift
BUILD=${HYDRA_BUILD:-$HOME/.hydra/build}
# transformers' threaded weight loading segfaults when it places tensors straight onto MPS.
export HF_DEACTIVATE_ASYNC_LOAD=1
for pair in "$@"; do
  name=${pair%%=*}; model=${pair#*=}
  "$BUILD/bench-lmeval/bin/python" -m lm_eval --model hf \
    --model_args "pretrained=$model,dtype=bfloat16" --device mps --batch_size 16 \
    --tasks mmlu,arc_challenge,hellaswag --num_fewshot 0 --seed 1234 \
    --output_path "$OUT/$name" > "$OUT/$name.log" 2>&1
  echo "$name done $(date -u +%FT%TZ)"
done
