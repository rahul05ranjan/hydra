#!/usr/bin/env node
// Shell-command hook: a test or build run goes through `hydra run --` (or the hydra_run MCP tool),
// whose digest keeps failing test names, assertion diffs and source locations and drops the rest.
// A run already cut to a few lines by its own pipeline (| tail -n 15, | grep -c) passes: Hydra would
// save little and a retry costs more. Prefix a command with HYDRA_RAW=1 when the raw log is really needed.
// --format picks the tool's hook protocol:
//   claude, codex  PreToolUse; command at tool_input.command; deny via hookSpecificOutput.
//   gemini         BeforeTool on run_shell_command; deny via {"decision": "deny", "reason"}.
//   cursor         beforeShellExecution; command at command; must always answer with a permission.
// Each decision goes to the local ledger with the hook's own time, for `hydra improve`; a command
// that simply passes is recorded without its text.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawBypass, testRun, trimmedRun } from '../lib/claude_hooks.mjs';
import { record } from '../lib/ledger.mjs';

const hydra = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hydra.mjs');
const flag = process.argv.indexOf('--format');
const format = flag >= 0 ? process.argv[flag + 1] : 'claude';

const answers = {
  claude: { pass: null, deny: reason => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }) },
  gemini: { pass: { decision: 'allow' }, deny: reason => ({ decision: 'deny', reason }) },
  cursor: { pass: { permission: 'allow' }, deny: reason => ({ permission: 'deny', agent_message: reason,
    user_message: 'Hydra sent this test/build run through hydra run to keep the full log out of context.' }) },
};
answers.codex = answers.claude;
const answer = answers[format] ?? answers.claude;

let input = '';
process.stdin.on('data', chunk => { input += chunk; }).on('end', () => {
  let parsed;
  try { parsed = JSON.parse(input) ?? {}; } catch {
    if (answer.pass) process.stdout.write(JSON.stringify(answer.pass));
    return;
  }
  const command = String((format === 'cursor' ? parsed.command : parsed.tool_input?.command) ?? '');
  const session = parsed.session_id ?? parsed.conversation_id;
  const event = (decision, withCommand = true) => ({ ts: new Date().toISOString(), kind: 'hook', hook: 'route-tests',
    ...(format === 'claude' ? {} : { agent: format }), decision, ...(withCommand ? { command: command.slice(0, 300) } : {}),
    ...(session ? { session } : {}), hookMs: Math.round(process.uptime() * 1000) });
  const run = testRun(command);
  if (!run) {
    record(rawBypass(command) ? event('raw') : trimmedRun(command) ? event('trimmed') : event('pass', false));
    if (answer.pass) process.stdout.write(JSON.stringify(answer.pass));
    return;
  }
  record({ ...event('deny'), run });
  process.stdout.write(JSON.stringify(answer.deny(`Test/build runs go through Hydra so the full log stays out of context. Run it as:\n` +
    `  node "${hydra}" run -- ${run}\n${format === 'claude' ? '' : 'or call the hydra_run tool with that command. '}` +
    `(Keep any cd or env prefix before it.) Hydra returns the failing tests, assertion diffs and source locations ` +
    `verbatim, or a short pass summary. A run you cut to a few lines yourself (| tail -n 40 or less, or | grep ... | head -40) also passes. ` +
    `If you truly need the raw log, prefix the original command with HYDRA_RAW=1.`)));
});
