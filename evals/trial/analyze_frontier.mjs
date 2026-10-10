#!/usr/bin/env node
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const directory = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Provide the directory containing the completed report.json and session traces');
const reportPath = path.join(directory, 'report.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
if (!existsSync(path.join(directory, 'report.raw.json'))) copyFileSync(reportPath, path.join(directory, 'report.raw.json'));
const gold = JSON.parse(readFileSync(path.join(directory, 'gold.json'), 'utf8'));
for (const session of report.sessions) {
  const events = readFileSync(path.join(directory, session.task, `${session.arm}.jsonl`), 'utf8').split('\n')
    .filter(l => l.startsWith('{')).map(l => JSON.parse(l));
  const receipt = events.findLast(e => e.type === 'result');
  assert.ok(receipt && !receipt.is_error, 'missing successful final receipt');
  let traceAnswer = receipt.structured_output;
  if (traceAnswer === undefined) traceAnswer = JSON.parse(receipt.result.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  assert.deepEqual(session.answer, traceAnswer, 'saved answer differs from the original trace');
  assert.equal(session.inputTokens, ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((s, k) => s + (receipt.usage[k] ?? 0), 0));
  assert.equal(session.outputTokens, receipt.usage.output_tokens);
  const blocks = events.filter(e => e.type === 'user').flatMap(e => Array.isArray(e.message?.content) ? e.message.content : []).filter(b => b.type === 'tool_result');
  session.permissionDenials = blocks.filter(b => b.is_error && /Permission to use .* has been denied/.test(JSON.stringify(b.content))).length;
  session.expectedNonzeroResults = session.task === 'failure' ? blocks.filter(b => b.is_error && /^Exit code 1/.test(String(b.content))).length : 0;
  assert.equal(session.usageAvailable, true);
  const expected = gold.find(g => g.id === session.task)?.expected;
  // Independently verify the final JSON, normalizing only unordered file/usage sets.
  const normalize = object => {
    const copy = JSON.parse(JSON.stringify(object));
    for (const key of ['changes', 'files', 'usages']) if (Array.isArray(copy[key])) copy[key].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return copy;
  };
  let independentCorrect = false;
  if (session.answer !== null) {
    try { assert.deepEqual(normalize(session.answer), normalize(expected)); independentCorrect = true; } catch { /* retained as a scored failure */ }
  }
  assert.equal(session.correct, independentCorrect, 'recorded score differs from independent JSON check');
}
const compare = tasks => {
  const sum = arm => report.sessions.filter(s => s.arm === arm && tasks.includes(s.task)).reduce((a, s) => ({
    sessions: a.sessions + 1, inputTokens: a.inputTokens + s.inputTokens, outputTokens: a.outputTokens + s.outputTokens,
    totalTokens: a.totalTokens + s.inputTokens + s.outputTokens, seconds: a.seconds + s.seconds, costEquivalentUsd: a.costEquivalentUsd + (s.costUsd ?? 0),
  }), { sessions: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, seconds: 0, costEquivalentUsd: 0 });
  const plain = sum('plain'), hydra = sum('hydra');
  return { tasks, plain, hydra, tokenReductionPct: plain.totalTokens ? Number(((1 - hydra.totalTokens / plain.totalTokens) * 100).toFixed(2)) : null,
    costEquivalentReductionPct: plain.costEquivalentUsd ? Number(((1 - hydra.costEquivalentUsd / plain.costEquivalentUsd) * 100).toFixed(2)) : null };
};
const tasks = report.manifest.tasks.map(t => t.id);
const clean = tasks.filter(t => report.sessions.filter(s => s.task === t).length === 2 && report.sessions.filter(s => s.task === t).every(s => s.finished && s.correct && s.permissionDenials === 0));
report.analysis = {
  overall: compare(tasks), permissionUnconfoundedPairs: compare(clean),
  byTask: tasks.map(task => compare([task])),
  limitations: [
    'Six hand-written repository-inspection tasks, one run per arm; not a broad or repeated coding-workload evaluation.',
    'Explicit Hydra delegation was requested; spontaneous adoption was not measured. The Hydra arm sometimes also ran direct verification commands.',
    'A whitelist denied git diff-tree in the direct last-commit task, and exit-code echo commands in both failure arms. The overall token reduction is confounded by these artificial permission retries.',
    'The four no-permission-denial pairs exclude last_commit and failure; this subset is reported transparently and cannot substitute for a fresh predeclared trial.',
    'Reported input tokens include cache creation and cache reads. Monetary figures are Claude Code reported API-cost equivalents, not a Pro-account bill or a measure of subscription allowance.',
    'Cache reuse and arm order affect cost; task order alternated but each task had only one pair. Concurrent local training was recorded in TRACKER.md, so latency is exploratory.',
    'The whitelist has been corrected for future runs. No additional paid run was started.',
  ],
};
writeFileSync(reportPath, JSON.stringify(report, null, 2));
writeFileSync(path.join(directory, 'analysis.json'), JSON.stringify(report.analysis, null, 2));
console.log(JSON.stringify(report.analysis, null, 2));
