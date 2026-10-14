import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { answer } from '../skills/hydra/scripts/lib/answer.mjs';
import { gather } from '../skills/hydra/scripts/lib/git.mjs';
import { digest } from '../skills/hydra/scripts/lib/test_logs.mjs';

test('commit evidence cannot acquire a false model interpretation', async () => {
  const out = 'abc1234: Record that README and trial script stay private\n---\n TRACKER.md | 5 +++--\n'
    + Array.from({ length: 30 }, (_, i) => ` context ${i} ${'x'.repeat(30)}`).join('\n');
  const { text } = await answer('what did the last commit change?', [{ probe: 'show', cmd: 'git show HEAD', out }],
    async () => ({ answer: 'The last commit changed the README and trial script.', lines: [1, 3] }));
  assert.match(text, /TRACKER\.md \| 5/);
  assert.doesNotMatch(text, /The last commit changed the README and trial script/);
});

test('recent commit lists retain every requested record despite model citations', async () => {
  const commits = Array.from({ length: 5 }, (_, i) => `${String(i).padStart(7, 'a')} 2026-10-10 Dev: ${'message '.repeat(25)}${i}`);
  const { text } = await answer('show the recent 5 commits', [{ probe: 'log', cmd: 'git log -n5', out: commits.join('\n') }],
    async () => ({ answer: 'The newest commit is listed.', lines: [1] }));
  for (const commit of commits) assert.ok(text.includes(commit), 'lost a requested commit or part of its message');
  assert.doesNotMatch(text, /more lines not shown/);
});

test('an explicit commit count overrides a wrong model count', async t => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'hydra-count-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.invalid', ...args], { cwd, encoding: 'utf8' });
  git('init', '-q');
  for (let i = 0; i < 5; i++) {
    writeFileSync(path.join(cwd, 'value.txt'), `${i}\n`);
    git('add', 'value.txt');
    git('commit', '-qm', `Update value ${i}`);
  }
  for (const question of ['show the recent 5 commits', 'show the latest five commits', 'show five recent commits',
    'show five branch-only commits', 'return up to five revisions', 'read the five latest commit records']) {
    const sections = await gather(question, cwd, async () => ({ probes: [{ probe: 'log', n: 1 }] }));
    assert.equal(sections[0].args.n, 5);
    assert.equal(sections[0].out.trim().split('\n').length, 5);
  }
});

test('failure evidence keeps the diff without adding a model-invented cause', async () => {
  const out = ['FAIL src/auth.test.ts > login', 'AssertionError: expected 200 to be 401',
    '- Expected: 401', '+ Received: 200', 'at src/auth.test.ts:42:18',
    ...Array.from({ length: 50 }, (_, i) => `node_modules/runner.js:${i}`)].join('\n');
  const result = await digest({ cmd: 'node fail.mjs', out, exitCode: 1 },
    async () => ({ summary: 'Authentication credentials were not validated.', lines: [1] }));
  assert.doesNotMatch(result.text, /Authentication credentials were not validated/);
  assert.match(result.text, /- Expected: 401/);
  assert.match(result.text, /\+ Received: 200/);
  assert.match(result.text, /auth\.test\.ts:42:18/);
});

test('last-commit requests cannot be redirected to uncommitted diffs', async t => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'hydra-last-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.invalid', ...args], { cwd, encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(path.join(cwd, 'committed.txt'), 'Committed value\n');
  git('add', '.');
  git('commit', '-qm', 'Record release policy');
  writeFileSync(path.join(cwd, 'committed.txt'), 'Uncommitted value\n');
  const sections = await gather('what files changed in the last commit?', cwd, async () => ({ probes: [{ probe: 'diff' }] }));
  assert.equal(sections[0].probe, 'show');
  assert.doesNotMatch(sections[0].out, /Uncommitted value/);
});

test('passing log digests keep both pass and failure counts', async () => {
  const out = 'runner progress\n'.repeat(80) + 'Tests: 4 passed, 4 total\nFailures: 0\n';
  const res = await digest({ cmd: 'node pass.mjs', out, exitCode: 0 }, async () => assert.fail('model not needed'));
  assert.match(res.text, /Tests: 4 passed, 4 total/);
  assert.match(res.text, /Failures: 0/);
});
