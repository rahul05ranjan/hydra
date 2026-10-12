---
name: hydra
description: Hand a read-only git question (repo state, history, blame), a where-is-it code search, targeted file slicing instead of whole-file reads, test/build failure digests, or system/OS inspections (ports, processes, disk) to hydra locally. Use before running git status, log, diff, show, blame, broad searches, whole file reads, ps/lsof dumps, or test/build commands where noisy output would flood your context.
---

# Hydra

`hydra` runs read-only commands for repo questions, file slicing, test/build runs, and system inspections on a small local model and prints the lines that answer it. The raw output stays on this machine instead of entering your context.

## Call it

From the repository the question is about, naming the head that fits:

```
node scripts/hydra.mjs ask --head git "<question>"
node scripts/hydra.mjs ask --head files "<question>"
node scripts/hydra.mjs ask --head read "<question>"
node scripts/hydra.mjs ask --head test "<question>"
node scripts/hydra.mjs ask --head os "<question>"
node scripts/hydra.mjs search <term...>
node scripts/hydra.mjs read <file> [symbol|--lines <start-end>|--outline]
node scripts/hydra.mjs run -- <command...>
node scripts/hydra.mjs os [question...]
```

`scripts/` is in this skill's directory. Ask one full question per call and name the file, branch, commit or author when you know it: the model may only use a path, revision or name that appears in your question.
- For finding definitions & files: use `hydra search <term>` to get definition-ranked matches without noise or raw grep dumps.
- For reading code: use `hydra read <file> [symbol|--lines]` instead of reading multi-thousand-line files. It returns the exact symbol or slice, or a structural outline of symbols.
- For tests and builds: run `hydra run -- <command...>` to execute the command locally and get the failure evidence with its exit code.
- For system and environment: use `hydra os` or `--head os` to inspect listening ports, top processes, disk space, and system info without dumping 500 lines of terminal output into context.

## What it answers

- **git**: current branch and sync state, uncommitted and staged changes, commit history, what this branch adds over a base branch, one commit's patch, blame, branches, worktrees, remotes, stashes, tags.
- **files**: where a name is defined or used, and which files are named like it.
- **read**: extracts symbol definitions (functions, classes, methods), line ranges (`--lines 10-50`), or structural definition outlines across TypeScript, JavaScript, Python, Rust, and Go without dumping whole files into context.
- **test**: runs and parses test and build outputs (`npm test`, `pytest`, `cargo test`, `tsc`). If tests fail, extracts the failing test name, assertion diff, and exact user file:line location, stripping node_modules and framework traces.
- **os**: inspects listening ports (`lsof`), running processes / CPU consumers (`ps`), disk space (`df -h`), and system info (`uptime`, `uname`) while strictly guarding against printing secrets.

Changes to the repository, and questions that need reasoning about what code does, stay with you.

## Read the result

- Lines under each `$ command` are the command's own output, copied verbatim. Build on these.
- `Selected evidence:` introduces verbatim lines chosen by the local model. Interpret these lines yourself; Hydra does not generate a factual lead.
- Git lists (status, commits, branches, stashes, tags, remotes, worktrees) are returned whole. Put an explicit count in commit-history questions; the supported maximum is 50.
- `(N more lines not shown)` means output was withheld. When the lines shown do not settle the question, run that one command yourself.

## When it cannot run

Exit code 2 with `hydra unavailable` means the configured model is not ready. Run `node scripts/hydra.mjs doctor` to check it. For the default llama.cpp backend, run the installed `scripts/install.mjs --runtime-only` to download the pinned runtime and GGUF after telling the user the download size and that a background server will stay running. The managed config is in `~/.hydra`; Hydra starts its server when needed and `node scripts/hydra.mjs stop` stops it. The initial bootstrap shares one Git model across heads. For an external server, set `HYDRA_LLAMA_URL` to its root (without `/v1`) and `HYDRA_MODEL` to its alias. For Ollama, set `HYDRA_BACKEND=ollama`; its `setup` downloads models, so tell the user before starting it. `npx skills add` installs skill/CLI files only; `npx --yes --package=github:rahul05ranjan/hydra hydra-install` performs the full bootstrap. If the runtime cannot be made available, do the task directly and report the limitation.
