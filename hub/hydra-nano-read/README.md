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
- code-slicing
---

# Hydra Nano · Read head

> **This head is served by [Hydra Nano](https://huggingface.co/rahul05ranjan/hydra-nano-git).** Download and run that model. The weights stored in this repository are an earlier shared checkpoint that the Hydra installer no longer uses. They are kept so that old links and revisions keep working.

**Returns one function, a line range or an outline of a file instead of the whole file.**

The `read` head is part of [Hydra](https://github.com/rahul05ranjan/hydra), a CLI that a coding agent calls instead of running noisy commands itself. The model picks from a fixed, read-only menu; code runs the command and returns its own output lines.

```bash
npx --yes --package=github:rahul05ranjan/hydra hydra-install
hydra read src/auth.ts login
```

## Evaluation (Hydra Nano v2, Q8_0 GGUF)

| Set | Solved |
|---|---|
| Development | 199/200 (99.5%) |
| Held-out | **961/1,000 (96.1%)** |

Most read requests are answered by deterministic slicing with no model call. Explicitly requested ranges, symbols and outlines are returned whole.

A task counts as solved only when every expected fact is returned and nothing forbidden is. Development, held-out and training data are separate. See the [Hydra Nano model card](https://huggingface.co/rahul05ranjan/hydra-nano-git) for the evaluation method, the training history, the other heads and the limitations.

## License

Apache 2.0
