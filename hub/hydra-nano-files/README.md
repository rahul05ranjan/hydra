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
- search
---

# Hydra Nano · Files head

> **This head is served by [Hydra Nano](https://huggingface.co/rahul05ranjan/hydra-nano-git).** Download and run that model. The weights stored in this repository are an earlier shared checkpoint that the Hydra installer no longer uses. They are kept so that old links and revisions keep working.

**Finds where a symbol is defined and used, ranking definitions above imports, tests and generated or archived copies.**

The `files` head is part of [Hydra](https://github.com/rahul05ranjan/hydra), a CLI that a coding agent calls instead of running noisy commands itself. The model picks from a fixed, read-only menu; code runs the command and returns its own output lines.

```bash
npx --yes --package=github:rahul05ranjan/hydra hydra-install
hydra ask --head files "where is parseConfig defined?"
```

## Evaluation (Hydra Nano v2, Q8_0 GGUF)

| Set | Solved |
|---|---|
| Development | 192/200 (96.0%) |
| Held-out | **980/1,000 (98.0%)** |

Real CPython 3.13.5, Node.js 22.16.0, Go 1.24.4 and Rust 1.88.0 sources. The model chooses search terms; ripgrep and code do the search.

A task counts as solved only when every expected fact is returned and nothing forbidden is. Development, held-out and training data are separate. See the [Hydra Nano model card](https://huggingface.co/rahul05ranjan/hydra-nano-git) for the evaluation method, the training history, the other heads and the limitations.

## License

Apache 2.0
