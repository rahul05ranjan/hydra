# MLX export / llama.cpp diagnosis, 2026-10-12

The published source checkpoint is a fused MLX export, not a directly loadable
Transformers checkpoint. Its `language_model.` prefix, convolution dimensions,
and RMSNorm convention require adaptation. An obsolete shard index also points
away from the actual single `model.safetensors` file.

MLX's [Qwen3.5 sanitize code](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/models/qwen3_5.py)
adds one to HF RMSNorm weights when converting to MLX. MLX then stores the actual
multiplier. HF and pinned llama.cpp b11563 expect the offset representation and
add one during inference/conversion. Passing the MLX export straight to the
HF-to-GGUF converter therefore adds one twice. `train/normalize_mlx.py` reverses
the export transformations before conversion; it preserves learned multipliers.
Gated linear-attention norm weights do not use this offset and remain unchanged.

An independent transport bug sent `response_format.schema` with type
`json_schema`; b11563 reads `response_format.json_schema.schema`. The runtime
now uses the nested schema and rejects replies missing required fields.

## Local evidence

- Original source revision: `05d850ee62e55e2921e9ec970a9636109daa85e7`.
- Original Q8 SHA-256: `6c3fd0a7d4a74cb72c54633ab73d338c1a6d08b25219be1c41bababf34dffd9a`.
- Corrected Q8 candidate SHA-256: `2e2b4c019247e71762ef412b5489436e3dbffc92bd23f5815624207dc0e93886`.
- Both GGUF files are 811,843,136 bytes; candidates are kept separately.
- Schema repair alone: four development smoke questions chose wrong probes,
  0/4. Receipt: `llamacpp-schema-fix-smoke.json`.
- Corrected export: same four questions, 4/4 correct probes. Receipt:
  `llamacpp-normalized-smoke.json`.
- One question per development intent: 20/20 valid JSON replies, 15/20 matching
  plans including default probe arguments. Receipt:
  `normalized-development-plans.json`. This bypasses evidence execution and is
  **not an end-to-end or sealed score**.
- 58/58 Node tests and 2/2 Python normalization invariant tests pass.

The historical 283/989 partial sealed result remains archived. It measured the
old GGUF and old schema payload; it does not score the corrected candidate.
No sealed failure rows informed these fixes. No additional training has run.

## Kaggle comparison

Private kernel `rahulswt7/hydra-q8-development-diagnosis`, version 4, compares
correctly mapped original safetensors with the **old** GGUF on the same 20
development questions. It does not yet evaluate the corrected GGUF on GPU.
Attempts 1-3 stopped before scored replies because of loader/script errors
(missing import, tokenizer return type, meta rotary buffers). The final attempt
has a 750-second cap, keeping the attempts within the approved 1200-second
combined execution budget. It stopped at the deadline after 19/20 comparisons
(740.7 seconds including shutdown; 746.2 seconds through notebook rendering).
The old GGUF selected matching plans on 3/19 and produced valid full JSON on
16/19. Correctly mapped original weights produced a first JSON object on 19/19,
with matching plans on 15/19, but **zero full replies were valid JSON**: the
diagnostic harness used model-config EOS 248044 instead of tokenizer chat EOS
248046, so generation continued after the assistant's answer. First-object
counts are diagnostic evidence only, not a clean-response score. The harness
now explicitly uses tokenizer EOS for future runs; no additional GPU retry ran.

Receipts: `kaggle-q8/diagnosis.json`, `kaggle-q8/diagnosis-summary.json`, and
`kaggle-q8/diagnosis-attempt*-failure.json`. No complete 20-task comparison or
corrected sealed score is available. Combined logged execution including
rendering stayed below the approved 20 minutes; queue/upload time was longer.

Prepared next validation, not launched: corrected Q8 candidate on all 200
development tasks; proceed to 1000 sealed tasks only if development solved
accuracy reaches 68%, under one combined 30-minute Kaggle cap. Below that gate,
inspect development evidence before deciding whether training is necessary.

## Completed corrected validation

Private kernel `rahulswt7/hydra-q8-corrected-validation` version 3 completed all
200 development and 1000 sealed tasks on T4. Development solved 167/200 (83.5%),
plan 85%; sealed solved 874/1000 (87.4%), weighted 86.83%, plan 87.8%, with zero
errors/timeouts. Job elapsed 330.3 seconds; all attempts stayed within the
original 30-minute execution approval. Frozen hashes and GPU evidence passed.
See `kaggle-corrected/SUMMARY.json`; only sealed aggregates were inspected.

Before final scoring, development generation was made reproducible by pinning
committer/stash/ahead dates. Gold worktree paths became portable and stash
facts came from Git read-back. The earlier 119/200 development receipt retains
these measurement limitations. Runtime changes retain exact named blame lines
and use development-guided planning examples. All 61 Node tests plus two
normalization invariant tests pass. The model received no further training.
The validated normalized GGUF is published at immutable Hub revision ff1c723fa36adaad7b04d0dd3441208e80db9086 and pinned as the installer default. Both commit-pinned and generic remote npx installations passed on Windows; installed doctor, actual Git query and model hash/revision verification passed. See remote-bootstrap-validated.json.
