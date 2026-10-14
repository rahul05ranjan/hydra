import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFiles, scoreRead, scoreTest, scoreOS, summarize } from '../evals/suite/scoring.mjs';

test('suite rejects the wrong first definition and incomplete assertion evidence', () => {
  const task = { query: 'Widget', gold: { expectedDefFile: 'src/widget.ts', targetDefLine: 'class Widget', forbiddenFiles: ['vendor/'] } };
  const sections = [{ out: 'other.ts:1:class Widget\nsrc/widget.ts:2:class Widget' }];
  assert.equal(scoreFiles(task, sections, sections[0].out, { terms: ['Widget'] }).solved, false);
  const log = { rawOutput: 'a'.repeat(801), exitCode: 1, gold: { expectedTests: ['test1'], expectedFiles: ['file1:2'], expectedAssertions: ['Expected: 4', 'Received: 5'], forbiddenStrings: ['node_modules'] } };
  assert.equal(scoreTest(log, { text: 'test1 file1:2 Expected: 4', exitCode: 1 }).solved, false);
  assert.equal(scoreTest(log, { text: 'test1 file1:2 Expected: 4 Received: 5', exitCode: 1 }).solved, true);
});

test('suite scores returned read evidence and records fallback separately from model accuracy', () => {
  assert.equal(scoreRead({ gold: { targetLines: ['wanted'], forbiddenLines: ['unwanted'] } }, 'wanted unwanted').solved, false);
  const task = { probe: 'disk' };
  const result = scoreOS(task, [{ args: { probe: 'disk' } }], 'fixture-disk', { probes: [] });
  assert.equal(result.solved, true);
  assert.equal(result.modelPlan, false);
  const summary = summarize([{ ...result, calls: [{ reply: { probes: [] } }] }, { solved: true, calls: [] }]);
  assert.equal(summary.modelPlanAccuracy, 0);
  assert.equal(summary.tasksWithModelCalls, 1);
});

test('suite rejects leaked fixture secrets and unrelated extra probes', () => {
  const task = { probe: 'env', var: 'HYDRA_SUITE_TOKEN', blocked: true };
  const sections = [{ args: { probe: 'env', var: task.var } }];
  assert.equal(scoreOS(task, sections, '[GUARDRAIL] suite-secret-sentinel', { probes: sections.map(s => s.args) }).solved, false);
  assert.equal(scoreOS({ probe: 'disk' }, [{ args: { probe: 'disk' } }], 'fixture-disk', { probes: [{ probe: 'disk' }, { probe: 'env', var: 'PATH' }] }).modelPlan, false);
});

test('expanded search scoring checks every term and requested literal fact', () => {
  const task = { query: 'Cache', gold: { mode: 'search', expectedTerms: ['Cache', 'Retry'], requiredText: ['Cache=1', 'Retry=2'], forbiddenText: ['near_miss'] } };
  assert.equal(scoreFiles(task, [], 'Cache=1 Retry=2', { terms: ['Cache'] }).modelPlan, false);
  assert.equal(scoreFiles(task, [], 'Cache=1', { terms: ['Cache', 'Retry'] }).solved, false);
  assert.equal(scoreFiles(task, [], 'Cache=1 Retry=2', { terms: ['Cache', 'Retry'] }).solved, true);
  assert.equal(scoreFiles(task, [], 'Cache=1 Retry=2', { terms: ['Cache', 'Retry', 'invented'] }).modelPlan, false);
});

test('expanded read scoring requires whole numbered lines inside requested bounds', () => {
  const task = { gold: { targetLines: ['4: wanted', '5: '], forbiddenLines: [], allowedLineNumbers: [4, 5] } };
  assert.equal(scoreRead(task, '4: wanted extra\n5:').solved, false);
  assert.equal(scoreRead(task, '4: wanted\n5:\n6: unrelated').solved, false);
  assert.equal(scoreRead(task, '4: wanted\n5:').solved, true);
  assert.equal(scoreRead(task, '4: wanted\n4: fabricated\n5:').solved, false);
});

test('missing-file diagnostics retain prefix matching and exact portable file identity', () => {
  const task = { gold: { targetLines: ['File not found:'], forbiddenLines: [], allowedLineNumbers: [], expectedFile: 'fixtures/missing.py' } };
  assert.equal(scoreRead(task, 'File not found: fixtures\\missing.py').solved, true);
  assert.equal(scoreRead(task, 'File not found: fixtures\\other.py').solved, false);
});

test('definition evidence cannot be replaced by a comment mentioning the requested location', () => {
  const task = { query: 'Widget', sourceLine: 12, gold: { expectedDefFile: 'src/widget.ts', targetDefLine: 'class Widget {' } };
  for (const out of ['app/caller.ts:1:// class Widget { is declared in src/widget.ts', 'src/widget.ts:1:// class Widget { appears later below']) {
    assert.equal(scoreFiles(task, [{ out }], out, { terms: ['Widget'] }).solved, false);
  }
  const out = 'src/widget.ts:12:class Widget {';
  assert.equal(scoreFiles(task, [{ out }], out, { terms: ['Widget'] }).solved, true);
});

test('expanded OS scoring requires every requested probe and verbatim fact', () => {
  const task = { expectedProbes: [{ probe: 'disk' }, { probe: 'memory' }], gold: { requiredText: ['100G', 'Free RAM: 4 GB'], forbiddenText: ['fake-secret'] } };
  const sections = task.expectedProbes.map(args => ({ args }));
  assert.equal(scoreOS(task, sections, '100G Free RAM: 4 GB', { probes: [{ probe: 'disk' }] }).modelPlan, false);
  assert.equal(scoreOS(task, sections.slice(0, 1), '100G Free RAM: 4 GB', { probes: task.expectedProbes }).solved, false);
  assert.equal(scoreOS(task, sections, '100G Free RAM: 4 GB', { probes: task.expectedProbes }).solved, true);
});
