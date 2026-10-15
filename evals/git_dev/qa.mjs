// Development gold coverage only. Runs fixed read-only Git probes, never a model.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dataDir, ensureWorlds, loadTasks, worldsDir } from './build.mjs';
import { git, PROBES } from '../../skills/hydra/scripts/lib/git.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
ensureWorlds();
const rows = [];
for (const task of loadTasks()) {
  const cwd = path.join(worldsDir(), task.world, 'repo');
  const candidates = [];
  for (const accepted of task.accept) {
    const args = { n: 15, staged: false };
    for (const [key, value] of Object.entries(accepted.args || {})) {
      if (key === 'nMin') args.n = value;
      else args[key] = Array.isArray(value) ? value[0] : value;
    }
    const argv = PROBES[accepted.probe].argv(args);
    const result = await git(cwd, argv);
    let text = result.out || '(no output)';
    // Explicit no-stash gold carries the same display marker as the CLI.
    if (accepted.probe === 'stash' && !result.out) text = '$ git stash list\n(no output)';
    if (task.intent === 'worktrees') text = text.replaceAll('\\', '/');
    const missing = task.facts.filter(fact => !text.includes(fact));
    candidates.push({ probe: accepted.probe, ok: result.ok, missing });
  }
  rows.push({ id: task.id, valid: candidates.some(candidate => candidate.ok && !candidate.missing.length), candidates });
}
const hash = name => createHash('sha256').update(readFileSync(path.join(dataDir, name))).digest('hex');
const result = { scope: 'Development gold facts are reachable via an accepted read-only probe. This is not model accuracy or independent proof of every question interpretation.',
  timestamp: new Date().toISOString(), tasks: rows.length, valid: rows.filter(r => r.valid).length,
  hashes: Object.fromEntries(['tasks.jsonl', 'worlds.json', 'phrasings.json'].map(name => [name, hash(name)])),
  failures: rows.filter(row => !row.valid) };
const output = path.join(ROOT, 'evals/results/suite', process.env.HYDRA_GIT_DEV_SET && process.env.HYDRA_GIT_DEV_SET !== 'original' ? `${process.env.HYDRA_GIT_DEV_SET}-development-gold-qa.json` : 'development-gold-qa.json');
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (result.valid !== result.tasks) process.exitCode = 1;
