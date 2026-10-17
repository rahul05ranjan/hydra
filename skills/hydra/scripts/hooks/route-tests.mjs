#!/usr/bin/env node
// Claude Code PreToolUse hook (Bash): a test or build run goes through `hydra run --`, whose digest
// keeps failing test names, assertion diffs and source locations and drops the rest of the log.
// Prefix a command with HYDRA_RAW=1 when the raw log is really needed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testRun } from '../lib/claude_hooks.mjs';

const hydra = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hydra.mjs');
let input = '';
process.stdin.on('data', chunk => { input += chunk; }).on('end', () => {
  let command = '';
  try { command = JSON.parse(input).tool_input?.command ?? ''; } catch { return; }
  const run = testRun(command);
  if (!run) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `Test/build runs go through Hydra so the full log stays out of context. Run it as:\n` +
      `  node "${hydra}" run -- ${run}\n(keep any cd or env prefix before it). Hydra returns the failing tests, ` +
      `assertion diffs and source locations verbatim, or a short pass summary. If you truly need the raw log, ` +
      `prefix the original command with HYDRA_RAW=1.` } }));
});
