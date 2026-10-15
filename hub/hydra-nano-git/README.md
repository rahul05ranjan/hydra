---
language:
- en
license: apache-2.0
library_name: transformers
pipeline_tag: text-generation
base_model: Qwen/Qwen3.5-0.8B
base_model_relation: finetune
tags:
- hydra
- coding-agent
- tool-use
- git
- read-only
- local-inference
- gguf
- llama.cpp
model-index:
- name: Hydra Nano
  results:
  - task:
      type: text-generation
      name: Read-only Git probe planning and evidence selection
    dataset:
      type: hydra/git1
      name: git1 (sealed, 1,000 tasks)
    metrics:
    - type: accuracy
      name: Solved
      value: 96.3
    - type: accuracy
      name: Solved, usage-weighted
      value: 96.17
  - task:
      type: text-generation
      name: Code search term planning (Files head)
    dataset:
      type: hydra/files-holdout
      name: Files holdout (1,000 tasks)
    metrics:
    - type: accuracy
      name: Solved
      value: 98.0
  - task:
      type: text-generation
      name: File slicing (Read head)
    dataset:
      type: hydra/read-holdout
      name: Read holdout (1,000 tasks)
    metrics:
    - type: accuracy
      name: Solved
      value: 96.1
  - task:
      type: text-generation
      name: Test and build log digestion (Test head)
    dataset:
      type: hydra/test-holdout
      name: Test holdout (1,000 tasks)
    metrics:
    - type: accuracy
      name: Solved
      value: 94.4
  - task:
      type: text-generation
      name: Read-only OS inspection planning (OS head)
    dataset:
      type: hydra/os-holdout
      name: OS holdout (1,000 tasks, synthetic probe outputs)
    metrics:
    - type: accuracy
      name: Solved
      value: 100.0
---

# Hydra Nano

**A 0.75B-parameter local model that lets a coding agent hand off routine, read-only repository work.**

Hydra Nano is the model behind [Hydra](https://github.com/rahul05ranjan/hydra), a CLI that a frontier coding agent (Claude Code, Codex and others) calls instead of running noisy commands itself. Hydra asks the model to choose from a fixed menu of read-only probes, runs those probes in code, and returns the command's own output lines. The model never writes a shell command.

One model serves all five Hydra heads:

| Head | Job | Typical question |
|---|---|---|
| `git` | Repository state, history, blame, branches | "which files changed in the last commit?" |
| `files` | Where a symbol is defined or used | "where is `parseConfig` defined?" |
| `read` | Return one function, range or outline of a file | "show `login` in src/auth.ts" |
| `test` | Digest a failing test or build log | `hydra run -- npm test` |
| `os` | Ports, processes, disk, memory, environment | "what is listening on port 5432?" |

| | |
|---|---|
| **Release** | v2, 2026-10-14 |
| **Parameters** | 752,393,024 |
| **Base model** | [Qwen/Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) |
| **Files** | `model.safetensors` (FP16, standard Transformers layout) and `hydra-nano-git-Q8_0.gguf` (llama.cpp) |
| **Context used by Hydra** | 8,192 tokens |
| **Language** | English |
| **License** | Apache 2.0 |

## Evaluation

All figures are end-to-end Hydra results: the task counts as solved only when the probe plan is right **and** the returned evidence contains every expected fact with nothing forbidden. Errors and timeouts count as failures. Every row was produced with the Q8_0 GGUF in this repository (SHA-256 `6d6542c8…410be`).

| Head | Development | Held-out | Notes |
|---|---|---|---|
| **Git** | 200/200 · extended 800/800 · paraphrase 800/800 | **963/1,000 (96.3%)** sealed `git1`; 96.17% usage-weighted | Sealed set never used for training or tuning; only its aggregate score was read. |
| **Files** | 192/200 (96.0%) | **980/1,000 (98.0%)** | Real CPython, Node.js, Go and Rust sources. |
| **Read** | 199/200 (99.5%) | **961/1,000 (96.1%)** | Most tasks are answered by deterministic slicing with no model call. |
| **Test** | 198/200 (99.0%) · extended 559/572 (97.7%) | **944/1,000 (94.4%)** | Small failure regions are returned whole; the model is called only for long ones (24 of 1,000 held-out tasks). |
| **OS** | 200/200 · extended 397/400 (99.25%) | **1,000/1,000 (100%)** | Probe outputs are synthetic Windows/macOS/Linux fixtures, not live host runs. |

- **Hardware.** All rows ran locally on an Apple Silicon laptop with llama.cpp b11563. The same GGUF scored 927/1,000 on the sealed set on an NVIDIA T4 with the earlier Hydra code.
- **Latency.** The median model call takes about 0.07 s for Files and OS on the Apple Silicon laptop.
- **Separation.** Development, held-out and training data come from separate generators, seeds and phrasings. Held-out failures were never inspected.
- **Receipts.** Every row has a JSON receipt in the [Hydra repository](https://github.com/rahul05ranjan/hydra/tree/main/evals/results/suite).

## Quick start

### With Hydra (recommended)

One command installs a pinned llama.cpp runtime, downloads this GGUF, verifies its SHA-256 and starts a local server on port 11435:

```bash
npx --yes --package=github:rahul05ranjan/hydra hydra-install
hydra ask --head git "which branch am I on and what is modified?"
hydra run -- npm test
```

### With llama.cpp

```bash
llama-server -m hydra-nano-git-Q8_0.gguf --alias hydra-nano:git --host 127.0.0.1 --port 8080 -c 8192
```

Hydra sends each request with a JSON schema (`response_format`), so llama.cpp constrains decoding to valid JSON. Do the same if you call the model yourself. Unconstrained output can be malformed JSON.

### With Transformers

```python
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

model_id = "rahul05ranjan/hydra-nano-git"
tokenizer = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(model_id, dtype=torch.float32)  # FP16 on CPU can overflow

messages = [
    {"role": "system", "content": 'Choose read-only git probes. Reply with JSON {"probes":[{"probe":...}]}. '
                                  'Probes: status, log, diff, show, blame, branches, stash, worktrees.'},
    {"role": "user", "content": "which branch am I on?"},
]
inputs = tokenizer.apply_chat_template(messages, add_generation_prompt=True, enable_thinking=False,
                                       return_tensors="pt", return_dict=True)
output = model.generate(**inputs, max_new_tokens=64, do_sample=False)
print(tokenizer.decode(output[0, inputs["input_ids"].shape[-1]:], skip_special_tokens=True))
```

On a GPU, use `dtype=torch.bfloat16` and `device_map="auto"`. The production prompts and probe menus are in [`skills/hydra/scripts/lib`](https://github.com/rahul05ranjan/hydra/tree/main/skills/hydra/scripts/lib). The model is trained on those prompts, so a different prompt gives weaker results.

## How it stays safe

- **No generated commands.** The model returns a JSON choice from a fixed menu, and code builds and runs the command.
- **Read-only menus.** No head can commit, push, reset, delete or write files.
- **Checked arguments.** A path, revision, author or search term from the model is used only if it appears in the question and the tool confirms it exists.
- **Verbatim evidence.** Results are the command's own lines. The model only chooses which lines to show, and whole lists or explicitly requested slices are returned in full.
- **Secret guardrail.** The OS head refuses environment variables whose names look like keys, tokens, passwords or credentials.

These guarantees come from the Hydra CLI. If you run the model on its own, it is just a text generator.

## Training

1. **Supervised fine-tuning with LoRA.** Qwen3.5-0.8B was tuned on synthetic Git planning prompts in MLX and the adapter was fused into the weights.
2. **Full-parameter fine-tuning, stage 1.** All 752M parameters were trained on 1,040 newly written synthetic examples covering all ten Git probes and four evidence families: 67 optimizer updates at learning rate 2e-6.
3. **Full-parameter fine-tuning, stage 2.** Training continued on 1,560 more varied examples covering phrasing, filenames, authors, references and scope combinations: 62 updates at learning rate 1e-6. The total is 129 updates.

Both full-parameter stages ran on one NVIDIA T4. They used FP32 master weights, an AdamW optimizer whose state lives on the CPU, FP16 activations with gradient checkpointing, and loss on assistant tokens only.

No evaluation inputs were used for training: no sealed `git1` worlds, phrasings or word lists, and no development or held-out tasks. The checkpoint's SHA-256 is `7b6b4662dbba3542fd296696b1c94e06240b28931e5b8ac6eec5cb99fc3dc8f0`.

The GGUF was converted with llama.cpp `convert_hf_to_gguf.py` at commit `a05e58c` (`--outtype q8_0`). Converting this checkpoint again reproduces the same file byte for byte.

## Limitations

- **Test head.** It solves 94.4% of held-out tasks, just under the 95% target. Held-out failures are not inspected, so their causes are unknown. Read the raw log when a digest looks incomplete.
- **OS evaluation is synthetic.** It tests planning and evidence on fixture outputs with the real secret guardrail. On macOS and Windows the memory probe does not yet report swap.
- **Token savings are not proven.** In a 36-session trial on real repositories, Claude Opus used Hydra in 0 of 12 sessions where it was merely available. Forcing delegation used 72% more tokens on those source-extraction tasks. Hydra is a correctness-preserving offload path; it is not a proven way to save tokens.
- **Scope.** The model was trained for Git planning and evidence only. Its behavior on the other heads comes from Hydra's prompts and code. It is not a general assistant, and English is the only language tested.

## Intended use

**Use it for:** local, read-only inspection that a coding agent delegates through Hydra, on developer machines and CI runners.

**Do not use it for:** any operation that writes, deletes or changes state; security decisions; or answering questions without the Hydra evidence path.

## Citation

```bibtex
@software{hydra_nano_2026,
  title  = {Hydra Nano: a local read-only coprocessor model for coding agents},
  author = {rahul05ranjan},
  year   = {2026},
  url    = {https://huggingface.co/rahul05ranjan/hydra-nano-git}
}
```
