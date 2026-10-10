# Hydra

Small local models that a frontier coding agent hands routine repo work to, behind one CLI (`hydra`) that installs as a skill.

- **State of the work:** read `TRACKER.md` before doing anything. It holds the decisions, the plan, what is blocked and the next step. Update it in the same turn as any change to those, and add one dated line to its Log.
- **How the code works:** `README.md`.
- **`evals/git1` is the sealed test set for the git head.** Score a model on it and report the number. Training data must not use its worlds (seeds 4100 to 4149), its phrasings (`evals/git1/questions.mjs`) or the word lists in `evals/git1/world.mjs`. Do not read its failures to decide what training data or prompt to change; build and use a development set for that (see `TRACKER.md`, step 3).
- **`npm run eval:build` must leave `evals/git1/tasks.jsonl` and `worlds.json` byte-identical.** Run it and compare after touching anything under `evals/git1/`.
- **A head stays read-only and the model never writes a command.** It picks from a fixed menu; code builds and runs the command. Keep that when adding a head or a probe.
- **`.env` holds the Cloudflare keys.** Load it in the shell; never print its values, and never commit it.
- **Before a training run, a paid job or an unattended script, tell the user in one or two plain sentences what will run, where and for how long, and wait for a clear yes.**
- **Commit messages and PR bodies end at the last line of real content.** The user wants no AI attribution lines.
