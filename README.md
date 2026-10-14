# Hydra

Small local models that a frontier coding agent (Claude Code, Codex) hands routine repo work to, so the raw output of that work never enters the frontier model's context.

Hydra version 0.1 provides five specialist heads powered by the local **Hydra Nano** model family (`hydra-nano:git`, `hydra-nano:os`, `hydra-nano:test`, `hydra-nano:read`, `hydra-nano:files`), also hosted on Hugging Face at [`rahul05ranjan/hydra-nano-git`](https://huggingface.co/rahul05ranjan/hydra-nano-git):
1. **git head** (`hydra-nano:git`): inspects repository history, branch sync, diffs, blame, and status.
2. **files head** (`hydra-nano:files`): fast definition-ranked code search without cluttering context.
3. **read head** (`hydra-nano:read`): extracts symbol definitions (functions, classes, methods), line ranges, or structural definition outlines across TypeScript, JavaScript, Python, Rust, and Go without dumping whole multi-thousand-line files into context.
4. **test & logs head** (`hydra-nano:test`): runs test and compiler suites (`npm test`, `pytest`, `cargo test`, `tsc`), strips framework noise and `node_modules` stacks, and returns verbatim failure diffs and source lines with the command's exit code.
5. **os head** (`hydra-nano:os`): read-only system inspection (ports, processes, disk, system info) with strict secret-blocking guardrails.

## How a call works

```
agent ── hydra ask --head git "<question>" ──────▶ git head    model picks probes from a menu, code runs them
agent ── hydra ask --head files "<question>" ────▶ files head  model picks search terms, code searches
agent ── hydra read <file> [symbol|--lines] ─────▶ read head   pinpoints symbol/lines, extracts outline
agent ── hydra run -- <test/build-command> ──────▶ test head   runs locally, digests failures & diffs
agent ◀── verbatim evidence lines ──────────────── model picks lines; the agent interprets them
```

- **Read-only and safe**: The model never writes an arbitrary command. It picks from fixed menus or digests command output.
- **Verbatim evidence**: Results are the command's own text lines, never a paraphrase.
- **Complete lists**: Git status, history, branches, remotes, stashes, tags and worktrees retain every returned record. Explicit commit counts override the model's count (maximum 50).
- **Pass-through**: Output under 800 characters is handed over whole with zero model calls.
- **Preserved exit codes**: `hydra run -- <cmd>` preserves `<cmd>`'s exit code, so agents know immediately if a build or test failed.

On Windows, OS inspection uses fixed read-only netstat, tasklist and PowerShell CIM commands, plus Node system/memory APIs. Process output is capped at 30 records and is not sorted by CPU usage. Failed probes are marked in the returned evidence. Code search ranks current source ahead of archived evaluation results while keeping those results searchable.

## Try it

Needs Node 18 or later and [llama.cpp](https://github.com/ggml-org/llama.cpp) (the default backend). [Ollama](https://ollama.com/download) is optional; select it with `HYDRA_BACKEND=ollama`.

### Run without Ollama

**Hydra Nano v2 (2026-10-14):** the installer pins the Q8_0 GGUF of a full-parameter Git fine-tune at Hub revision `8129125f` (SHA-256 `6d6542c8…`). It solves **927/1,000 sealed Git tasks (92.7%; 92.16% usage-weighted)** and, on 1,000-task held-out sets, Files 98.0%, Read 96.1%, Test 94.4% and OS 100% (synthetic probe outputs). See the [model card](https://huggingface.co/rahul05ranjan/hydra-nano-git) and the receipts in [`evals/results/suite/v2-6d6542c8`](evals/results/suite/v2-6d6542c8) and [`final-git-validation`](evals/results/suite/final-git-validation/SUMMARY.json). The previous v1 artifact (87.4% sealed) stays at Hub revision `ff1c723f`.

`train/publish_release.py` publishes a validated release: it checks the checkpoint and GGUF against the frozen validation receipt, uploads them with the model cards in [`hub/`](hub), and pins `runtime-manifest.json` to the new revision. The GGUF is reproducible with llama.cpp `convert_hf_to_gguf.py` at commit `a05e58c` (`--outtype q8_0`). Safetensors files cannot be passed directly to `llama-server`.

Start the server in one terminal:

```powershell
llama-server -m C:\models\hydra-nano-git.gguf --alias hydra-nano:git --host 127.0.0.1 --port 8080 -c 8192
```

In another PowerShell terminal:

```powershell
$env:HYDRA_BACKEND = 'llamacpp'
$env:HYDRA_LLAMA_URL = 'http://127.0.0.1:8080'
$env:HYDRA_MODEL = 'hydra-nano:git'
node skills/hydra/scripts/hydra.mjs doctor
node skills/hydra/scripts/hydra.mjs ask --head git "which branch am I on?"
```

On macOS/Linux, set the same variables with `export HYDRA_BACKEND=llamacpp`, `export HYDRA_LLAMA_URL=http://127.0.0.1:8080` and `export HYDRA_MODEL=hydra-nano:git`.

The URL is the server root, without `/v1`. `HYDRA_MODEL` must match the server alias; setting it sends all model-backed heads to that one model and does not create specialist weights. Without this override, Hydra requests its existing per-head model names; your server must serve those aliases. `hydra doctor` verifies the effective configured names. `hydra setup` with this backend prints instructions without installing or starting anything.

Hydra uses llama.cpp's [schema-constrained chat API](https://github.com/ggml-org/llama.cpp/tree/master/tools/server#post-v1chatcompletions-openai-compatible-chat-completions-api), disables thinking, and limits replies to 512 tokens. The model still chooses fixed read-only probes. HTTP fixture tests and native Windows Q8 inference/bootstrap checks pass; sealed accuracy on the converted runtime is tracked separately.

### Run with Ollama

Set `HYDRA_BACKEND=ollama` first (`$env:HYDRA_BACKEND = 'ollama'` in PowerShell; `export HYDRA_BACKEND=ollama` in Bash).

```bash
# 1. Download the small local model (1.2 GB)
node skills/hydra/scripts/hydra.mjs setup

# 2. Ask questions about any repo
cd <any git repository>
node <path>/skills/hydra/scripts/hydra.mjs ask "who changed package.json most recently and why?"

# 3. Slice files, symbols, or show structural outlines
node <path>/skills/hydra/scripts/hydra.mjs read src/index.ts handleRequest
node <path>/skills/hydra/scripts/hydra.mjs read src/server.ts --lines 20-50
node <path>/skills/hydra/scripts/hydra.mjs read src/config.py --outline

# 4. Run test and build commands through hydra
node <path>/skills/hydra/scripts/hydra.mjs run -- npm test
node <path>/skills/hydra/scripts/hydra.mjs run -- pytest

# 5. View token savings
node <path>/skills/hydra/scripts/hydra.mjs stats
```

## Install as a skill

Everything an agent needs is inside `skills/hydra`:

```bash
npx skills add rahul05ranjan/hydra --skill hydra
```

This installs the skill instructions and bundled Node CLI. It does **not** install `llama-server`, download weights or start inference: the [skills installer](https://github.com/vercel-labs/skills) copies/links skill files, and [install lifecycle hooks](https://github.com/vercel-labs/skills/issues/1155) remain a feature request. The bundled CLI can run `read` and `search` immediately; model-backed calls need the runtime described above.

A complete bootstrap is provided separately:

```bash
npx --yes --package=github:rahul05ranjan/hydra hydra-install
```

It installs the skill globally for Codex by default (use `--agent claude-code` for Claude Code), downloads a pinned llama.cpp runtime and the approximately 812 MB Hydra Nano Git Q8 GGUF, verifies SHA-256 hashes, and writes configuration under `~/.hydra`. Node 18+ with npm is required. Windows x64/arm64 CPU, macOS x64/arm64, and Ubuntu-compatible Linux x64/arm64 runtime artifacts are supported. Windows has live verification; other platform packages have not been exercised here.

The first bootstrap shares the Git model across all model-backed heads; it does not download five specialist weights. Runtime downloads and configuration stay outside agent skill folders, so skill updates retain them. Hydra starts its managed server on `127.0.0.1:11435` when needed; it stays running until `hydra stop` or a reboot. Run the installed `scripts/hydra.mjs doctor` to check readiness. `HYDRA_HOME` changes the data/config directory; explicit backend, URL and model environment variables override managed defaults.

From a local checkout, run `node skills/hydra/scripts/install.mjs`. After skill-only installation, run the installed `scripts/install.mjs --runtime-only`. The code and immutable GGUF are published. The remote bootstrap was verified on Windows on 2026-10-12, including installed-skill readiness and model hash verification; see [the receipt](evals/results/remote-bootstrap-windows.json).

For Kaggle evaluation, put `KAGGLE_USERNAME` and `KAGGLE_API_TOKEN` in root `.env` using [`.env.example`](.env.example). `train/kaggle/control.py` loads that file, prepares private frozen inputs, and separates upload from GPU execution. `run --approved` is only for an explicitly approved 30-minute evaluation; the kernel trains nothing, verifies source/model hashes, and rejects CPU fallback. Tokens are never embedded in the uploaded source bundle.

Or copy `skills/hydra` directly to your agent's skills directory:
- Claude Code: `~/.claude/skills/hydra`
- Antigravity: `~/.gemini/config/skills/hydra`

## Evaluations & Benchmarks

### Strict comparison against targeted commands

`npm run eval:strict` creates an isolated development repository, executes 12 tasks through concise direct commands and Hydra, and checks complete source slices, file sets, ordered commit records, failure/pass facts and exit codes. It uses no sealed `git1` inputs. The latest run passed **12/12 on both routes**, but Hydra returned **866 estimated tokens versus 460** for targeted commands (**88.3% more output**). These are character-count estimates and do not measure actual frontier-agent usage.

The older whole-file trial is retained as a historical result; its weak substring score is not answer accuracy. See `TRACKER.md` for the audit.

The first actual Claude Code A/B run used `claude-opus-5-5`, with **6/6 correct in each arm**. Direct tools consumed **118,215** reported input-plus-output tokens and Hydra **112,431** (**4.89% fewer**). Trace review found that the harness denied a legitimate direct `git diff-tree` attempt; permission-denial-free pairs instead consumed **2.63% more tokens with Hydra**. This six-task single-run fixture does not establish general savings. The whitelist and workspace isolation have been corrected for future runs. The [frontier report](evals/results/frontier/2026-10-10T11-08-52-051Z/SUMMARY.md) includes the limitations and links to full traces.

`npm run eval:frontier:prepare` prepares a six-task Claude Code A/B trial without model calls. `npm run eval:frontier` launches 12 fresh sessions after user approval, with direct tools versus explicit Hydra delegation. It records exact structured-answer checks, actual reported input/output tokens including cached input, cost, tool errors, tool calls, turns and elapsed time. Sessions use isolated copies of the fixture, the same configured frontier model, a frozen Hydra runtime, a $0.50 budget setting per session and a 10-minute overall time limit. This measures repository-inspection tasks in a controlled fixture; spontaneous skill adoption and full software-development workloads require further trials.

`node evals/trial/analyze_frontier.mjs <run-directory>` independently checks saved answers against gold and reports overall and permission-denial-free pairs without new model calls. Fixture workspaces live under `~/.hydra/trials/frontier`, outside this project.

### Repeated real-source and natural-adoption trial

`npm run eval:real:prepare` freezes four function-extraction tasks from Vasuki and Dhruv CLI, independent parser gold, source hashes and the production skill. The 69-file source corpus has 9,375 lines. Three fresh sessions per task compare native tools, Hydra available without a usage instruction, and explicit Hydra delegation: **36 sessions** with a **20-minute** deadline and **$18** total configured API-cost-equivalent budget. This tests source inspection and complete function extraction.

After explicit run approval, use `npm run eval:real -- --prepared <directory>`. The runner checks startup skill discovery, unchanged sources and models, and permission errors; it preserves every factual failure. `node evals/trial/analyze_real_repo.mjs <directory>` audits saved traces without model calls. See the [predeclared protocol](evals/trial/REAL_REPO_PROTOCOL.md) for arm ordering, exact correctness and exploratory task-cluster intervals.

The approved run completed **36/36 sessions**, with **12/12 correct in every arm** and no protocol violations. Native tools used **387,115** total reported tokens, skill availability **391,296 (+1.08%)**, and explicit Hydra delegation **667,303 (+72.38%)**. Claude chose Hydra in **0/12** available sessions and **12/12** forced sessions. Runtime was **513.9 seconds** and reported API-cost equivalent **$2.7095**. Token savings were absent on these four tasks. Trace audit found Python symbol slices that included unrelated code or omitted part of the function; native fallback restored complete answers. See the [full report](evals/results/real-repo/2026-10-10T11-57-49-798Z/SUMMARY.md) and [evidence audit](evals/results/real-repo/2026-10-10T11-57-49-798Z/AUDIT.md).

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

## Layout

- `skills/hydra/SKILL.md`: tells an agent when to delegate and how to read the result.
- `skills/hydra/scripts/hydra.mjs`: the CLI.
- `skills/hydra/scripts/lib/`:
  - `runtime.mjs`: selectable Ollama/llama.cpp API client and per-head model configuration.
  - `route.mjs`: route questions between heads.
  - `git.mjs`: git head probes and plan step.
  - `files.mjs`: search and walk head.
  - `read.mjs`: file slice and symbol reader head.
  - `test_logs.mjs`: test runner and build log reader head.
  - `answer.mjs`: verbatim line selection and lead generation.
  - `ollama.mjs`: compatibility exports for existing evaluation callers.
  - `ledger.mjs`: local token accounting ledger.
- `test/`: unit test suite (`npm test`).
- `evals/git1/`: 1000-task sealed test set for git head.
- `evals/test_logs/`: 20-task cross-language benchmark for test and build logs.
- `evals/read/`: 20-task cross-language benchmark for file slice reading.
