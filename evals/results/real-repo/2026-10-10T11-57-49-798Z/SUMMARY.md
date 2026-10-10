# Repeated real-repository trial

Status: complete. Protocol comparable: true.

Completed sessions: 36/36. Elapsed: 513.9 seconds.

| Arm | Correct | Adopted Hydra | Reported input | Reported output | Total tokens | Cost equivalent |
|---|---:|---:|---:|---:|---:|---:|
| plain | 12/12 | 0/12 | 373459 | 13656 | 387115 | $0.8316 |
| available | 12/12 | 0/12 | 377679 | 13617 | 391296 | $0.7706 |
| forced | 12/12 | 12/12 | 650598 | 16705 | 667303 | $1.1074 |

## Equal-correctness pairs

- available: 12 eligible pairs; token reduction -1.08%; exploratory task-cluster 95% interval -1.16 to -0.98.
- forced: 12 eligible pairs; token reduction -72.38%; exploratory task-cluster 95% interval -103.88 to -45.58.

## Limits

- Four real-source extraction tasks, not a broad end-to-end coding-workload benchmark; source snapshots contain no project config, data or installed dependencies.
- Byte-exact source plus file and line numbers is the predeclared correctness criterion. Incomplete source cannot earn a saving.
- Three repeated fresh sessions per task/arm; uncertainty is clustered by task, with only four distinct tasks. Intervals are exploratory.
- The available arm measures skill availability and actual use; forced is explicit instruction. Skills not loaded invalidate the protocol.
- All outcomes are retained. Pairwise equal-correctness subsets and full-triplet matched results were declared before calls.
- Cached and uncached input are both counted. Cost equivalents depend on cache reuse and do not measure the Pro allowance.

Gold, source hashes and order are in [plan.json](plan.json) and [manifest.json](manifest.json). Session events are in `traces/`. Full results: [report.json](report.json).
