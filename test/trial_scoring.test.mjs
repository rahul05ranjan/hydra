import assert from 'node:assert/strict';
import { test } from 'node:test';
import { score } from '../evals/trial/scoring.mjs';

const run = stdout => ({ stdout, stderr: '', exitCode: 0, error: null });
test('strict scoring rejects missing commits even when generic words are present', () => {
  const spec = { gold: { kind: 'commits', records: ['abcdef1 2026-10-10 Dev: first', 'abcdef2 2026-10-09 Dev: second'] } };
  assert.equal(score(spec, run('commit\nabcdef1 2026-10-10 Dev: first')).passed, false);
});
test('strict scoring cannot satisfy failure facts from a command label', () => {
  const spec = { expectedExitCode: 1, gold: { kind: 'log', lines: ['- Expected: 18', '+ Received: 19'] } };
  assert.equal(score(spec, { ...run('$ echo "- Expected: 18 + Received: 19"'), exitCode: 1 }, true).passed, false);
});
test('strict scoring verifies empty stash output and execution status independently', () => {
  const spec = { gold: { kind: 'stash', records: [] } };
  assert.equal(score(spec, run(''), true).passed, false);
  assert.equal(score(spec, run('$ git stash list\n(no output)'), true).passed, true);
  assert.equal(score(spec, { ...run('(no output)'), exitCode: 2 }, true).passed, false);
});
