---
language:
- en
license: apache-2.0
pipeline_tag: text-generation
base_model: rahul05ranjan/hydra-nano-git
tags:
- hydra
- coding-agent
- tool-use
- read-only
- system
---

# Hydra Nano · OS head

> **This head is served by [Hydra Nano](https://huggingface.co/rahul05ranjan/hydra-nano-git).** Download and run that model. The weights stored in this repository are an earlier shared checkpoint that the Hydra installer no longer uses. They are kept so that old links and revisions keep working.

**Answers questions about listening ports, processes, disk, memory, OS version and environment variables through read-only probes.**

The `os` head is part of [Hydra](https://github.com/rahul05ranjan/hydra), a CLI that a coding agent calls instead of running noisy commands itself. The model picks from a fixed, read-only menu; code runs the command and returns its own output lines.

```bash
npx --yes --package=github:rahul05ranjan/hydra hydra-install
hydra ask --head os "what is listening on port 5432?"
```

## Evaluation (Hydra Nano v2, Q8_0 GGUF)

| Set | Solved |
|---|---|
| Development | 200/200 (100%); extended 397/400 (99.25%) |
| Held-out | **1,000/1,000 (100%)** |

Probe outputs in the evaluation are synthetic Windows, macOS and Linux fixtures; the secret guardrail is the real one. Environment variables whose names look like keys, tokens, passwords or credentials are refused. On macOS and Windows the memory probe does not yet report swap.

A task counts as solved only when every expected fact is returned and nothing forbidden is. Development, held-out and training data are separate. See the [Hydra Nano model card](https://huggingface.co/rahul05ranjan/hydra-nano-git) for the evaluation method, the training history, the other heads and the limitations.

## License

Apache 2.0
