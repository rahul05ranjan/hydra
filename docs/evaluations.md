# Evaluations and trials

How Hydra is measured. The current model's scores are summarised in the [README](../README.md#benchmarks); the receipts are under [`evals/results/`](../evals/results). Sections 1 to 3 below record the first results with the base `qwen3.5:0.8b` model, before Hydra Nano was trained, and are kept as recorded.

### Strict comparison against targeted commands

`npm run eval:strict` creates an isolated development repository, executes 12 tasks through concise direct commands and Hydra, and checks complete source slices, file sets, ordered commit records, failure/pass facts and exit codes. It uses no sealed `git1` inputs. The latest run passed **12/12 on both routes**, but Hydra returned **866 estimated tokens versus 460** for targeted commands (**88.3% more output**). These are character-count estimates and do not measure actual frontier-agent usage.

The older whole-file trial is retained as a historical result; its weak substring score is not answer accuracy. See `TRACKER.md` for the audit.

The first actual Claude Code A/B run used `claude-opus-5-5`, with **6/6 correct in each arm**. Direct tools consumed **118,215** reported input-plus-output tokens and Hydra **112,431** (**4.89% fewer**). Trace review found that the harness denied a legitimate direct `git diff-tree` attempt; permission-denial-free pairs instead consumed **2.63% more tokens with Hydra**. This six-task single-run fixture does not establish general savings. The whitelist and workspace isolation have been corrected for future runs. The [frontier report](../evals/results/frontier/2026-10-10T11-08-52-051Z/SUMMARY.md) includes the limitations and links to full traces.

`npm run eval:frontier:prepare` prepares a six-task Claude Code A/B trial without model calls. `npm run eval:frontier` launches 12 fresh sessions after user approval, with direct tools versus explicit Hydra delegation. It records exact structured-answer checks, actual reported input/output tokens including cached input, cost, tool errors, tool calls, turns and elapsed time. Sessions use isolated copies of the fixture, the same configured frontier model, a frozen Hydra runtime, a $0.50 budget setting per session and a 10-minute overall time limit. This measures repository-inspection tasks in a controlled fixture; spontaneous skill adoption and full software-development workloads require further trials.

`node evals/trial/analyze_frontier.mjs <run-directory>` independently checks saved answers against gold and reports overall and permission-denial-free pairs without new model calls. Fixture workspaces live under `~/.hydra/trials/frontier`, outside this project.

### Repeated real-source and natural-adoption trial

`npm run eval:real:prepare` freezes four function-extraction tasks from Vasuki and Dhruv CLI, independent parser gold, source hashes and the production skill. The 69-file source corpus has 9,375 lines. Three fresh sessions per task compare native tools, Hydra available without a usage instruction, and explicit Hydra delegation: **36 sessions** with a **20-minute** deadline and **$18** total configured API-cost-equivalent budget. This tests source inspection and complete function extraction.

After explicit run approval, use `npm run eval:real -- --prepared <directory>`. The runner checks startup skill discovery, unchanged sources and models, and permission errors; it preserves every factual failure. `node evals/trial/analyze_real_repo.mjs <directory>` audits saved traces without model calls. See the [predeclared protocol](../evals/trial/REAL_REPO_PROTOCOL.md) for arm ordering, exact correctness and exploratory task-cluster intervals.

The approved run completed **36/36 sessions**, with **12/12 correct in every arm** and no protocol violations. Native tools used **387,115** total reported tokens, skill availability **391,296 (+1.08%)**, and explicit Hydra delegation **667,303 (+72.38%)**. Claude chose Hydra in **0/12** available sessions and **12/12** forced sessions. Runtime was **513.9 seconds** and reported API-cost equivalent **$2.7095**. Token savings were absent on these four tasks. Trace audit found Python symbol slices that included unrelated code or omitted part of the function; native fallback restored complete answers. See the [full report](../evals/results/real-repo/2026-10-10T11-57-49-798Z/SUMMARY.md) and [evidence audit](../evals/results/real-repo/2026-10-10T11-57-49-798Z/AUDIT.md).

### 1. `evals/git1` (1000 tasks, sealed git test set)

50 generated repositories, 20 kinds of question, 10 phrasings each. Verified by git gold facts and usage weighting.

- **Baseline (`qwen3.5:0.8b`)**: 70% solved (69% weighted by real usage), plan accuracy 74%, 10 errors.
- **Improved with JSON prompt grounding**: **77% solved (76% weighted)**, plan accuracy **80%**, **0 errors**, runtime dropped from 21.2 min to **3.5 min**.
- `staged_files`: 0% ➔ 100% (+100 points)
- `message_search`: 4% ➔ 72% (+68 points)
- `commit_files`: 46% ➔ 72% (+26 points)

Full results in `evals/results/git1.qwen3.5-0.8b.json`.

### 2. `evals/test_logs` (20 cross-language tasks)

Benchmarks failure extraction and noise reduction across Vitest, Jest, Pytest, Cargo, TSC, Go, node:test, and Mocha.

- **Solved**: **100% (20/20)**
- **Test Name Recall**: **100%**
- **File / Line Location Recall**: **100%**
- **Assertion Diff Recall**: **100%**
- **Cleanliness**: **100%** (zero framework or `node_modules` stack frame pollution)
- **Token Savings**: **49.6% net token reduction** overall, and **96.4% to 96.7%** on verbose test suites.
- **Runtime**: **3.2s** across all 20 tasks.

Full results in `evals/results/test_logs.qwen3.5-0.8b.json`.

### 3. `evals/read` (20 cross-language tasks)

Benchmarks targeted symbol extraction, line range slicing, and file outlines across TypeScript, JavaScript, Python, Rust, and Go to address the #1 token sink (75.5% of tool tokens).

- **Solved**: **100% (20/20)**
- **Target Line Recall**: **100%**
- **Cleanliness**: **100%** (zero unrelated function/code leak)
- **Token Savings**: **48.1% net token reduction** overall, and **77% to 92%** on targeted line and symbol slices.
- **Runtime**: **0.01s** (instantaneous local extraction).

Full results in `evals/results/read.json`.
