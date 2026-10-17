<p align="center">
  <img src="https://raw.githubusercontent.com/rahul05ranjan/hydra/main/assets/hydra-banner.svg" alt="Hydra: small local models that take the noisy work off your coding agent" width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hydra-nano"><img src="https://img.shields.io/npm/v/hydra-nano?color=7c5cff&label=npm" alt="npm version"></a>
  <a href="https://huggingface.co/rahul05ranjan/hydra-nano-git"><img src="https://img.shields.io/badge/model-Hydra%20Nano%20v2-22d3ee" alt="Hydra Nano v2 on Hugging Face"></a>
  <img src="https://img.shields.io/badge/runs-100%25%20local-5eead4" alt="Runs 100% local">
  <img src="https://img.shields.io/badge/node-%E2%89%A518-3c873a" alt="Node 18 or later">
  <a href="https://github.com/rahul05ranjan/hydra/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<p align="center">
  <b>Your coding agent reads every line of every test log, git diff and process list it runs.<br>Hydra reads them on your machine and hands back only the lines that matter.</b>
</p>

---

## Why Hydra

Frontier coding agents pay for every token of tool output: a failing test suite, a long `git log`, a `ps` dump. Most of it is noise, and all of it fills the context window.

Hydra puts small specialist models on your own machine between the agent and that output:

- **Less context, same answer.** A `pnpm test` run that printed ~13,807 tokens reached the agent as ~57: the failing test, the assertion diff and the source line.
- **Nothing leaves your machine.** The model runs locally on llama.cpp. Hydra's telemetry stays in `~/.hydra/ledger.jsonl`.
- **Read-only by design.** The model never writes a shell command. It picks from fixed, read-only menus; code builds and runs the command.
- **Verbatim, not paraphrased.** Hydra returns the command's own lines, so the agent sees evidence, not a summary.

## Quick start

```bash
npx hydra-nano
```

One command installs everything: a pinned llama.cpp runtime, the ~812 MB Hydra Nano model (SHA-256 checked), the Hydra skill, and the integration for each coding tool it finds.

Want the `hydra` command in your own terminal too?

```bash
npm install -g hydra-nano
hydra doctor
```

Requires Node 18+. Runtime packages for macOS, Linux and Windows on x64 and arm64; verified live on macOS and Windows. Prefer GitHub? `npx github:rahul05ranjan/hydra` installs the same thing.

## Works with your coding tools

| Tool | How Hydra joins | Status |
|---|---|---|
| **Claude Code** | Skill + hooks that route test/build runs and git questions | Tested |
| **Codex** | Skill + MCP server + `PreToolUse` hook | MCP listed by Codex; trust the hook with `/hooks` |
| **OpenCode** | MCP server + plugin | MCP connects |
| **Cursor** | MCP server + `beforeShellExecution` hook | Preview |
| **Gemini CLI** | MCP server + `BeforeTool` hook | Preview |
| **Antigravity** | Skill + MCP server | Preview |

Any other tool that speaks MCP can use Hydra too: point it at `hydra mcp` (stdio).

Hydra never overwrites your settings. Every file it edits is backed up once as `<file>.before-hydra`, only Hydra's own entries change, and `hydra agents remove` takes them out again.

## What it does

| Head | Ask it | It returns |
|---|---|---|
| **git** | "what changed in the last commit?", "who last touched `billing.js`?" | The matching commits, diff hunks or blame lines |
| **test** | `hydra run -- npm test` (pytest, cargo, go, tsc, gradle, ...) | Failing test names, assertion diffs and source locations, with the original exit code |
| **os** | "what is listening on port 3000?" | The matching ports, processes or disk lines, with secrets blocked |
| **read** | `hydra read src/server.ts handleRequest` | One symbol, a line range or an outline |
| **files** | `hydra search parseConfig` | Definition-ranked matches |

Through MCP, Hydra offers the three where it pays most: `hydra_git`, `hydra_run` and `hydra_os`.

## Benchmarks

**Hydra Nano v2**: a full-parameter fine-tune of a 0.8B model, one set of weights for every head, run as a Q8_0 GGUF.

| Set | Tasks | Solved |
|---|---|---|
| Git (sealed test set, never used for training) | 1,000 | **96.3%** |
| Files (held out) | 1,000 | **98.0%** |
| Read (held out) | 1,000 | **96.1%** |
| Test logs (second held-out set) | 1,000 | **97.5%** |
| OS (held out, synthetic probe outputs) | 1,000 | **100%** |
| Test-log benchmark across 8 frameworks | 20 | **19/20**, 47% fewer tokens |

Receipts: [model card](https://huggingface.co/rahul05ranjan/hydra-nano-git) and [`evals/results`](https://github.com/rahul05ranjan/hydra/tree/main/evals/results).

<!-- usage-stats:begin (written by evals/usage/readme_stats.mjs) -->
**In real use.** Since 2026-10-17, Hydra has handled **31 calls** in **2 coding sessions** across **2 projects** on the maintainer's machine. Of **~33,785 tokens** of command output, **~8,019** reached the agent: **76% kept out of context**.

| Work | Calls | Output read locally | Reached the agent | Kept out |
|---|---|---|---|---|
| Test and build runs | 30 | ~33,743 | ~7,969 | **76%** |
| Git questions | 1 | ~42 | ~50 | **-19%** |

<sub>From Hydra's local ledger; tokens are estimates (characters / 4). Updated 2026-10-17.</sub>
<!-- usage-stats:end -->

**Where Hydra does not help, measured.** In a controlled trial of 36 Claude Code sessions extracting functions from real source code, forcing that work through Hydra used **72% more tokens** than the agent's own tools. So Hydra leaves source reading and search to the agent, and routes only the noisy work: test and build logs, git history, system inspection. Full method and numbers in [evaluations](https://github.com/rahul05ranjan/hydra/blob/main/docs/evaluations.md).

## Commands

```bash
hydra ask "which branch am I on and what changed?"   # git, files or os, routed by the question
hydra run -- pytest -q                               # a test or build run, digested
hydra os "what is using port 8080?"                  # read-only system inspection
hydra read src/app.py create_app                     # one symbol, a line range or an outline
hydra smell src/                                     # detect Refactoring.Guru code smells (or --diff / --staged)
hydra refactor src/app.py process_order              # actionable step-by-step refactoring recipe
hydra design "need flexible algorithms at runtime"   # GoF design pattern advisor & architecture guide
hydra stats                                          # tokens kept out of context
hydra improve --since 2026-10-17                     # what the local telemetry says to improve
hydra agents status                                  # Hydra in each coding tool
hydra doctor                                         # is the local model ready?
```

Need the raw log for one run? Prefix it with `HYDRA_RAW=1` and the hook lets it through.

## Privacy and control

- **Local only.** The model, the runtime and the telemetry live in `~/.hydra`. Nothing is sent anywhere.
- **Turn telemetry off** with `HYDRA_TELEMETRY=0`.
- **Skip parts of the install** with `--no-agents` (no other tools), `--no-hooks` (no hooks) or `--runtime-only` (no skill).
- **Uninstall cleanly.** `hydra agents remove` and `hydra hooks remove` undo every integration and restore your settings; `hydra stop` stops the local server; deleting `~/.hydra` removes the runtime, the model and the telemetry.

## Learn more

- [How Hydra works](https://github.com/rahul05ranjan/hydra/blob/main/docs/how-it-works.md): heads, backends (llama.cpp or Ollama), telemetry, every install path and the code layout.
- [Evaluations and trials](https://github.com/rahul05ranjan/hydra/blob/main/docs/evaluations.md): how each number above was measured.
- [What real use teaches](https://github.com/rahul05ranjan/hydra/blob/main/IMPROVEMENTS.md): the open and fixed findings from Hydra's own telemetry.
- [Hydra Nano on Hugging Face](https://huggingface.co/rahul05ranjan/hydra-nano-git).

## License

MIT. See [LICENSE](https://github.com/rahul05ranjan/hydra/blob/main/LICENSE).
