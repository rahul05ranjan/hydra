#!/usr/bin/env node
// Claude Code SessionStart hook: tells the agent where Hydra pays off, so it uses it without being asked.
// The session start goes to the local ledger, so `hydra improve` can tell how many sessions used Hydra.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { record } from '../lib/ledger.mjs';

const hydra = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hydra.mjs');
let input = '';
process.stdin.on('data', chunk => { input += chunk; }).on('end', () => {
  let start = {};
  try { start = JSON.parse(input) ?? {}; } catch { /* Claude Code always sends JSON; record what there is. */ }
  record({ ts: new Date().toISOString(), kind: 'session', ...(start.session_id ? { session: start.session_id } : {}),
    ...(start.source ? { source: start.source } : {}) });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
    `Hydra is installed: it runs noisy read-only commands on a small local model and returns only the lines that matter.\n` +
    `- For git history, diff, blame or "what changed" questions, first run: node "${hydra}" ask --head git "<question>" ` +
    `from the repository, instead of reading git log, git diff or git show output yourself. Use plain git for writes ` +
    `and for short checks such as git status --short.\n` +
    `- A hook sends test and build runs through: node "${hydra}" run -- <command>\n` +
    `- Keep using Read and Grep for source files; Hydra does not save tokens there.` } }));
});
