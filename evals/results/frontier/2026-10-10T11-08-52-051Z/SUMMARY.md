# First actual frontier-agent A/B trial

Date: 2026-10-10. Frontier model: `claude-opus-5-5` in all 12 fresh sessions. Local Hydra model: `hydra-qwen3.5:0.8b-plan`, with a frozen runtime in this directory.

Six repository-inspection tasks ran in each arm: status, latest commit, five recent commits, function extraction/calculation, definition/usages search, and failing-test facts. Gold answers were fixed before calls and checked as complete structured JSON. Hydra delegation was explicitly requested in its arm; spontaneous skill adoption was not tested. The hand-written repository is a development fixture independent of sealed `git1` data.

| Measure | Direct tools | Hydra |
|---|---:|---:|
| Correct answers | 6/6 | 6/6 |
| Reported input tokens, including cache reads/creation | 116,179 | 110,115 |
| Reported output tokens | 2,036 | 2,316 |
| Total reported tokens | 118,215 | 112,431 |
| Reported API-cost equivalent | $0.4339304 | $0.3748258 |
| Session time sum | 51.786s | 51.411s |

Total reported cost equivalent was $0.8087562. This is not a Pro-account bill or a measurement of subscription allowance. Costs vary with cache reuse; the arms alternated order but had only one run per task.

## The apparent 4.89% token reduction is confounded

The harness's whitelist denied `git diff-tree` in the direct latest-commit task, causing an extra attempt. It also denied exit-code echo commands in both failure arms. These were harness restrictions, not evidence of Hydra solving the task more efficiently. The Hydra arm additionally verified some results through direct commands.

On the four pairs without permission denials (status, recent commits, code reading, search), direct tools used **67,151** total tokens and Hydra **68,920**: **2.63% more with Hydra**. This exclusion is post-hoc and does not substitute for a fresh predeclared experiment. Code reading alone saved 14.50% tokens; status, recent commits, and search increased token usage by 18.77%, 5.96%, and 6.17% respectively.

Concurrent local training was recorded in `TRACKER.md`; timing should therefore be treated as exploratory. No broad or repeated real-codebase workload was measured. The results do not establish general savings at equal correctness.

The whitelist now permits the legitimate read-only operations. Future runs use safe mode and external workspace directories. No extra account-usage run was launched after finding the confound.

## Evidence and reproduction

- [Manifest and initial command configuration](manifest.json)
- [Predeclared gold JSON](gold.json)
- [Full report, including per-session usage and independent analysis](report.json)
- [Original report before trace analysis](report.raw.json)
- [Overall, per-task and permission-denial-free comparisons](analysis.json)
- Session traces are `<task>/<arm>.jsonl`; stderr is `<task>/<arm>.stderr.txt`.
- Frozen Hydra source is under `runtime/`. Generated fixture workspaces were archived under `/Users/rivansh/.hydra/trials/frontier/2026-10-10T11-08-52-051Z`; event logs retain their original working-directory paths.

Run `node evals/trial/analyze_frontier.mjs evals/results/frontier/2026-10-10T11-08-52-051Z` from the project to repeat the offline audit. A new paid run requires the project's explicit approval workflow.
