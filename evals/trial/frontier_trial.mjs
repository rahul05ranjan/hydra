#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createFixture, ROOT } from './fixture.mjs';

const args = process.argv.slice(2);
const runPaid = args.includes('--run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex < 0 ? 6 : Number(args[limitIndex + 1]);
if (!Number.isInteger(limit) || limit < 1 || limit > 6) throw new Error('--limit must be an integer from 1 to 6');
const directory = path.join(ROOT, 'evals/results/frontier', new Date().toISOString().replace(/[:.]/g, '-'));
const runtime = path.join(directory, 'runtime');
const workspaceRoot = path.join(os.homedir(), '.hydra/trials/frontier', path.basename(directory));
const budgetPerSession = 0.5;
const maximumSeconds = 600;
const arms = ['plain', 'hydra'];
const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
const strings = { type: 'array', items: string };
const fixture = createFixture();

const tasks = [
  { id: 'status', request: 'Inspect this repository. Return the current branch and every changed or untracked file with its two-character git short-status code.',
    schema: objectSchema({ branch: string, changes: { type: 'array', items: objectSchema({ path: string, status: string }) } }),
    expected: { branch: 'main', changes: [{ path: 'config.json', status: 'M ' }, { path: 'src/checkout.mjs', status: ' M' }, { path: 'scratch.txt', status: '??' }] }, unordered: 'changes' },
  { id: 'last_commit', request: 'Which files were actually changed by the latest commit? Return the complete list of repository-relative filenames.',
    schema: objectSchema({ files: strings }), expected: { files: ['TRACKER.md'] }, unordered: 'files' },
  { id: 'recent_commits', request: 'Return the latest five commits, newest first, with each seven-character hash and the full commit subject.',
    schema: objectSchema({ commits: { type: 'array', items: objectSchema({ hash: string, subject: string }) } }),
    expected: { commits: fixture.gold.recent.map(l => { const m = l.match(/^(\w+) \S+ Fixture Dev: (.*)$/); return { hash: m[1], subject: m[2] }; }) } },
  { id: 'read_code', request: 'Find computeTotal in src/pricing.mjs. Return its complete function source exactly as written (exclude the leading comment), and its numeric result for items [{"price":12.5,"quantity":2},{"price":3,"quantity":1}] with discount 0.15.',
    schema: objectSchema({ source: string, value: { type: 'number' } }), expected: { source: fixture.gold.sourceLines.slice(4, 8).join('\n'), value: 23.8 } },
  { id: 'search', request: 'Find the definition of computeTotal and every usage in src/checkout.mjs. Return repository-relative file paths and 1-based line numbers for the definition and each usage.',
    schema: objectSchema({ definition: objectSchema({ file: string, line: { type: 'integer' } }), usages: { type: 'array', items: objectSchema({ file: string, line: { type: 'integer' } }) } }),
    expected: { definition: { file: 'src/pricing.mjs', line: 5 }, usages: [{ file: 'src/checkout.mjs', line: 1 }, { file: 'src/checkout.mjs', line: 2 }] }, unordered: 'usages' },
  { id: 'failure', request: 'Run node tools/fail.mjs. Report the failing test name, expected and received numeric values, source filename, line number and exit code. Use only facts in the log.',
    schema: objectSchema({ test: string, expected: { type: 'number' }, received: { type: 'number' }, file: string, line: { type: 'integer' }, exitCode: { type: 'integer' } }),
    expected: { test: 'discounted basket', expected: 18, received: 19, file: 'src/pricing.test.ts', line: 42, exitCode: 1 } },
].slice(0, limit);

const normalize = (task, value) => {
  const copy = JSON.parse(JSON.stringify(value));
  if (task.unordered && Array.isArray(copy[task.unordered])) copy[task.unordered].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return copy;
};

function inspect(task, execution) {
  const events = execution.stdout.split('\n').filter(l => l.startsWith('{')).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const result = events.findLast(e => e.type === 'result') ?? {};
  const calls = events.filter(e => e.type === 'assistant').flatMap(e => e.message?.content ?? []).filter(b => b.type === 'tool_use');
  let answer = result.structured_output;
  if (answer === undefined) {
    try { answer = JSON.parse((result.result ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* recorded as missing */ }
  }
  let correct = false;
  if (answer !== undefined) {
    try { assert.deepEqual(normalize(task, answer), normalize(task, task.expected)); correct = true; } catch { /* exact facts did not match */ }
  }
  const usage = result.usage ?? {};
  return { finished: execution.exitCode === 0 && result.type === 'result' && !result.is_error,
    usageAvailable: typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number',
    correct, answer: answer ?? null, error: execution.error ?? (result.is_error ? result.result : null),
    model: events.find(e => e.type === 'system' && e.subtype === 'init')?.model ?? null,
    inputTokens: ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((s, k) => s + (usage[k] ?? 0), 0),
    outputTokens: usage.output_tokens ?? 0, usage, costUsd: result.total_cost_usd ?? null, seconds: execution.seconds,
    turns: result.num_turns ?? null, toolCalls: calls.length,
    hydraCalls: calls.filter(b => b.name === 'Bash' && String(b.input?.command ?? '').includes(runtime)).length,
    commandCalls: calls.filter(b => b.name === 'Bash').map(b => b.input?.command),
    toolErrors: events.filter(e => e.type === 'user').flatMap(e => Array.isArray(e.message?.content) ? e.message.content : []).filter(b => b.type === 'tool_result' && b.is_error).length };
}

function command(task, arm) {
  const common = 'Inspect this repository using read-only commands. Do not edit files, access the network, or read outside this fixture except the provided Hydra runtime. Return only the requested structured answer. You may retry a failed tool call.';
  const delegation = arm === 'hydra'
    ? `For git questions use node ${runtime}/hydra.mjs ask --head git "<question>". For symbols use node ${runtime}/hydra.mjs read <file> <symbol>. For searches use node ${runtime}/hydra.mjs search <term>. For test logs use node ${runtime}/hydra.mjs run -- <command>. Delegate these operations to Hydra first; if its evidence is insufficient, use a direct command. Hydra quotes evidence; reason from those lines yourself.`
    : 'Use direct repository commands and file tools. Do not invoke the Hydra runtime.';
  return ['claude', '-p', task.request, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--safe-mode', '--disable-slash-commands', '--setting-sources', '',
    '--tools', 'Bash,Read,Grep,Glob', '--permission-mode', 'dontAsk', '--max-budget-usd', String(budgetPerSession),
    '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash(git status *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git branch *)', 'Bash(git diff-tree *)',
    'Bash(rg *)', 'Bash(grep *)', 'Bash(sed *)', 'Bash(cat *)', 'Bash(echo *)', 'Bash(node tools/fail.mjs)', 'Bash(node tools/pass.mjs)', 'Bash(node tools/filter.mjs *)',
    ...(arm === 'hydra' ? [`Bash(node ${runtime}/hydra.mjs *)`] : []),
    '--append-system-prompt', `${common}\n${delegation}`, '--json-schema', JSON.stringify(task.schema)];
}

async function session(argv, cwd, timeoutMs) {
  const start = Date.now();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CLAUDE')));
  env.HYDRA_MODEL = process.env.HYDRA_MODEL ?? 'hydra-qwen3.5:0.8b-plan';
  return new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', error = null;
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    child.on('error', e => { error = e.message; });
    const stop = signal => {
      if (!child.pid) return;
      try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch { /* already exited */ }
    };
    let escalation;
    const timer = setTimeout(() => {
      error = 'Session time limit reached'; stop('SIGTERM');
      escalation = setTimeout(() => stop('SIGKILL'), 5000);
    }, timeoutMs);
    child.on('close', exitCode => { clearTimeout(timer); clearTimeout(escalation); resolve({ stdout, stderr, error, exitCode, seconds: (Date.now() - start) / 1000 }); });
  });
}

mkdirSync(directory, { recursive: true });
cpSync(path.join(ROOT, 'skills/hydra/scripts'), runtime, { recursive: true });
const manifest = { tasks: tasks.map(({ expected, ...t }) => t), arms,
  workspaceRoot,
  maximumSessions: tasks.length * arms.length, budgetPerSessionUsd: budgetPerSession,
  configuredBudgetUsd: tasks.length * arms.length * budgetPerSession, maximumSeconds,
  mode: 'Explicit Hydra delegation vs direct tools; spontaneous skill adoption is not measured',
  fixture: 'Hand-written controlled repository, independent of git1; not an end-to-end software-development benchmark',
  model: 'Same Claude Code configured default in every fresh session; resolved model recorded from init events',
  launchExample: command(tasks[0], 'hydra') };
writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(path.join(directory, 'gold.json'), JSON.stringify(tasks.map(t => ({ id: t.id, expected: t.expected })), null, 2));
const report = { date: new Date().toISOString(), manifest, sessions: [], summary: {}, status: runPaid ? 'running' : 'prepared' };
const save = () => writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
save();
if (!runPaid) {
  console.log(JSON.stringify({ status: 'prepared; no model calls made', directory, maximumSessions: manifest.maximumSessions,
    configuredBudgetUsd: manifest.configuredBudgetUsd, maximumSeconds, taskIds: tasks.map(t => t.id) }, null, 2));
  fixture.cleanup();
} else {
  const started = Date.now();
  let spent = 0;
  outer: for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    // Alternate which arm runs first, to reduce a systematic warm-cache order bias.
    for (const arm of i % 2 ? [...arms].reverse() : arms) {
      const left = maximumSeconds * 1000 - (Date.now() - started);
      if (left <= 0 || spent >= manifest.configuredBudgetUsd) { report.status = 'limit-reached'; break outer; }
      const work = path.join(workspaceRoot, task.id, arm);
      mkdirSync(path.dirname(work), { recursive: true });
      cpSync(fixture.cwd, work, { recursive: true });
      const execution = await session(command(task, arm), work, Math.min(left, 180000));
      writeFileSync(path.join(directory, task.id, `${arm}.jsonl`), execution.stdout);
      writeFileSync(path.join(directory, task.id, `${arm}.stderr.txt`), execution.stderr);
      const metrics = inspect(task, execution);
      // Unexpected delegation in the direct arm invalidates that comparison.
      if (arm === 'plain' && metrics.hydraCalls) metrics.correct = false;
      report.sessions.push({ task: task.id, arm, ...metrics });
      spent += metrics.costUsd ?? 0;
      save();
      console.log(`${task.id} ${arm}: completed=${metrics.finished} correct=${metrics.correct} input=${metrics.inputTokens} output=${metrics.outputTokens} hydraCalls=${metrics.hydraCalls} ${metrics.seconds.toFixed(1)}s`);
      if (!metrics.finished && !metrics.answer) { report.status = 'execution-error'; break outer; }
    }
  }
  for (const arm of arms) {
    const list = report.sessions.filter(r => r.arm === arm);
    report.summary[arm] = { sessions: list.length, correct: list.filter(r => r.finished && r.correct).length,
      ...Object.fromEntries(['inputTokens', 'outputTokens', 'toolCalls', 'toolErrors', 'turns', 'costUsd', 'seconds', 'hydraCalls'].map(k => [k, list.reduce((s, r) => s + (r[k] ?? 0), 0)])) };
  }
  const matched = tasks.filter(t => arms.every(a => report.sessions.some(r => r.task === t.id && r.arm === a && r.finished && r.correct)));
  report.equalCorrectness = Object.fromEntries(arms.map(arm => [arm, report.sessions.filter(r => r.arm === arm && matched.some(t => t.id === r.task))
    .reduce((s, r) => ({ tasks: s.tasks + 1, inputTokens: s.inputTokens + r.inputTokens, outputTokens: s.outputTokens + r.outputTokens }), { tasks: 0, inputTokens: 0, outputTokens: 0 })]));
  report.resolvedModels = [...new Set(report.sessions.map(r => r.model).filter(Boolean))];
  report.comparable = report.resolvedModels.length === 1 && report.sessions.length === tasks.length * arms.length
    && report.sessions.every(r => r.usageAvailable);
  if (report.status === 'running') report.status = 'complete';
  save();
  fixture.cleanup();
  console.log(JSON.stringify({ status: report.status, directory, summary: report.summary, equalCorrectness: report.equalCorrectness, comparable: report.comparable }, null, 2));
}
