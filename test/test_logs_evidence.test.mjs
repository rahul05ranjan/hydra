import assert from 'node:assert/strict';
import test from 'node:test';
import { digest, extractFailureCandidates } from '../skills/hydra/scripts/lib/test_logs.mjs';

const progress = count => Array.from({ length: count }, (_, i) =>
  `worker ${i % 3} warmed partition ${i}; checksum verified; no exception occurred`).join('\n');
const cite = (out, text) => ({ lines: [out.split('\n').findIndex(line => line.includes(text)) + 1] });

test('TAP failure name and mjs location survive a minimal assertion citation', async () => {
  const out = `${progress(30)}\n# Subtest: restores capsule boundary\nnot ok 4 - restores capsule boundary\n  ---\n  duration_ms: 1.443\n  location: 'C:\\Quality Lab\\test_boundary.mjs:12:1'\n  failureType: 'testCodeFailure'\n  error: 'capsule label differs'\n  expected: 'sealed'\n  actual: 'open'\n  operator: 'strictEqual'\n  diagnostic_a: 'metadata'\n  diagnostic_b: 'metadata'\n  diagnostic_c: 'metadata'\n  stack: |-\n    TestContext.<anonymous> (C:\\Quality Lab\\test_boundary.mjs:18:8)\n    Test.runInAsyncScope (node:async_hooks:214:14)\n  ...\n# tests 4\n# pass 3\n# fail 1`;
  const result = await digest({ cmd: 'node --test test_boundary.mjs', out, exitCode: 1 },
    async () => cite(out, "error: 'capsule label differs'"));
  for (const fact of ['restores capsule boundary', 'test_boundary.mjs:18:8', "expected: 'sealed'", "actual: 'open'"])
    assert.ok(result.text.includes(fact), `lost ${fact}`);
  assert.equal(result.exitCode, 1);
});

test('CJS source locations after a long TAP assertion block are candidates', () => {
  const out = `${progress(20)}\nnot ok 1 - parses frame\n  error: 'frame mismatch'\n${progress(12)}\n    at TestContext.<anonymous> (/work/frame.test.cjs:71:9)`;
  assert.ok(extractFailureCandidates(out).some(line => line.text.includes('frame.test.cjs:71:9')));
});

test('unittest preserves the actual Python exception and quoted source location', async () => {
  const out = `${progress(30)}\nERROR: test_lookup (CapsuleTests.test_lookup)\n----------------------------------------------------------------------\nTraceback (most recent call last):\n  File "C:\\Quality Lab\\test_capsule.py", line 42, in test_lookup\n    load_capsule()\n  File "C:\\Quality Lab\\decoder.py", line 73, in load_capsule\n    table['origin']\nKeyError: 'origin'\n----------------------------------------------------------------------\nRan 7 tests in 0.021s\nFAILED (errors=1)`;
  const result = await digest({ cmd: 'python -m unittest', out, exitCode: 1 },
    async () => cite(out, 'ERROR: test_lookup'));
  for (const fact of ['test_lookup', 'decoder.py', 'line 73', "KeyError: 'origin'"])
    assert.ok(result.text.includes(fact), `lost ${fact}`);
});

test('large passing unittest output retains run and skipped counts without a model', async () => {
  const out = `${progress(40)}\n................s\n----------------------------------------------------------------------\nRan 17 tests in 0.021s\n\nOK (skipped=1)`;
  const result = await digest({ cmd: 'python -m unittest', out, exitCode: 0 },
    async () => assert.fail('passing output needs no model'));
  assert.ok(result.text.includes('Ran 17 tests in 0.021s'));
  assert.ok(result.text.includes('OK (skipped=1)'));
});

test('late failure evidence outranks earlier incidental source traces within the candidate cap', async () => {
  const out = `${Array.from({ length: 90 }, (_, i) => `TRACE cache checkpoint support/cache_${i}.ts:${i + 8}:2 completed`).join('\n')}\nFAIL tests/final_packet.test.ts > final packet survives\nAssertionError: wrong final label\nExpected: sealed-capsule\nReceived: open-capsule\n    at tests/final_packet.test.ts:117:8\nTests: 1 failed, 90 passed, 91 total`;
  const candidates = extractFailureCandidates(out);
  assert.ok(candidates.length <= 60);
  const result = await digest({ cmd: 'npx jest', out, exitCode: 1 },
    async () => cite(out, 'FAIL tests/final_packet.test.ts'));
  for (const fact of ['final packet survives', 'sealed-capsule', 'open-capsule', 'final_packet.test.ts:117:8'])
    assert.ok(result.text.includes(fact), `lost ${fact}`);
  assert.ok(result.text.split('\n').length <= 61, 'display exceeds selected-candidate bound');
});

test('launch diagnostics after verbose setup retain the failed executable and reason', async () => {
  for (const diagnostic of [
    '/bin/sh: 1: missing-capsule-test: not found',
    "missing-capsule-test : The term 'missing-capsule-test' is not recognized as the name of a cmdlet, function, script file, or operable program.",
  ]) {
    const out = `${progress(50)}\n${diagnostic}\nRunner was never started.`;
    const result = await digest({ cmd: 'missing-capsule-test --run', out, exitCode: 127 },
      async () => cite(out, diagnostic));
    assert.ok(result.text.includes(diagnostic));
    assert.equal(result.exitCode, 127);
    assert.doesNotMatch(result.text, /All tests passed/);
  }
});

test('unrecognized failing logs retain a bounded final diagnostic in the fallback', async () => {
  const diagnostic = 'Execution outcome: child was absent; exit status 127.';
  const out = `${progress(70)}\n${diagnostic}`;
  const result = await digest({ cmd: 'fixed-check', out, exitCode: 127 },
    async () => assert.fail('no recognizable evidence requires no model'));
  assert.ok(result.text.includes(diagnostic));
  assert.ok(result.text.split('\n').length <= 17);
});

test('failure candidates retain original line numbers and ignore framework stacks', () => {
  const out = `${progress(25)}\nFAIL tests/capsule.test.ts > checks checksum\nAssertionError: checksum differs\nExpected: 7\nReceived: 9\n    at tests/capsule.test.ts:31:8\n    at node_modules/runner-runtime/dispatch.js:83:6`;
  const candidates = extractFailureCandidates(out);
  for (const candidate of candidates) assert.equal(out.split('\n')[candidate.id - 1], candidate.text);
  assert.ok(!candidates.some(c => c.text.includes('node_modules')));
});

test('empty output preserves exit status without claiming a passing test suite', async () => {
  const result = await digest({ cmd: 'node silent.mjs', out: '', exitCode: 0 },
    async () => assert.fail('empty output needs no model'));
  assert.equal(result.text, '$ node silent.mjs\n');
  assert.equal(result.exitCode, 0);
});

test('a log with more failures than the candidate cap keeps the first failure location and the summary', async () => {
  const blocks = Array.from({ length: 30 }, (_, i) =>
    `FAIL src/batch_${i}.test.ts\n  ● batch case ${i}\n    Expected: "sealed-${i}"\n    Received: "open-${i}"\n      at Object.<anonymous> (src/batch_${i}.test.ts:119:9)`).join('\n');
  const out = `${progress(20)}\n${blocks}\nTest Suites: 30 failed, 2 passed, 32 total\nTests:       30 failed, 9 passed, 39 total`;
  const candidates = extractFailureCandidates(out);
  assert.ok(candidates.length <= 60);
  const result = await digest({ cmd: 'npx jest', out, exitCode: 1 },
    async () => cite(out, 'FAIL src/batch_0.test.ts'));
  for (const fact of ['batch case 0', 'sealed-0', 'open-0', 'src/batch_0.test.ts:119:9', 'Tests:       30 failed'])
    assert.ok(result.text.includes(fact), `lost ${fact}`);
});
