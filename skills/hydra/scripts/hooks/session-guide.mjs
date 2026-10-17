#!/usr/bin/env node
// Session-start hook: tells the agent where Hydra pays off, so it uses it without being asked.
// --format claude or codex answers with hookSpecificOutput; cursor with additional_context.
// The session start goes to the local ledger, so `hydra improve` can tell how many sessions used Hydra.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { record } from '../lib/ledger.mjs';

const hydra = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hydra.mjs');
const flag = process.argv.indexOf('--format');
const format = flag >= 0 ? process.argv[flag + 1] : 'claude';
const mcp = format === 'claude' ? '' : ' (or the hydra_git / hydra_run MCP tools)';
const guide = `Hydra is installed: it runs noisy read-only commands on a small local model and returns only the lines that matter.\n` +
  `- For git history, diff, blame or "what changed" questions, first run: node "${hydra}" ask --head git "<question>"${mcp} ` +
  `from the repository, instead of reading git log, git diff or git show output yourself. Use plain git for writes ` +
  `and for short checks such as git status --short.\n` +
  `- A hook sends test and build runs through: node "${hydra}" run -- <command>\n` +
  `- Keep using your own file reading and search for source files; Hydra does not save tokens there.`;

let input = '';
process.stdin.on('data', chunk => { input += chunk; }).on('end', () => {
  let start = {};
  try { start = JSON.parse(input) ?? {}; } catch { /* The tool always sends JSON; record what there is. */ }
  const session = start.session_id ?? start.conversation_id;
  record({ ts: new Date().toISOString(), kind: 'session', ...(format === 'claude' ? {} : { agent: format }),
    ...(session ? { session } : {}), ...(start.source ? { source: start.source } : {}) });
  process.stdout.write(JSON.stringify(format === 'cursor' ? { additional_context: guide }
    : { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: guide } }));
});
