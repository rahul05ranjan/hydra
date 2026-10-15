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

test('small failure regions are returned whole without a model call', async () => {
  const out = ['setup line '.repeat(20), 'FAIL tests/cart.test.ts > totals', 'AssertionError: expected 41 to equal 42',
    '  context: cart has three items', 'at tests/cart.test.ts:12:5',
    ...Array.from({ length: 60 }, (_, i) => `node_modules/runner.js:${i}`)].join('\n');
  let calls = 0;
  const res = await digest({ cmd: 'npx vitest run', out, exitCode: 1 }, async () => { calls++; return { lines: [1] }; });
  assert.equal(calls, 0);
  for (const line of ['FAIL tests/cart.test.ts > totals', 'AssertionError: expected 41 to equal 42', 'at tests/cart.test.ts:12:5']) {
    assert.ok(res.text.includes(line), line);
  }
  assert.doesNotMatch(res.text, /node_modules/);
});

test('failure digests keep PHP/Elixir locations and numbered headers but drop runtime library frames', async () => {
  const pad = Array.from({ length: 30 }, (_, i) => `setup step ${i} completed without incident`).join('\n');
  const cases = [
    ['1) test slug is normalized (App.SlugTest)\n     test/app/slug_test.exs:31\n     Assertion with == failed\n     left:  "a"\n     right: "b"',
      ['1) test slug is normalized (App.SlugTest)', 'test/app/slug_test.exs:31'], []],
    ["1) Tests\\InvoiceTest::testNumber\nFailed asserting that two strings are identical.\n-'x'\n+'y'\n\n/srv/app/tests/InvoiceTest.php:117\n\nFAILURES!",
      ['InvoiceTest.php:117'], []],
    ['--- FAIL: TestWindow (0.00s)\npanic: runtime error: index out of range [5] with length 5\ngoroutine 7 [running]:\n\t/usr/local/go/src/testing/testing.go:1632 +0x1bc\n\t/home/ci/app/ring.go:61\nFAIL',
      ['ring.go:61'], ['go/src/testing/testing.go']],
    ['ServiceTest > total() FAILED\n    org.opentest4j.AssertionFailedError: expected: <1> but was: <2>\n        at app//org.junit.jupiter.api.AssertionFailureBuilder.build(AssertionFailureBuilder.java:151)\n        at app//com.example.ServiceTest.total(ServiceTest.java:44)',
      ['ServiceTest.java:44', 'expected: <1> but was: <2>'], ['AssertionFailureBuilder.java']],
    ['error: AssertionError: Values are not equal.\n    at assertEquals (https://jsr.io/@std/assert/1.0.13/equals.ts:64:9)\n    at file:///home/ci/app/app_test.ts:148:3',
      ['app_test.ts:148:3'], ['jsr.io/@std/assert']],
  ];
  for (const [body, wanted, unwanted] of cases) {
    const { text } = await digest({ cmd: 'run tests', out: `${pad}\n${body}`, exitCode: 1 }, async () => ({ lines: [] }));
    for (const fact of wanted) assert.ok(text.includes(fact), fact);
    for (const noise of unwanted) assert.ok(!text.includes(noise), noise);
  }
});

test('AVA cross-mark failures are failure headers', async () => {
  const pad = Array.from({ length: 30 }, (_, i) => `setup step ${i} completed without incident`).join('\n');
  const out = `${pad}\n  ✔ cart › loads defaults\n  ✘ [fail]: cart › merges overrides\n\n  test/cart.js:12\n\n  - 'a'\n  + 'b'\n\n  1 test failed`;
  const { text } = await digest({ cmd: 'npx ava', out, exitCode: 1 }, async () => ({ lines: [] }));
  assert.ok(text.includes('✘ [fail]: cart › merges overrides'));
});

test('passing log digests keep both pass and failure counts', async () => {
  const out = 'runner progress\n'.repeat(80) + 'Tests: 4 passed, 4 total\nFailures: 0\n';
  const res = await digest({ cmd: 'node pass.mjs', out, exitCode: 0 }, async () => assert.fail('model not needed'));
  assert.match(res.text, /Tests: 4 passed, 4 total/);
  assert.match(res.text, /Failures: 0/);
});
