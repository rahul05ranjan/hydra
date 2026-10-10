import assert from 'node:assert/strict';
import { test } from 'node:test';
import { command, parseRun, schedule, summarize } from '../evals/trial/real_repo_protocol.mjs';
import { pairedComparison } from '../evals/trial/analyze_real_repo.mjs';

const task = { id: 'code', request: 'Find function f.', schema: {}, expected: { file: 'src/a.py', startLine: 1, endLine: 2, source: 'def f():\n    return 1' } };
test('repeat schedule gives every task every arm three times and balances first position', () => {
  const rows = schedule([task]);
  assert.equal(rows.length, 9);
  assert.deepEqual([0, 1, 2].map(r => rows.find(x => x.repeat === r).arm), ['plain', 'available', 'forced']);
  for (const a of ['plain', 'available', 'forced']) assert.equal(rows.filter(x => x.arm === a).length, 3);
});
test('natural-adoption prompt does not instruct Hydra usage and all arms share permissions', () => {
  const a = command(task, 'available', '/tmp/case'), p = command(task, 'plain', '/tmp/case'), f = command(task, 'forced', '/tmp/case');
  const system = args => args[args.indexOf('--append-system-prompt') + 1];
  assert.equal(system(a), system(p));
  assert.doesNotMatch(system(a), /hydra/i);
  assert.match(system(f), /Invoke the hydra skill/);
  assert.ok(!a.includes('--safe-mode') && !a.includes('--disable-slash-commands'));
  assert.equal(a[a.indexOf('--setting-sources') + 1], 'project');
});
test('startup discovery, complete source and permission denials are checked independently', () => {
  const make = (skills, answer, denied = false) => ({ error: null, exitCode: 0, seconds: 1,
    stdout: [ { type: 'system', subtype: 'init', model: 'claude-opus-5-5', skills },
      ...(denied ? [{ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Permission to use Bash has been denied' }] } }] : []),
      { type: 'result', structured_output: answer, usage: { input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 5 } } ].map(JSON.stringify).join('\n') });
  const ok = parseRun(task, make(['hydra'], task.expected), 'available');
  assert.equal(ok.correct, true); assert.equal(ok.availabilityValid, true); assert.equal(ok.inputTokens, 30);
  assert.equal(parseRun(task, make([], task.expected), 'available').availabilityValid, false);
  assert.equal(parseRun(task, make(['hydra'], task.expected), 'plain').availabilityValid, false);
  assert.equal(parseRun(task, make(['hydra'], { ...task.expected, source: 'def f():' }), 'available').correct, false);
  assert.equal(parseRun(task, make(['hydra'], task.expected, true), 'available').permissionDenials, 1);
  assert.equal(parseRun(task, make(['hydra'], { ...task.expected, file: './src/a.py' }), 'available').correct, true);
});

test('task-cluster intervals keep repeated pairs together and include heterogeneous outcomes', () => {
  const rows = ['A', 'B'].flatMap(task => [0, 1, 2].flatMap(repeat => ['plain', 'available'].map(arm => ({ task, repeat, arm,
    finished: true, correct: true, sourceUnchanged: true, availabilityValid: true, permissionDenials: 0, usageAvailable: true,
    inputTokens: arm === 'plain' ? 100 : task === 'A' ? 50 : 200, outputTokens: 0 }))));
  const c = pairedComparison(rows, ['A', 'B'], 'available');
  assert.equal(c.eligiblePairs, 6); assert.equal(c.totalTokenReductionPct, -25);
  assert.deepEqual(c.exploratory95PctClusterInterval, [-100, 50]);
});
test('matched correctness excludes an incomplete answer without hiding overall failure', () => {
  const rows = ['plain', 'available', 'forced'].map(arm => ({ task: 'code', repeat: 0, arm, finished: true,
    correct: arm !== 'forced', availabilityValid: true, permissionDenials: 0, sourceUnchanged: true, usageAvailable: true,
    inputTokens: 10, outputTokens: 5 }));
  const r = summarize(rows, ['code']);
  assert.equal(r.byArm.forced.correct, 0); assert.equal(r.matchedBlocks, 0); assert.equal(r.matchedReductionPct.forced, null);
});
