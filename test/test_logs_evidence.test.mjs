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
  assert.equal(result.text, '(no output)');
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

const facts = (result, wanted) => { for (const fact of wanted) assert.ok(result.text.includes(fact), `lost ${fact}`); };
const absent = (result, unwanted) => { for (const noise of unwanted) assert.ok(!result.text.includes(noise), `kept ${noise}`); };
const noModel = async () => ({ lines: [] });

test('CI timestamps and colour codes do not hide numbered headers or FAIL markers', async () => {
  const stamp = (text, start = 0) => text.split('\n').map((l, i) => `2026-10-16T09:20:${String((start + i) % 60).padStart(2, '0')}.4900053Z ${l}`).join('\n');
  const mocha = `${progress(25)}\n  1 failing\n\n  1) CapsuleLedger\n       posts a capsule credit:\n\n      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n'open-capsule' !== 'sealed-capsule'\n\n      at Context.<anonymous> (test/capsule.spec.js:14:14)`;
  facts(await digest({ cmd: 'npx mocha', out: stamp(mocha), exitCode: 1 }, noModel), ['posts a capsule credit', "'open-capsule' !== 'sealed-capsule'", 'capsule.spec.js:14']);
  const karma = `${progress(25)}\nChrome Headless 129 (Linux x86_64) CapsuleService computes total \x1b[31;1mFAILED\x1b[0m\n\tExpected 13 to equal 11.\n\t    at UserContext.apply (src/app/capsule.service.spec.ts:129:11)\nTOTAL: 1 \x1b[31;1mFAILED\x1b[0m, 40 SUCCESS`;
  facts(await digest({ cmd: 'npx ng test', out: karma, exitCode: 1 }, noModel), ['Expected 13 to equal 11.']);
});

test('runtime and toolchain frames are ignored across ecosystems', () => {
  const frames = [
    '             at /rustc/f6e511eec7342f59a25f7c0534f1dbea00d01b14/library/core/src/result.rs:1700:5',
    '      /opt/hostedtoolcache/go/1.23.2/x64/src/testing/testing.go:1690 +0x226',
    '\tC:/hostedtoolcache/windows/go/1.23.2/x64/src/time/sleep.go:215 +0x2d',
    '   at System.Linq.Enumerable.First[TSource](IEnumerable`1 source, Func`2 predicate)',
    "    /usr/local/bundle/gems/activerecord-7.2.1/lib/active_record/relation/delegation.rb:100:in `each'",
    '    #2 0x7f1b2c829d8f in __libc_start_call_main ../sysdeps/nptl/libc_start_call_main.h:58:16',
    "/usr/include/c++/14/bits/stl_vector.h:1281:7: note: candidate function not viable",
    '  File "C:\\hostedtoolcache\\windows\\Python\\3.12.7\\x64\\Lib\\threading.py", line 355 in wait',
    '/usr/lib/zig/std/testing.zig:103:17: 0x10457c3 in expectEqualInner__anon_1734 (test)',
    '   @ ~/.julia/juliaup/julia-1.10.5+0.x64.linux.gnu/share/julia/stdlib/v1.10/Test/src/Test.jl:672 [inlined]',
    '  package:flutter_test/src/widget_tester.dart 474:18  expect',
    'Raised at Alcotest_engine__Test.check in file "src/alcotest-engine/test.ml", line 216, characters 4-261',
  ];
  const out = `${progress(10)}\nFAIL capsule check\n${frames.join('\n')}\n    at Context.<anonymous> (test/capsule.spec.js:14:14)`;
  const kept = extractFailureCandidates(out).map(c => c.text);
  for (const frame of frames) assert.ok(!kept.includes(frame), `kept runtime frame ${frame}`);
  assert.ok(kept.some(text => text.includes('capsule.spec.js:14:14')));
});

test('source locations written as line N, (N,M), file N:M and other languages are candidates', () => {
  const locations = [
    '     at Capsule.Tests.InvoiceTests.ComputesTotal() in D:\\a\\capsule\\tests\\InvoiceTests.cs:line 159',
    'File "src/capsule_ledger.ml", line 37, characters 5-17:',
    'In scripts/capsule-deploy.sh line 101:',
    '   (in test file test/capsule_deploy.bats, line 127)',
    'D:\\a\\capsule\\src\\ledger.cpp(42,10): message : There is no context in which this conversion is possible',
    '  test/capsule_cart_test.dart 42:7               main.<fn>.<fn>',
    'capsule ledger: Test Failed at /home/runner/work/capsule/test/runtests.jl:42',
    'spec/capsule_ledger_spec.lua:45: Expected objects to be the same.',
    '/home/runner/work/capsule/src/routes/+page.svelte:42:5',
  ];
  const out = `${progress(60)}\n${locations.join('\n')}`;
  const kept = extractFailureCandidates(out).map(c => c.text);
  for (const location of locations) assert.ok(kept.includes(location), `lost location ${location}`);
});

test('a stack frame location keeps the function or diagnostic line printed just above it', async () => {
  const go = `${progress(25)}\npanic: test timed out after 30s\n\trunning tests:\n\t\tTestCapsuleDrain (30s)\n\ngoroutine 41 [running]:\ntesting.(*M).startAlarm.func1()\n\t/usr/local/go/src/testing/testing.go:2373 +0x385\n${progress(12)}\ngoroutine 22 [select]:\nexample.com/capsule/queue.(*Queue).Drain(0xc0000a4000)\n\t/home/runner/work/capsule/queue/queue.go:38 +0x10f\nexample.com/capsule/queue.TestCapsuleDrain(0xc000003ba0)\n\t/home/runner/work/capsule/queue/queue_test.go:61 +0x8a\nFAIL\texample.com/capsule/queue\t30.017s`;
  const result = await digest({ cmd: 'go test ./...', out: go, exitCode: 1 }, noModel);
  facts(result, ['panic: test timed out after 30s', 'TestCapsuleDrain', 'queue.(*Queue).Drain', 'queue.go:38', 'queue_test.go:61']);
  absent(result, ['testing.go:2373']);
  const ruff = `${progress(25)}\nF841 [*] Local variable \`capsule_total\` is assigned to but never used\n  --> src/capsule/ledger.py:65:5\n   |\n65 |     capsule_total = sum(rows)\n   |     ^^^^^^^^^^^^^\n\nFound 1 error.`;
  facts(await digest({ cmd: 'ruff check .', out: ruff, exitCode: 1 }, noModel), ['F841', 'Local variable `capsule_total` is assigned to but never used', 'src/capsule/ledger.py:65:5']);
});

test('failure headers from race detectors, sanitizers, bracketed levels, markers and lint codes are recognised', () => {
  const headers = [
    'WARNING: DATA RACE',
    '==4123==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x502000000014',
    '✘ [ERROR] Could not resolve "@capsule/charts"',
    '  [FAIL]        ledger          1   posts capsule entry.',
    '  ✖ This variable capsuleDraft is unused.',
    ' ✗ deploy creates the capsule archive',
    '       ^-----------^ SC2086 (info): Double quote to prevent globbing and word splitting.',
    'capsule/cart.py:42:11: E1120: No value for argument \'currency\' in function call (no-value-for-parameter)',
    '+++++++++++++++++++++++++++++++++++ Timeout ++++++++++++++++++++++++++++++++++++',
    '    java.lang.IllegalStateException: retry budget exhausted after 4 attempts',
  ];
  for (const header of headers) {
    const out = `${progress(60)}\n${header}\n${progress(30)}`;
    assert.ok(extractFailureCandidates(out).some(c => c.text === header), `missed header ${header}`);
  }
});

test('a test title framed by rule lines above a failure is kept', async () => {
  const rule = '-'.repeat(79);
  const out = `${progress(25)}\n${rule}\nCapsuleLedger posts entries\n  with a capsule rate\n${rule}\n/work/tests/ledger_test.cpp:75\n${'.'.repeat(79)}\n\n/work/tests/ledger_test.cpp:81: FAILED:\n  REQUIRE( ledger.total() == 44 )\nwith expansion:\n  47 == 44\n\n${'='.repeat(79)}\ntest cases:  9 |  8 passed | 1 failed`;
  facts(await digest({ cmd: './capsule_tests', out, exitCode: 1 }, noModel), ['CapsuleLedger posts entries', 'ledger_test.cpp:81', '47 == 44']);
});

test('large passing runs keep their count lines rather than per-test ok lines', async () => {
  const mocha = `${progress(10)}\n  CapsuleStore\n${Array.from({ length: 90 }, (_, i) => `    ✔ looks up capsule record ${i}`).join('\n')}\n\n\n  90 passing (2s)\n  1 pending`;
  facts(await digest({ cmd: 'npx mocha', out: mocha, exitCode: 0 }, async () => assert.fail('passing output needs no model')), ['90 passing (2s)', '1 pending']);
  const cargo = `${progress(10)}\nrunning 60 tests\n${Array.from({ length: 60 }, (_, i) => `test ledger::tests::case_${i} ... ok`).join('\n')}\n\ntest result: ok. 60 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s\n\n   Doc-tests capsule\n\nrunning 3 tests\n${Array.from({ length: 3 }, (_, i) => `test src/lib.rs - Ledger::post (line ${i * 20}) ... ok`).join('\n')}\n\ntest result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.31s`;
  const result = await digest({ cmd: 'cargo test', out: cargo, exitCode: 0 }, async () => assert.fail('passing output needs no model'));
  facts(result, ['test result: ok. 60 passed', 'test result: ok. 3 passed']);
  absent(result, ['case_59 ... ok']);
});

test('a header ending in a colon keeps the message printed on the next line when the model cites only frames', async () => {
  const stamp = text => text.split('\n').map((l, i) => `2026-10-16T09:20:${String(i % 60).padStart(2, '0')}.4916147Z ${l}`).join('\n');
  const rustc = '/rustc/f6e511eec7342f59a25f7c0534f1dbea00d01b14/library';
  const out = stamp(`${progress(20)}\nrunning 6 tests\ntest codec::tests::decodes_capsule ... FAILED\n\nfailures:\n\n---- codec::tests::decodes_capsule stdout ----\n\nthread 'codec::tests::decodes_capsule' panicked at src/codec.rs:41:9:\ncalled \`Result::unwrap()\` on an \`Err\` value: InvalidHeader(702304)\nstack backtrace:\n   0: rust_begin_unwind\n             at ${rustc}/std/src/panicking.rs:665:5\n${Array.from({ length: 20 }, (_, i) => `   ${i + 5}: capsule::codec::helpers::step_${i}\n             at ./src/codec/helpers.rs:${i + 10}:5`).join('\n')}\n   4: capsule::codec::tests::decodes_capsule\n             at ./src/codec.rs:41:9\n\nfailures:\n    codec::tests::decodes_capsule\n\ntest result: FAILED. 5 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s`);
  const result = await digest({ cmd: 'cargo test', out, exitCode: 101 }, async () => cite(out, 'at ./src/codec.rs:41:9'));
  facts(result, ['InvalidHeader(702304)', 'src/codec.rs:41:9']);
});

test('rustc note and help lines of a diagnostic are kept with it', async () => {
  const gutter = Array.from({ length: 12 }, (_, i) => `${100 + i} | |         apply(limit_${i})`).join('\n');
  const out = `${progress(20)}\nerror: this \`if\` has identical blocks\n  --> src/capsule/rules.rs:99:5\n   |\n${gutter}\n   |\n   = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#if_same_then_else\n   = note: \`#[deny(clippy::if_same_then_else)]\` on by default\n\nerror: could not compile \`capsule\` (lib) due to 1 previous error`;
  facts(await digest({ cmd: 'cargo clippy', out, exitCode: 101 }, noModel), ['this `if` has identical blocks', 'src/capsule/rules.rs:99:5', 'clippy::if_same_then_else']);
});

test('per-test FAILED lines at the end of a long log do not take the summary places from the first failure', async () => {
  const k = 51;
  const tb = Array.from({ length: k }, (_, i) => `/work/tests/test_batch.py:${100 + i * 4}: AssertionError: assert 'open-${i}' == 'sealed-${i}'`).join('\n');
  const fails = Array.from({ length: k }, (_, i) => `FAILED tests/test_batch.py::test_case_${i} - AssertionError: assert 'open-${i}' == 'sealed-${i}'`).join('\n');
  const out = `${progress(20)}\n=================================== FAILURES ===================================\n${tb}\n=========================== short test summary info ============================\n${fails}\n${k} failed, 12 passed in 1.94s`;
  const candidates = extractFailureCandidates(out);
  assert.ok(candidates.length <= 60);
  const result = await digest({ cmd: 'pytest --tb=line', out, exitCode: 1 }, async () => cite(out, 'test_batch.py:100:'));
  facts(result, ['test_case_0 ', 'test_batch.py:100', "assert 'open-0' == 'sealed-0'", `${k} failed, 12 passed`]);
});
