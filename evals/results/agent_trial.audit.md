# Local trial evidence review

Date: 2026-10-10. Source: `agent_trial.json`, captured at 10:43:55 UTC (16:13:55 IST).

The user-requested 12-scenario rerun used `hydra-qwen3.5:0.8b-plan` and completed in 3.99 seconds. All raw/Hydra command pairs returned the expected exit codes. The passing suite reported 26 tests passed and 0 failed; the synthetic failing log returned exit 1 in both executions.

Estimated output size fell from 9,806 to 2,619 tokens, a 73.3% reduction. This uses `ceil(characters / 4)`, not a frontier-model tokenizer. The older result is preserved in `agent_trial.previous.json`. Current source sizes and model outputs differ from that older run.

## Answer problems visible in the captured outputs

1. `git_last_commit`: raw git output shows commit `52c8833e4cb77c3af608855c9d44883f8e373933` changes only `TRACKER.md`. Hydra's verbatim evidence includes that filename, but its sentence says: "The last commit changed the README and trial script to stay out of public copy." That sentence misstates which files changed.
2. `git_recent_commits`: the scenario is labelled as asking for five recent commits. Hydra returns `52c8833`, `ec1ae86`, and `0301399`, then says "7 more lines not shown". The next two commits in the raw output, `d494d73` and `839c0c5`, are absent. The actual prompt says "show recent commits" without a number, so even the scenario label and prompt disagree.
3. `run_test_failure`: the assertion, expected/received values, test name, and source location are preserved. The model additionally infers that authentication credentials are not being validated or rejected. The artificial log does not establish that cause.

The legacy target check still reports 12/12 because it looks for one substring such as `commit`, and passes automatically for an empty raw output. This score is not a full answer-accuracy measurement.

## Comparison limitations

- Three read baselines use whole-file `cat` even when Hydra receives a symbol, line range, or outline request.
- The recent-commits raw baseline requests 15 entries; Hydra internally requests 10 and returns 3.
- Search baselines inspect only `skills/hydra`, while Hydra searches the whole project. Hydra search output grows from 65 to 539 estimated tokens in aggregate.
- The runner calls commands directly; no frontier agent participates, and actual agent token usage, retries, adoption, and usage-limit reduction are unmeasured.

The rerun confirms substantial output reduction under these commands. It does not establish savings at equal correctness.
