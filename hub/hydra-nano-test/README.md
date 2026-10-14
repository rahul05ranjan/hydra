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
| Development | 198/200 (99.0%) |
| Held-out | **944/1,000 (94.4%)** |

Covers Vitest, Jest, pytest, unittest, cargo, Go, tsc, node:test, Mocha, JUnit, xUnit and Minitest layouts. Small failure regions are returned whole with no model call; the model only trims long ones. Held-out failures are not inspected, so read the raw log when a digest looks incomplete.

A task counts as solved only when every expected fact is returned and nothing forbidden is. Development, held-out and training data are separate. See the [Hydra Nano model card](https://huggingface.co/rahul05ranjan/hydra-nano-git) for the evaluation method, the training history, the other heads and the limitations.

## License

Apache 2.0
