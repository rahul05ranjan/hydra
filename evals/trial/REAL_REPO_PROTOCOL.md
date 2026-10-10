# Repeated real-source trial

The question is whether Hydra reduces actual frontier-agent tokens at equal completeness, and whether an agent chooses the installed skill without a usage instruction.

## Predeclared tasks and corpus

The trial uses source-only snapshots from the user's Vasuki and Dhruv CLI repositories: 69 files, 9,375 lines. No `.env`, project configuration, data, dependencies, or sealed `git1` material is copied. Four functions were selected before checking Hydra outputs:

| Repository | Function | Module size | Function size |
|---|---|---:|---:|
| Vasuki | `cast_value` | 418 lines | 30 lines |
| Vasuki | `_join` | 447 lines | 48 lines |
| Dhruv CLI | `checkConfiguration` | 514 lines | 66 lines |
| Dhruv CLI | `ingestCommittedRange` | 337 lines | 64 lines |

The prompt names the function, not its file or line range. Each agent must locate it and return the relative filename, start/end line numbers, and complete byte-exact function source with LF separators. Python's AST and TypeScript's parser provide independent gold. Tasks, schedule, source and skill hashes are frozen before model calls. Gold stays outside the working directories.

## Arms and order

1. `plain`: native tools, no Hydra skill in the workspace.
2. `available`: the unmodified frozen Hydra skill is installed as a project skill; the prompt does not name Hydra.
3. `forced`: the same skill is installed, with an explicit instruction to invoke it and delegate search/read first. Native fallback is allowed when evidence is insufficient.

Each task has three fresh sessions in each arm: 36 sessions. Cyclic order changes by task and repeat so every arm occupies each position for every task. All use `claude-opus-5-5`, the same project-only setting sources, tools and permissions. User-level settings and skills are excluded. There is no safe-mode flag because that disables the skill being tested.

Project skills use the documented [`.claude/skills/<name>/SKILL.md` location](https://code.claude.com/docs/en/skills#choose-where-skills-load); [CLI setting sources](https://code.claude.com/docs/en/cli-reference) isolate project customizations. Startup events are checked rather than assuming skill discovery worked. Prepared commands are in the manifest; each actual command is saved with its trace.

## Validity and outcomes

- Registry must contain Hydra in `available` and `forced`, and omit it in `plain`.
- Frontier model must match the declared model, source files must remain unchanged, and local read/search model digests must remain unchanged.
- A permission denial or missing usage invalidates the protocol and stops the run. Infrastructure failure stops rather than discarding an inconvenient cell.
- Factual/source failures remain in all-arm accuracy and usage totals. Tasks and prompts are not changed to repair them mid-run.
- Actual successful Hydra commands and skill-tool calls measure adoption. Identical repeated tool inputs count as repeated attempts; tool errors are also reported separately.
- Report all outcomes, full-triplet matched-correctness blocks, and each skill arm's pairwise equal-correctness comparison against plain.
- Token counts include provider-reported uncached input, cache creation/read and output. Monetary fields are API-cost equivalents, not a Pro-account bill or allowance measurement.
- Exploratory 95% bootstrap intervals resample whole task clusters with their repeats. Four distinct tasks are a small sample; these are not broad coding-workload results.

## Budget and launch

Maximum session budget setting: $0.50. Total configured budget: $18. Overall time limit: 20 minutes; individual session limit: 3 minutes or the remaining overall time. Cancellation terminates the active child process group. Partial or invalid runs are retained and labelled.

Prepare without model calls:

```sh
npm run eval:real:prepare
```

After the project-required explicit approval of the run notice, launch the reviewed preparation:

```sh
npm run eval:real -- --prepared <prepared-directory>
```

The runner refuses to silently reuse a started run. Repeat the offline trace audit without model calls:

```sh
node evals/trial/analyze_real_repo.mjs <prepared-directory>
```
