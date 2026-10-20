---
name: hydra
description: Run test and build commands, git history/diff/blame questions, and machine inspections (ports, processes, disk) through hydra, a local model that returns only the lines that matter. Use before running npm test, pytest, cargo test, tsc or a build, before reading git log, diff, show or blame output, and before ps, lsof or df dumps.
---

# Hydra

`hydra` runs a noisy read-only command on this machine and prints only the lines that answer the question; the raw output stays out of your context. It pays off where output is long and mostly noise: test and build logs, git history and diffs, process and port listings.

## Call it

From the repository the question is about:

```
node scripts/hydra.mjs run -- <test or build command...>
node scripts/hydra.mjs ask --head git "<question>"
node scripts/hydra.mjs os [question...]
```

`scripts/` is in this skill's directory.

- **Tests and builds:** `run --` executes the command and returns the failing tests, assertion diffs and source locations with the exit code, or a short pass summary. A run you already cut to a few lines yourself (`| tail -n 20`) gains nothing from Hydra.
- **Git:** ask one full question per call and name the file, branch, commit or author when you know it; the model may only use a path, revision or name that appears in your question. A short check such as `git status --short` is cheaper to run yourself.
- **Machine:** ports, processes, disk, memory, system info and environment variable names, with secrets withheld.

Read and search source files with your own tools: a measured trial found routing that work through Hydra cost 72% more tokens. Hydra also has `search`, `read`, `smell`, `refactor` and `design` commands (`node scripts/hydra.mjs` with no arguments lists them) for when the user asks for them.

## What it answers

- **test**: test and build output (`npm test`, `pytest`, `cargo test`, `go test`, `tsc` and others). On failure, the failing test name, assertion diff and the user's own file:line, with node_modules and framework frames dropped.
- **git**: current branch and sync state, uncommitted and staged changes, commit history, what this branch adds over a base branch, one commit's patch, blame, branches, worktrees, remotes, stashes, tags.
- **os**: listening ports, running processes and CPU consumers, disk space, memory, system info, environment variable names, never their values.

Changes to the repository, and questions that need reasoning about what code does, stay with you.

## Read the result

- Lines under each `$ command` are the command's own output, copied verbatim. Build on these.
- `Selected evidence:` introduces verbatim lines chosen by the local model. Interpret these lines yourself; Hydra does not generate a factual lead.
- Git lists (status, commits, branches, stashes, tags, remotes, worktrees) are returned whole. Put an explicit count in commit-history questions; the supported maximum is 50.
- `(N more lines not shown)` means output was withheld. When the lines shown do not settle the question, run that one command yourself.

## When it cannot run

Exit code 2 with `hydra unavailable` means the configured model is not ready. Run `node scripts/hydra.mjs doctor` to check it. For the default llama.cpp backend, run the installed `scripts/install.mjs --runtime-only` to download the pinned runtime and GGUF after telling the user the download size and that a background server will stay running. The managed config is in `~/.hydra`; Hydra starts its server when needed and `node scripts/hydra.mjs stop` stops it. The initial bootstrap shares one Git model across heads. For an external server, set `HYDRA_LLAMA_URL` to its root (without `/v1`) and `HYDRA_MODEL` to its alias. For Ollama, set `HYDRA_BACKEND=ollama`; its `setup` downloads models, so tell the user before starting it. `npx skills add` installs skill/CLI files only; `npx github:rahul05ranjan/hydra` performs the full bootstrap. If the runtime cannot be made available, do the task directly and report the limitation.
