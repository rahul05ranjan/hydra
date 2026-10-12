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
