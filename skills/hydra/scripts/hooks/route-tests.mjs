#!/usr/bin/env node
// Claude Code PreToolUse hook (Bash): a test or build run goes through `hydra run --`, whose digest
// keeps failing test names, assertion diffs and source locations and drops the rest of the log.
// Prefix a command with HYDRA_RAW=1 when the raw log is really needed.
// Each decision goes to the local ledger with the hook's own time, for `hydra improve`; a command
// that simply passes is recorded without its text.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawBypass, testRun } from '../lib/claude_hooks.mjs';
import { record } from '../lib/ledger.mjs';

const hydra = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hydra.mjs');
let input = '';
process.stdin.on('data', chunk => { input += chunk; }).on('end', () => {
  let command = '';
  let session;
  try { ({ tool_input: { command = '' } = {}, session_id: session } = JSON.parse(input)); } catch { return; }
  const event = (decision, withCommand = true) => ({ ts: new Date().toISOString(), kind: 'hook', hook: 'route-tests',
    decision, ...(withCommand ? { command: String(command).slice(0, 300) } : {}), ...(session ? { session } : {}),
    hookMs: Math.round(process.uptime() * 1000) });
  const run = testRun(command);
  if (!run) {
    record(rawBypass(command) ? event('raw') : event('pass', false));
    return;
  }
  record({ ...event('deny'), run });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `Test/build runs go through Hydra so the full log stays out of context. Run it as:\n` +
      `  node "${hydra}" run -- ${run}\n(keep any cd or env prefix before it). Hydra returns the failing tests, ` +
      `assertion diffs and source locations verbatim, or a short pass summary. If you truly need the raw log, ` +
      `prefix the original command with HYDRA_RAW=1.` } }));
});
