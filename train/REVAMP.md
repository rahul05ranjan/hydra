# Five-head improvement protocol

Target set by the user on 2026-10-12: at least 95% solved per head (Git, Files, Read, Test, OS). Full parameter fine-tuning and a replacement base are allowed when development evidence supports them. The target has not been achieved.

## Current evidence

`evals/results/suite/artifact-audit.json` pins all five Hub revisions. The four non-Git repositories share identical weights and config/tokenizer blobs. They have no GGUF. The installer currently uses the corrected Git GGUF for all model-backed heads. Distinct repository names do not establish distinct specialist training.

The existing Files and Read benchmarks mostly test deterministic code paths, not their published models. The Test benchmark accepted only half the expected assertion facts. OS had unit/native smoke tests, without a representative model benchmark. Git's frozen 1,000-task evaluation is 87.4% solved. Historical 20-task scores cannot establish the new target.

## First experiment: bounded development diagnosis

Private Kaggle T4, maximum 30 minutes including downloads, conversion and evaluation; no training, paid model API or sealed scoring. Evaluate 200 existing disjoint Git development tasks plus 20 Files, 20 Read, 20 Test and 24 OS questions. The OS planner uses deterministic fixture probe outputs and the actual environment guardrail; native Windows/Linux output correctness needs additional coverage.

Convert the standard-HF non-Git checkpoint with the pinned llama.cpp converter. Reuse that conversion only after verifying all four weights/config/tokenizer identities match, then evaluate each head's own prompts and behavior. Use the already validated corrected Git Q8 separately. No MLX norm adjustment is applied to standard-HF weights.

`evals/suite/run.mjs` records actual model calls/replies and returned evidence. Natural language Files questions exercise search-term selection and the answer path. Read questions exercise `gather` plus the actual answer path; zero calls are recorded as zero calls. Test requires every expected assertion. OS effective correctness and raw model-plan accuracy are separate so fallback cannot conceal a model error. These are diagnosis fixtures, not release holdouts.

The package allowlist excludes `evals/git1`, sealed failure receipts, `.env`, credentials and training data. All included code, model inputs and converter blobs have hashes. The job rejects CPU fallback and preserves errors/timeouts. Incomplete runs do not receive a passing score.

Prepare with `python train/kaggle/suite_control.py prepare`; upload with `... upload`. Submit `... run --approved` only after the explicit runtime notice and the user's clear yes. `--approved` records authorization; it does not create it.

## Development and release gates

After the baseline, expand task families with independent gold facts, new repository worlds, identifiers, paths, log layouts and question phrasings. Split by repository/world/template family rather than randomly dividing near-duplicate rows. Cover Windows and Linux formats, quoted/spaced paths, nested symbols, noisy/long output, multiple failures, empty results, legitimate refusal and attempts to escape the fixed menus.

Use at least 200 development and 1,000 frozen evaluation tasks per head for the final claim. Repeated template copies do not count as independent coverage. Add held-out real source/log samples and an audit of gold/scoring before freezing. Existing non-Git fixtures become development data; they cannot be relabeled as holdouts. Git retains its existing sealed set unchanged. Preserve new holdout hashes and inspect aggregate results only during tuning. Any replacement holdout after an exposed test must be disclosed.

Each head must score >=95% end-to-end solved, with errors/timeouts counted as failures. Report raw planner/evidence accuracy on model-called tasks separately, plus call counts, sample coverage, latency, output size and confidence intervals. Test exact requested facts and absence of contradictory/forbidden output; do not score only a substring or silently accept model failures. A deterministic path can satisfy a head's correctness gate but does not validate its model. Claims about an individual specialist require real model-backed coverage and exact artifact provenance.

## Model changes when needed

Use development errors to distinguish wrong task selection, unsupported parsing/slicing, evidence truncation and model/conversion defects. Repair the responsible layer; do not train a model to compensate for discarded input. Improve independent supervision and argument/evidence grounding before increasing parameter count.

The first training candidate may use full parameter supervised fine-tuning of a verified text-only HF backbone, updating embeddings and all decoder layers with no adapter-only restriction. Reuse Hydra's actual system prompts, schemas and verbatim-evidence contract; train only assistant targets and use the tokenizer's chat EOS. Save complete standalone weights and an explicit trainable/total parameter count. This is full fine-tuning, not pretraining a foundation model from scratch.

Measure GPU memory and step time in an approved short feasibility run before estimating a longer run. If full training does not fit, consider optimizer sharding/offload or a different small backbone, and measure the latency/download/memory tradeoff. A larger base or scratch architecture is an experiment, not an assumed cure. A model replacement must preserve local llama.cpp support and the fixed read-only command menu.

Candidate selection uses development results only. Compare original precision and Q8 on the same development tasks; then freeze the winning artifact/code and perform final held-out scoring. Publish per-head standalone weights/GGUF, honest model cards and immutable installer mappings only after their validation passes. Do not replace the known working default with an unverified candidate.

`train/full_finetune.py` implements a full-parameter path with FP32 weights/AdamW states, mixed-precision activations, gradient checkpointing, assistant-only loss, tokenizer chat EOS and full standalone checkpoint saving. `--preflight` hashes the declared checkpoint/data, enforces disjoint-data provenance and verifies the inference/training template prefix without training. It rejects silent truncation, unverified model assets, incomplete weight loading, CPU fallback and arbitrary command targets. Four data/prompt invariant tests pass; the real Git tokenizer prefix/EOS check is verified separately. GPU feasibility, full optimizer steps, convergence and candidate quality are not yet verified.

The user approved a ten-minute private T4 full-parameter Git feasibility experiment on 80 new synthetic samples, with up to ten optimizer updates. Attempt 1 loaded all 752,393,024 text parameters but stopped before an update on non-finite gradients. Version 2 is submitted and queued, with bounded same-batch AMP scale recovery and a 470-second execution cap that keeps the combined experiment within the original approval. No successful optimizer update or accepted checkpoint is verified yet. Longer training requires its own concrete checkpoint, data hashes, GPU count, maximum duration, quota use, stopping rule and checkpoint/output handling before approval under AGENTS.md. The parent GPU job enforces the hard runtime cap, since a single in-progress backward pass/checkpoint save cannot be interrupted by the trainer's between-step deadline check. See `TRACKER.md` and `evals/results/suite/` for the shutdown snapshot and run receipts.

## Technical references

- [Transformers Qwen3.5 documentation](https://huggingface.co/docs/transformers/main/en/model_doc/qwen3_5): text-only CausalLM class and hybrid-attention kernel requirements. This matters for full training feasibility, which differs from llama.cpp inference.
- [Pinned llama.cpp converter](https://github.com/ggml-org/llama.cpp/blob/a05e58c981ea1ec863b2f5b11bbde66f7bb7aac6/convert_hf_to_gguf.py): the conversion path used by the baseline package.
