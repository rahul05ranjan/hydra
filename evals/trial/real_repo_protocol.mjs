import assert from 'node:assert/strict';

export const ARMS = ['plain', 'available', 'forced'];
export const REPEATS = 3;
export const MODEL = 'claude-opus-5-5';
export const BUDGET_PER_SESSION = 0.5;
export const MAX_SECONDS = 1200;

export function schedule(tasks) {
  const result = [];
  for (let repeat = 0; repeat < REPEATS; repeat++) for (let task = 0; task < tasks.length; task++) {
    const rotated = ARMS.map((_, i) => ARMS[(i + repeat + task) % ARMS.length]);
    for (const arm of rotated) result.push({ task: tasks[task].id, repeat, arm });
  }
  return result;
}

export function command(task, arm, workspace) {
  const common = 'Inspect this source snapshot with read-only tools. Return only the requested structured facts. Preserve source files, use no network commands, and resolve bundled skill scripts from the skill base directory. You may use another read-only tool when evidence is insufficient.';
  const forced = arm === 'forced' ? ' Invoke the hydra skill and delegate the search/read operations to Hydra first; use native tools if its evidence is insufficient.' : '';
  return ['claude', '-p', task.request, '--model', MODEL, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'project',
    '--settings', '{"disableAllHooks":true,"autoMemoryEnabled":false,"syncClaudeAiSkills":false}',
    '--tools', 'Bash,Read,Grep,Glob,Skill', '--permission-mode', 'dontAsk', '--max-budget-usd', String(BUDGET_PER_SESSION),
    '--allowedTools', 'Read', 'Grep', 'Glob', 'Skill', ...['rg', 'grep', 'sed', 'awk', 'cat', 'head', 'tail', 'wc', 'ls', 'find', 'sort', 'cut', 'tr', 'printf', 'echo', 'python3', 'node'].map(p => `Bash(${p} *)`),
    '--append-system-prompt', common + forced, '--json-schema', JSON.stringify(task.schema)];
}

export function parseRun(task, execution, arm) {
  const events = execution.stdout.split('\n').filter(l => l.startsWith('{')).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const init = events.find(e => e.type === 'system' && e.subtype === 'init') ?? {};
  const result = events.findLast(e => e.type === 'result') ?? {};
  const calls = events.filter(e => e.type === 'assistant').flatMap(e => e.message?.content ?? []).filter(b => b.type === 'tool_use');
  const returns = events.filter(e => e.type === 'user').flatMap(e => Array.isArray(e.message?.content) ? e.message.content : []).filter(b => b.type === 'tool_result');
  const loaded = [...(init.skills ?? []), ...(init.slash_commands ?? [])].map(x => typeof x === 'string' ? x : x.name ?? '');
  const skillAvailable = loaded.some(n => n === 'hydra' || n.endsWith(':hydra'));
  const availabilityValid = arm === 'plain' ? !skillAvailable : skillAvailable;
  let answer = result.structured_output;
  if (answer === undefined) { try { answer = JSON.parse((result.result ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* missing answer */ } }
  if (typeof answer?.file === 'string') answer.file = answer.file.replace(/^\.\//, '').replaceAll('\\', '/');
  let correct = false;
  try { assert.deepEqual(answer, task.expected); correct = true; } catch { /* strict source/fact mismatch */ }
  const usage = result.usage ?? {};
  const callSignatures = calls.map(c => JSON.stringify([c.name, c.input]));
  const hydraAttempts = calls.filter(c => c.name === 'Bash' && /hydra\.mjs\b/.test(String(c.input?.command ?? '')));
  const hydraSuccesses = hydraAttempts.filter(c => returns.some(r => r.tool_use_id === c.id && !r.is_error));
  const permissionDenials = returns.filter(r => r.is_error && /Permission to use .* has been denied/.test(JSON.stringify(r.content))).length;
  return {
    finished: execution.exitCode === 0 && result.type === 'result' && !result.is_error,
    correct, answer: answer ?? null, model: init.model ?? null, loadedSkills: init.skills ?? [], skillAvailable, availabilityValid,
    permissionDenials, hydraAttempts: hydraAttempts.length, hydraSuccessfulCalls: hydraSuccesses.length,
    skillInvocations: calls.filter(c => c.name === 'Skill' && /hydra/.test(String(c.input?.skill ?? ''))).length,
    repeatedToolAttempts: callSignatures.length - new Set(callSignatures).size,
    toolCalls: calls.length, toolErrors: returns.filter(r => r.is_error).length, turns: result.num_turns ?? null,
    usageAvailable: typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number',
    inputTokens: ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((s, k) => s + (usage[k] ?? 0), 0),
    outputTokens: usage.output_tokens ?? 0, usage, costUsd: result.total_cost_usd ?? null, seconds: execution.seconds,
    error: execution.error ?? (result.is_error ? result.result : null),
    commandCalls: calls.filter(c => c.name === 'Bash').map(c => c.input.command),
  };
}

export function summarize(rows, taskIds) {
  const byArm = Object.fromEntries(ARMS.map(arm => {
    const list = rows.filter(r => r.arm === arm);
    return [arm, { sessions: list.length, correct: list.filter(r => r.finished && r.correct).length,
      adopted: list.filter(r => r.hydraSuccessfulCalls > 0).length,
      ...Object.fromEntries(['inputTokens', 'outputTokens', 'costUsd', 'seconds', 'toolCalls', 'toolErrors', 'permissionDenials', 'repeatedToolAttempts'].map(k => [k, list.reduce((s, r) => s + (r[k] ?? 0), 0)])) }];
  }));
  const matched = [];
  for (const id of taskIds) for (let repeat = 0; repeat < REPEATS; repeat++) {
    const block = rows.filter(r => r.task === id && r.repeat === repeat);
    if (ARMS.every(a => block.some(r => r.arm === a && r.finished && r.correct && r.availabilityValid && r.permissionDenials === 0 && r.sourceUnchanged && r.usageAvailable))) matched.push(...block);
  }
  const total = arm => matched.filter(r => r.arm === arm).reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
  const baseline = total('plain');
  return { byArm, matchedBlocks: matched.length / ARMS.length,
    matchedCorrectTokens: Object.fromEntries(ARMS.map(a => [a, total(a)])),
    matchedReductionPct: Object.fromEntries(['available', 'forced'].map(a => [a, baseline ? Number(((1 - total(a) / baseline) * 100).toFixed(2)) : null])) };
}
