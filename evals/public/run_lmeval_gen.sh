#!/usr/bin/env bash
# Public generative benchmarks (GSM8K 5-shot, IFEval) through lm-evaluation-harness against
# llama.cpp's chat endpoint on the Q8_0 GGUF, the file Hydra ships. Thinking is off, as Hydra runs.
# Usage: evals/public/run_lmeval_gen.sh <out_dir> <name=port> [...]
# Start each server with: llama-server -m <gguf> --port <port> -c 32768 -np 4 \
#   --chat-template-kwargs '{"enable_thinking":false}'
set -euo pipefail
OUT=$1; shift
PY=${HYDRA_BUILD:-$HOME/.hydra/build}/bench-lmeval/bin/python
for spec in "$@"; do
  name=${spec%%=*}; port=${spec#*=}
  "$PY" -m lm_eval --model local-chat-completions \
    --model_args "model=$name,base_url=http://127.0.0.1:$port/v1/chat/completions,num_concurrent=4,max_retries=3,tokenized_requests=False" \
    --tasks gsm8k,ifeval --apply_chat_template --fewshot_as_multiturn --seed 1234 --log_samples \
    --output_path "$OUT/$name" > "$OUT/$name.log" 2>&1 &
done
wait
echo "done $(date -u +%FT%TZ)"
