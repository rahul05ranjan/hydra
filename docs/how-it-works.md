# How Hydra works

The detail behind the [README](../README.md): how a call runs, how to run each backend by hand, the local telemetry, every install path and the code layout. Benchmarks and trials are in [evaluations.md](evaluations.md).

## The heads

Hydra provides five specialist heads powered by the local **Hydra Nano** model family (`hydra-nano:git`, `hydra-nano:os`, `hydra-nano:test`, `hydra-nano:read`, `hydra-nano:files`), also hosted on Hugging Face at [`rahul05ranjan/hydra-nano-git`](https://huggingface.co/rahul05ranjan/hydra-nano-git):
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

**Hydra Nano v2 (2026-10-14):** the installer pins the Q8_0 GGUF of a full-parameter Git fine-tune at Hub revision `8129125f` (SHA-256 `6d6542c8…`). With the current code it solves **963/1,000 sealed Git tasks (96.3%; 96.17% usage-weighted)** (927/1,000 with the code validated on Kaggle) and, on 1,000-task held-out sets, Files 98.0%, Read 96.1%, Test 94.4% and OS 100% (synthetic probe outputs). See the [model card](https://huggingface.co/rahul05ranjan/hydra-nano-git) and the receipts in [`evals/results/suite/v2-6d6542c8`](../evals/results/suite/v2-6d6542c8) and [`final-git-validation`](../evals/results/suite/final-git-validation/SUMMARY.json). The previous v1 artifact (87.4% sealed) stays at Hub revision `ff1c723f`.

`train/publish_release.py` publishes a validated release: it checks the checkpoint and GGUF against the frozen validation receipt, uploads them with the model cards in [`hub/`](../hub), and pins `runtime-manifest.json` to the new revision. The GGUF is reproducible with llama.cpp `convert_hf_to_gguf.py` at commit `a05e58c` (`--outtype q8_0`). Safetensors files cannot be passed directly to `llama-server`.

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

### Local telemetry

Every call, hook decision, session start and failure is one JSON line in `~/.hydra/ledger.jsonl`. It records the head, the question or command, token estimates (characters / 4), seconds, the run's exit code and command time, how many times the local model ran and for how long, and the agent and session that called. Nothing leaves the machine. `HYDRA_TELEMETRY=0` turns recording off.

`hydra improve [--since <date>] [--json]` (a date or time in local time, or UTC with a trailing `Z`) reads that ledger and shows where Hydra should improve: per head, the calls that saved nothing and the p50/p90 latency; for the test hook, how many turned-back runs the agent followed with `hydra run` and which commands it pushed through with `HYDRA_RAW=1`; how many recorded sessions used Hydra; recent errors. Findings worth acting on go in `IMPROVEMENTS.md`.

## Install as a skill

Everything an agent needs is inside `skills/hydra`:

```bash
npx skills add rahul05ranjan/hydra --skill hydra
```

This installs the skill instructions and bundled Node CLI. It does **not** install `llama-server`, download weights or start inference: the [skills installer](https://github.com/vercel-labs/skills) copies/links skill files, and [install lifecycle hooks](https://github.com/vercel-labs/skills/issues/1155) remain a feature request. The bundled CLI can run `read` and `search` immediately; model-backed calls need the runtime described above.

A complete bootstrap is provided separately:

```bash
npx github:rahul05ranjan/hydra
```

It installs the skill globally for every agent it finds (Claude Code if `~/.claude` exists, Codex if `~/.codex` exists, Antigravity if `~/.gemini/antigravity` exists; name others with `--agent <id>`), downloads a pinned llama.cpp runtime and the approximately 812 MB Hydra Nano Git Q8 GGUF, verifies SHA-256 hashes, and writes configuration under `~/.hydra`. Node 18+ with npm is required. Windows x64/arm64 CPU, macOS x64/arm64, and Ubuntu-compatible Linux x64/arm64 runtime artifacts are supported. Windows has live verification; other platform packages have not been exercised here.

For Claude Code the bootstrap also registers two Claude Code hooks in `~/.claude/settings.json`, because an agent that merely has the skill rarely uses it. A `PreToolUse` hook turns a direct test or build run (npm/pnpm/yarn test or build, jest, vitest, pytest, unittest, `node --test`, cargo, go, gradle, mvn, dotnet, make test) back with the `hydra run --` command to use instead; prefixing a command with `HYDRA_RAW=1` lets the raw log through. A `SessionStart` hook tells each new session to ask Hydra about git history and to keep Read and Grep for source files, where Hydra does not save tokens. Other settings are kept, the original file is saved as `settings.json.before-hydra`, and an invalid settings file is left untouched. Skip the hooks with `--no-hooks`; manage them later with `hydra hooks install|remove|status`.

### Other coding tools: MCP server and hooks

Every other tool Hydra finds gets Hydra's MCP server (`scripts/mcp.mjs`, also `hydra mcp`), and its test/build hook where the tool has hooks. The MCP server offers three tools, where Hydra pays: `hydra_git` (a read-only git question), `hydra_run` (one test or build command; shell operators, redirection and env prefixes are refused, and the command must be a recognised test/build runner) and `hydra_os`. It sends the client a short instruction on when to use them, and records the client's name as the agent in the ledger. Source reading and search stay with the tool's own tools.

| Tool | MCP entry | Hook |
|---|---|---|
| Codex | `~/.codex/config.toml` `[mcp_servers.hydra]` (between marker comments) | `~/.codex/hooks.json` `PreToolUse` on `Bash` and `SessionStart`; Codex runs them only after you trust them with `/hooks` |
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/hooks.json` `beforeShellExecution` and `sessionStart` |
| OpenCode | `~/.config/opencode/opencode.json(c)` `mcp.hydra` | `~/.config/opencode/plugins/hydra.js` (`tool.execute.before` on `bash`) |
| Gemini CLI | `~/.gemini/settings.json` `mcpServers.hydra` | same file, `BeforeTool` on `run_shell_command` |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | none known; it gets the skill and the MCP server's instructions |

Claude Code keeps its skill and hooks and gets no MCP entry, which would only repeat the same tools. Every registration points at Hydra's own copy of its scripts in `~/.hydra/scripts`, never at an npx cache. Each edited file is backed up once as `<file>.before-hydra` and written atomically; only Hydra's entries are added or removed. A JSON file with comments, or an invalid one, is left alone and the entry to add by hand is printed. Skip all of this with `--no-agents`, or only the hooks with `--no-hooks`. Manage it later with `hydra agents install|remove|status [codex cursor opencode gemini-cli antigravity]`.

The first bootstrap shares the Git model across all model-backed heads; it does not download five specialist weights. Runtime downloads and configuration stay outside agent skill folders, so skill updates retain them. Hydra starts its managed server on `127.0.0.1:11435` when needed; it stays running until `hydra stop` or a reboot. Run the installed `scripts/hydra.mjs doctor` to check readiness. `HYDRA_HOME` changes the data/config directory; explicit backend, URL and model environment variables override managed defaults.

From a local checkout, run `node skills/hydra/scripts/install.mjs`. After skill-only installation, run the installed `scripts/install.mjs --runtime-only`. The code and immutable GGUF are published. The remote bootstrap was verified on Windows on 2026-10-12, including installed-skill readiness and model hash verification; see [the receipt](../evals/results/remote-bootstrap-windows.json).

For Kaggle evaluation, put `KAGGLE_USERNAME` and `KAGGLE_API_TOKEN` in root `.env` using [`.env.example`](../.env.example). `train/kaggle/control.py` loads that file, prepares private frozen inputs, and separates upload from GPU execution. `run --approved` is only for an explicitly approved 30-minute evaluation; the kernel trains nothing, verifies source/model hashes, and rejects CPU fallback. Tokens are never embedded in the uploaded source bundle.

Or copy `skills/hydra` directly to your agent's skills directory:
- Claude Code: `~/.claude/skills/hydra`
- Antigravity: `~/.gemini/config/skills/hydra`

## Layout

- `skills/hydra/SKILL.md`: tells an agent when to delegate and how to read the result.
- `skills/hydra/scripts/hydra.mjs`: the CLI.
- `skills/hydra/scripts/mcp.mjs`: the MCP server (stdio).
- `skills/hydra/scripts/lib/`:
  - `runtime.mjs`: selectable Ollama/llama.cpp API client and per-head model configuration.
  - `route.mjs`: route questions between heads.
  - `git.mjs`: git head probes and plan step.
  - `files.mjs`: search and walk head.
  - `read.mjs`: file slice and symbol reader head.
  - `test_logs.mjs`: test runner and build log reader head.
  - `answer.mjs`: verbatim line selection and lead generation.
  - `ollama.mjs`: compatibility exports for existing evaluation callers.
  - `ledger.mjs`: local telemetry ledger, token accounting and the `hydra improve` findings.
  - `integrations.mjs`: MCP and hook registration for Codex, Cursor, OpenCode, Gemini CLI and Antigravity.
- `test/`: unit test suite (`npm test`).
- `evals/git1/`: 1000-task sealed test set for git head.
- `evals/test_logs/`: 20-task cross-language benchmark for test and build logs.
- `evals/read/`: 20-task cross-language benchmark for file slice reading.
