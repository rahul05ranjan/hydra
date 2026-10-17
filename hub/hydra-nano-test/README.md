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
- test-logs
---

# Hydra Nano · Test head

> **This head is served by [Hydra Nano](https://huggingface.co/rahul05ranjan/hydra-nano-git).** Download and run that model. The weights stored in this repository are an earlier shared checkpoint that the Hydra installer no longer uses. They are kept so that old links and revisions keep working.

**Runs a test or build command and returns the failing test names, assertion diffs and source locations, verbatim.**

The `test` head is part of [Hydra](https://github.com/rahul05ranjan/hydra), a CLI that a coding agent calls instead of running noisy commands itself. The model picks from a fixed, read-only menu; code runs the command and returns its own output lines.

```bash
npx --yes --package=github:rahul05ranjan/hydra hydra-install
hydra run -- npm test
```

## Evaluation (Hydra Nano v2, Q8_0 GGUF)

| Set | Solved |
|---|---|
| Development | 200/200 · extended 572/572 · dev2 1,380/1,380 |
| Held-out (holdout 2) | **975/1,000 (97.5%)** |

The development sets cover more than 100 layouts across JavaScript, Python, Rust, Go, JVM, .NET, Swift, Haskell, OCaml, Zig, Julia, Dart, Elixir, PHP, Ruby, C/C++ and shell tools, with Windows paths, CI prefixes and colour codes. Small failure regions are returned whole with no model call; the model only trims long ones (50 of 1,000 held-out tasks). The first holdout (944/1,000) was scored while tuning, so a fresh holdout was written and frozen before it was scored. Held-out failures are not inspected, so read the raw log when a digest looks incomplete. These scores need Hydra code from 2026-10-16 or later.

A task counts as solved only when every expected fact is returned and nothing forbidden is. Development, held-out and training data are separate. See the [Hydra Nano model card](https://huggingface.co/rahul05ranjan/hydra-nano-git) for the evaluation method, the training history, the other heads and the limitations.

## License

Apache 2.0
