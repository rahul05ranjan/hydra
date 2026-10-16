// Second Test holdout, built 2026-10-16 after the first holdout was scored often enough while
// tuning to become a tuning signal. Layouts are written from each tool's documented output and
// do not copy the development, extended or first holdout builders; serials 610000+ and the word
// list are new. Score it once per frozen candidate, aggregate only, and never read its failure
// rows to change the extractor or prompt. No model, training or sealed input is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const PER_FAMILY = 25;
const WORDS = ['quiver', 'marble', 'juniper', 'falcon', 'orchid', 'granite', 'ripple', 'saffron', 'glacier', 'lichen', 'osprey', 'bramble', 'sparrow'];
const gold = (tests = [], files = [], assertions = [], forbidden = []) => ({
  expectedTests: tests, expectedFiles: files, expectedAssertions: assertions, forbiddenStrings: forbidden,
});
const out = (framework, command, rawOutput, g, exitCode = 1) => ({ framework, command, exitCode, rawOutput: rawOutput.trimEnd(), gold: g });

function context(ordinal, variant) {
  const serial = 610000 + ordinal * 100 + variant;
  const word = WORDS[(ordinal * 5 + variant) % WORDS.length];
  const Word = word[0].toUpperCase() + word.slice(1);
  const stem = `${word}_${serial}`;
  const windows = variant % 4 === 3;
  const root = windows ? `D:\\ci\\${stem}` : `/srv/ci/${stem}`;
  const a = serial % 991 + 7;
  return {
    serial, word, Word, stem, root, windows, a, b: a + 3 + variant % 5,
    want: `${word}-wanted-${serial % 7919}`, got: `${word}-seen-${serial % 6007}`,
    line: 14 + (ordinal * 11 + variant * 7) % 170, col: 2 + (ordinal + variant) % 11,
    abs: rel => windows ? `${root}\\${rel.replaceAll('/', '\\')}` : `${root}/${rel}`,
    url: rel => windows ? `file:///D:/ci/${stem}/${rel}` : `file:///srv/ci/${stem}/${rel}`,
  };
}

// Setup output that carries no failure signal, in the voice of each ecosystem.
const PRELUDES = {
  npm: (c, i) => `PASS src/${c.word}/unit_${c.serial}_${i}.test.ts (${(i * 37 + c.serial) % 900 + 40} ms)`,
  py: (c, i) => `tests/test_${c.word}_module_${i}.py ${'.'.repeat(4 + (c.serial + i) % 30)} [${String(Math.min(99, 3 + i * 5)).padStart(3)}%]`,
  go: (c, i) => `=== RUN   Test${c.Word}Fixture${i}\n--- PASS: Test${c.Word}Fixture${i} (0.0${i % 10}s)`,
  rust: (c, i) => `   Compiling ${['memchr', 'itoa', 'ryu', 'serde', 'libc', 'bytes', 'smallvec'][i % 7]} v${1 + i % 3}.${(c.serial + i) % 40}.${i % 9}`,
  jvm: (c, i) => `[INFO] Running com.acme.${c.word}.Fixture${i}Test\n[INFO] Tests run: ${3 + i % 6}, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.0${i % 10}${c.serial % 9} s -- in com.acme.${c.word}.Fixture${i}Test`,
  dotnet: (c, i) => `  Restored ${c.abs(`src/Acme.${c.Word}.Part${i}/Acme.${c.Word}.Part${i}.csproj`)} (in ${(c.serial + i * 13) % 300 + 20} ms).`,
  build: (c, i) => `[${i + 1}/${40 + c.serial % 9}] Building CXX object src/CMakeFiles/${c.word}.dir/part_${i}.cpp.o`,
  log: (c, i) => `2026-10-0${1 + i % 9} 0${i % 10}:1${i % 6}:0${i % 7} INFO ${c.stem} worker=${i % 4} loaded shard ${i} (${(c.serial * 7 + i) % 5000} rows)`,
};
const prelude = (c, kind, count = 16) => Array.from({ length: count + c.serial % 9 }, (_, i) => PRELUDES[kind](c, i)).join('\n');
const JVM_LIB = ['org.junit.jupiter.api.AssertionFailureBuilder.build(AssertionFailureBuilder.java:151)', 'java.base/java.lang.reflect.Method.invoke(Method.java:580)'];

const FAMILIES = {
  'h2-jest-each': c => {
    const k = c.serial % 5 + 1;
    return out('jest', 'npx jest', `${prelude(c, 'npm')}
FAIL src/${c.stem}.test.ts
  ${c.Word} pricing
    ✓ applies base rate (3 ms)
    ✕ applies discount for tier ${k} (5 ms)
    ✓ rejects negative totals (1 ms)

  ● ${c.Word} pricing › applies discount for tier ${k}

    expect(received).toBe(expected) // Object.is equality

    Expected: ${c.a}
    Received: ${c.b}

      ${c.line - 1} |   it.each(tiers)('applies discount for tier %i', (tier) => {
    > ${c.line} |     expect(price(tier)).toBe(expected[tier]);
         |                         ^
      ${c.line + 1} |   });

      at Object.<anonymous> (src/${c.stem}.test.ts:${c.line}:25)

Test Suites: 1 failed, ${c.serial % 30 + 4} passed, ${c.serial % 30 + 5} total
Tests:       1 failed, ${c.serial % 200 + 20} passed, ${c.serial % 200 + 21} total
Snapshots:   0 total
Time:        ${c.serial % 9 + 2}.${c.serial % 97} s
Ran all test suites.`, gold([`applies discount for tier ${k}`], [`src/${c.stem}.test.ts:${c.line}`], [`Expected: ${c.a}`, `Received: ${c.b}`]));
  },
  'h2-jest-object-diff': c => out('jest', 'npx jest --ci', `${prelude(c, 'npm')}
FAIL src/orders/${c.stem}.test.js
  ● ${c.word} order › serializes status

    expect(received).toEqual(expected) // deep equality

    - Expected  - 1
    + Received  + 1

      Object {
        "id": ${c.serial},
    -   "status": "${c.want}",
    +   "status": "${c.got}",
        "total": ${c.a},
      }

      ${c.line} |     expect(serialize(order)).toEqual({ id: ${c.serial}, status: '${c.want}', total: ${c.a} });
         |                              ^

      at Object.toEqual (src/orders/${c.stem}.test.js:${c.line}:30)

Test Suites: 1 failed, 6 passed, 7 total
Tests:       1 failed, 52 passed, 53 total`, gold([`${c.word} order › serializes status`], [`src/orders/${c.stem}.test.js:${c.line}`], [`"status": "${c.want}"`, `"status": "${c.got}"`])),
  'h2-jest-tothrow': c => out('jest', 'npm test', `
> ${c.word}-parser@1.${c.serial % 20}.0 test
> jest

${prelude(c, 'npm')}
FAIL src/parser/${c.stem}.spec.js
  ● ${c.Word} parser › throws on empty input

    expect(received).toThrow(expected)

    Expected substring: "${c.word} input is empty"

    Received function did not throw

      ${c.line} |   expect(() => parse${c.Word}('')).toThrow('${c.word} input is empty');
         |                                     ^

      at Object.<anonymous> (src/parser/${c.stem}.spec.js:${c.line}:${c.col})

Test Suites: 1 failed, 3 passed, 4 total
Tests:       1 failed, 19 passed, 20 total`, gold([`${c.Word} parser › throws on empty input`], [`src/parser/${c.stem}.spec.js:${c.line}`], [`Expected substring: "${c.word} input is empty"`, 'Received function did not throw'])),
  'h2-vitest-two-files': c => {
    const l2 = c.line + 23, l3 = c.line + 4;
    return out('vitest', 'npx vitest run', `
 RUN  v2.1.${c.serial % 9} ${c.windows ? `D:/ci/${c.stem}` : `/srv/ci/${c.stem}`}

${Array.from({ length: 14 + c.serial % 6 }, (_, i) => ` ✓ src/${c.word}/part_${i}.test.ts (${2 + i % 7} tests) ${(c.serial + i) % 90 + 3}ms`).join('\n')}
 ❯ src/a_${c.stem}.test.ts (4 tests | 1 failed) 12ms
   × ${c.word} encodes header 6ms
 ❯ src/b_${c.stem}.test.ts (3 tests | 1 failed) 8ms
   × ${c.word} decodes trailer 2ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/a_${c.stem}.test.ts > ${c.word} encodes header
AssertionError: expected '${c.got}' to be '${c.want}' // Object.is equality

- Expected
+ Received

- ${c.want}
+ ${c.got}

 ❯ src/a_${c.stem}.test.ts:${c.line}:${c.col}
    ${c.line - 1}|   const header = encode(input)
    ${c.line}|   expect(header).toBe('${c.want}')
       |                  ^

⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  src/b_${c.stem}.test.ts > ${c.word} decodes trailer
TypeError: Cannot read properties of null (reading 'trailer${c.serial}')
 ❯ decode src/codec/${c.stem}.ts:${l2}:${c.col}
 ❯ src/b_${c.stem}.test.ts:${l3}:5

⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

 Test Files  2 failed | ${14 + c.serial % 6} passed (${16 + c.serial % 6})
      Tests  2 failed | ${c.serial % 80 + 30} passed (${c.serial % 80 + 32})
   Start at  10:${String(c.serial % 60).padStart(2, '0')}:07
   Duration  ${c.serial % 5 + 1}.${c.serial % 89}s`, gold([`${c.word} encodes header`, `${c.word} decodes trailer`],
      [`src/a_${c.stem}.test.ts:${c.line}`, `src/codec/${c.stem}.ts:${l2}`], [c.want, c.got, `reading 'trailer${c.serial}'`]));
  },
  'h2-mocha-spec': c => out('mocha', 'npx mocha', `
${Array.from({ length: 12 + c.serial % 7 }, (_, i) => `  ${c.Word}Store ${i}\n    ✔ loads default ${i}\n    ✔ saves record ${i} (${i % 5 + 1}ms)`).join('\n')}
  ${c.Word}Store
    ✔ loads defaults
    1) merges remote changes


  ${c.serial % 40 + 25} passing (86ms)
  1 failing

  1) ${c.Word}Store
       merges remote changes:

      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

'${c.got}' !== '${c.want}'

      + expected - actual

      -${c.got}
      +${c.want}

      at Context.<anonymous> (test/${c.stem}.spec.js:${c.line}:${c.col})
      at process.processImmediate (node:internal/timers:483:21)`,
  gold(['merges remote changes'], [`test/${c.stem}.spec.js:${c.line}`], [`'${c.got}' !== '${c.want}'`], ['node:internal/timers:483:21'])),
  'h2-node-tap-nested': c => out('node:test', 'node --test --test-reporter=tap', `TAP version 13
${Array.from({ length: 10 + c.serial % 6 }, (_, i) => `# Subtest: ${c.word} helper ${i}\nok ${i + 1} - ${c.word} helper ${i}\n  ---\n  duration_ms: ${(i * 0.37 + 0.2).toFixed(3)}\n  ...`).join('\n')}
# Subtest: ${c.word} queue
    # Subtest: drains in order
    ok 1 - drains in order
      ---
      duration_ms: 0.812
      ...
    # Subtest: retries failed job ${c.serial}
    not ok 2 - retries failed job ${c.serial}
      ---
      duration_ms: 1.904
      location: '${c.abs(`test/queue_${c.serial}.test.mjs`)}:${c.line}:3'
      failureType: 'testCodeFailure'
      error: |-
        Expected values to be strictly equal:

        ${c.a} !== ${c.b}

      code: 'ERR_ASSERTION'
      name: 'AssertionError'
      expected: ${c.b}
      actual: ${c.a}
      operator: 'strictEqual'
      stack: |-
        TestContext.<anonymous> (${c.url(`test/queue_${c.serial}.test.mjs`)}:${c.line + 4}:12)
        async Test.run (node:internal/test_runner/test:935:9)
      ...
    1..2
not ok ${11 + c.serial % 6} - ${c.word} queue
  ---
  duration_ms: 3.1
  ...
1..${11 + c.serial % 6}
# tests ${12 + c.serial % 6}
# suites 0
# pass ${11 + c.serial % 6}
# fail 1`, gold([`retries failed job ${c.serial}`], [`queue_${c.serial}.test.mjs:${c.line + 4}`], [`expected: ${c.b}`, `actual: ${c.a}`], ['node:internal/test_runner/test:935:9'])),
  'h2-pytest-list-diff': c => {
    const loc = c.windows ? `tests\\test_${c.stem}.py:${c.line}` : `tests/test_${c.stem}.py:${c.line}`;
    return out('pytest', 'pytest', `============================= test session starts ==============================
platform ${c.windows ? 'win32' : 'linux'} -- Python 3.12.${c.serial % 8}, pytest-8.3.${c.serial % 5}, pluggy-1.5.0
rootdir: ${c.root}
configfile: pyproject.toml
collected ${c.serial % 300 + 40} items

${prelude(c, 'py')}
tests/test_${c.stem}.py ..F....                                          [100%]

=================================== FAILURES ===================================
____________________________ test_${c.word}_order _____________________________

    def test_${c.word}_order():
        items = build_${c.word}(${c.serial})
>       assert items == [${c.a}, ${c.a + 1}, ${c.a + 2}]
E       assert [${c.a}, ${c.b}, ${c.a + 2}] == [${c.a}, ${c.a + 1}, ${c.a + 2}]
E
E         At index 1 diff: ${c.b} != ${c.a + 1}
E         Use -v to get more diff

${loc}: AssertionError
=========================== short test summary info ============================
FAILED tests/test_${c.stem}.py::test_${c.word}_order - assert [${c.a}, ${c.b}, ${c.a + 2}] == [${c.a}, ${c.a + 1}, ${c.a + 2}]
========================= 1 failed, ${c.serial % 300 + 39} passed in 0.${c.serial % 90 + 10}s =========================`,
    gold([`test_${c.word}_order`], [`test_${c.stem}.py:${c.line}`], [`At index 1 diff: ${c.b} != ${c.a + 1}`]));
  },
  'h2-pytest-fixture-error': c => out('pytest', 'pytest -q', `${prelude(c, 'py')}
==================================== ERRORS ====================================
_______________________ ERROR at setup of test_${c.word}_sync ________________________
file ${c.abs(`tests/test_${c.stem}.py`)}, line ${c.line}
  def test_${c.word}_sync(${c.word}_client, tmp_path):
E       fixture '${c.word}_client' not found
>       available fixtures: cache, capfd, capfdbinary, caplog, capsys, capsysbinary, doctest_namespace, monkeypatch, pytestconfig, record_property, record_testsuite_property, record_xml_attribute, recwarn, tmp_path, tmp_path_factory, tmpdir, tmpdir_factory
>       use 'pytest --fixtures [testpath]' for help on them.

${c.abs(`tests/test_${c.stem}.py`)}:${c.line}
=========================== short test summary info ============================
ERROR tests/test_${c.stem}.py::test_${c.word}_sync
${c.serial % 90 + 12} passed, 1 error in 0.${c.serial % 80 + 11}s`,
  gold([`test_${c.word}_sync`], [`test_${c.stem}.py:${c.line}`], [`fixture '${c.word}_client' not found`])),
  'h2-pytest-xdist': c => {
    const v = c.b + 9;
    return out('pytest', 'pytest -n 4', `============================= test session starts ==============================
platform linux -- Python 3.11.9, pytest-8.2.2, pluggy-1.5.0
rootdir: /srv/ci/${c.stem}
plugins: xdist-3.6.1, cov-5.0.0
created: 4/4 workers
4 workers [${c.serial % 400 + 96} items]

${Array.from({ length: 12 + c.serial % 8 }, (_, i) => `${'.'.repeat(40 + (c.serial + i) % 20)} [${String(Math.min(99, 4 + i * 5)).padStart(3)}%]`).join('\n')}
.............F..................                                         [100%]
=================================== FAILURES ===================================
____________________________ Test${c.Word}.test_limit _____________________________
[gw${c.serial % 4}] linux -- Python 3.11.9 /srv/ci/${c.stem}/.venv/bin/python

self = <tests.test_${c.stem}.Test${c.Word} object at 0x7f3a${(c.serial * 31).toString(16)}>

    def test_limit(self):
>       assert self.window.limit(${c.a}) <= ${c.b}
E       assert ${v} <= ${c.b}
E        +  where ${v} = limit(${c.a})

tests/test_${c.stem}.py:${c.line}: AssertionError
=========================== short test summary info ============================
FAILED tests/test_${c.stem}.py::Test${c.Word}::test_limit - assert ${v} <= ${c.b}
========================= 1 failed, ${c.serial % 400 + 95} passed in 3.${c.serial % 90}s =========================`,
    gold([`Test${c.Word}::test_limit`], [`tests/test_${c.stem}.py:${c.line}`], [`assert ${v} <= ${c.b}`]));
  },
  'h2-pytest-did-not-raise': c => out('pytest', 'python -m pytest tests/unit', `${prelude(c, 'py')}
=================================== FAILURES ===================================
__________________________ test_${c.word}_rejects_zero __________________________

    def test_${c.word}_rejects_zero():
        with pytest.raises(ValueError, match="${c.word} must be positive"):
>           ${c.word}.scale(0)
E           Failed: DID NOT RAISE <class 'ValueError'>

tests/unit/test_${c.stem}.py:${c.line}: Failed
=========================== short test summary info ============================
FAILED tests/unit/test_${c.stem}.py::test_${c.word}_rejects_zero - Failed: DID NOT RAISE <class 'ValueError'>
======================== 1 failed, ${c.serial % 70 + 30} passed in 0.${c.serial % 70 + 20}s =========================`,
  gold([`test_${c.word}_rejects_zero`], [`tests/unit/test_${c.stem}.py:${c.line}`], ["DID NOT RAISE <class 'ValueError'>"])),
  'h2-unittest-dots': c => out('unittest', 'python -m unittest discover -s tests', `${prelude(c, 'log')}
${'.'.repeat(20 + c.serial % 30)}F${'.'.repeat(5 + c.serial % 9)}
======================================================================
FAIL: test_render (${c.word}.tests.test_views.RenderTests.test_render)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "${c.abs(`${c.word}/tests/test_views.py`)}", line ${c.line}, in test_render
    self.assertEqual(render(page), expected)
AssertionError: '<h1>${c.got}</h1>' != '<h1>${c.want}</h1>'
- <h1>${c.got}</h1>
+ <h1>${c.want}</h1>


----------------------------------------------------------------------
Ran ${26 + c.serial % 39} tests in 0.0${c.serial % 90 + 10}s

FAILED (failures=1)`, gold(['RenderTests.test_render'], [`test_views.py", line ${c.line}`], [`'<h1>${c.got}</h1>' != '<h1>${c.want}</h1>'`])),
  'h2-go-errorf': c => out('go', 'go test -v ./...', `${prelude(c, 'go')}
=== RUN   Test${c.Word}Parse
=== RUN   Test${c.Word}Parse/empty
=== RUN   Test${c.Word}Parse/unicode
    ${c.stem}_test.go:${c.line}: Parse("ü${c.serial}") = ${c.b}, want ${c.a}
--- FAIL: Test${c.Word}Parse (0.00s)
    --- PASS: Test${c.Word}Parse/empty (0.00s)
    --- FAIL: Test${c.Word}Parse/unicode (0.00s)
FAIL
FAIL	example.com/${c.word}/parse	0.0${c.serial % 80 + 11}s
ok  	example.com/${c.word}/store	0.012s
FAIL`, gold([`Test${c.Word}Parse/unicode`], [`${c.stem}_test.go:${c.line}`], [`= ${c.b}, want ${c.a}`])),
  'h2-go-build-unused': c => out('go', 'go test ./...', `${Array.from({ length: 18 + c.serial % 7 }, (_, i) => `ok  	example.com/${c.word}/internal/component${i}	${i % 3 ? `0.0${(c.serial + i) % 90 + 10}s` : '(cached)'}`).join('\n')}
# example.com/${c.word}/sync
sync/${c.stem}.go:${c.line}:${c.col}: declared and not used: retry${c.serial}
sync/${c.stem}.go:${c.line + 6}:2: "strings" imported and not used
FAIL	example.com/${c.word}/sync [build failed]
FAIL`, gold([], [`sync/${c.stem}.go:${c.line}:${c.col}`, `sync/${c.stem}.go:${c.line + 6}`], [`declared and not used: retry${c.serial}`, '"strings" imported and not used'])),
  'h2-go-timeout': c => {
    const l2 = c.line + 31;
    return out('go', 'go test -timeout 30s ./queue', `${prelude(c, 'go')}
=== RUN   Test${c.Word}Drain
panic: test timed out after 30s
	running tests:
		Test${c.Word}Drain (30s)

goroutine ${c.serial % 90 + 7} [chan receive]:
example.com/${c.word}/queue.(*Queue).Drain(0xc000120000)
	/srv/ci/${c.stem}/queue/queue.go:${c.line} +0x45
example.com/${c.word}/queue.Test${c.Word}Drain(0xc0001021a0)
	/srv/ci/${c.stem}/queue/${c.stem}_test.go:${l2} +0x8c
testing.tRunner(0xc0001021a0, 0x5c3e10)
	/usr/local/go/src/testing/testing.go:1690 +0xf4
created by testing.(*T).Run in goroutine 1
	/usr/local/go/src/testing/testing.go:1743 +0x390
FAIL	example.com/${c.word}/queue	30.017s
FAIL`, gold([`Test${c.Word}Drain`], [`queue/queue.go:${c.line}`, `${c.stem}_test.go:${l2}`], ['test timed out after 30s'], ['/usr/local/go/src/testing/testing.go:1690']));
  },
  'h2-cargo-assert-eq': c => out('cargo', 'cargo test', `${prelude(c, 'rust')}
   Compiling ${c.word} v0.${c.serial % 9}.0 (${c.root})
    Finished \`test\` profile [unoptimized + debuginfo] target(s) in ${c.serial % 30 + 3}.${c.serial % 9}s
     Running unittests src/lib.rs (target/debug/deps/${c.word}-${(c.serial * 7919).toString(16)})

running 6 tests
test ${c.word}::tests::parses_header ... ok
test ${c.word}::tests::rejects_overflow ... FAILED
test ${c.word}::tests::keeps_order ... ok

failures:

---- ${c.word}::tests::rejects_overflow stdout ----

thread '${c.word}::tests::rejects_overflow' panicked at src/${c.word}.rs:${c.line}:9:
assertion \`left == right\` failed: overflow for ${c.serial}
  left: ${c.a}
 right: ${c.b}
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace


failures:
    ${c.word}::tests::rejects_overflow

test result: FAILED. 5 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

error: test failed, to rerun pass \`--lib\``, gold([`${c.word}::tests::rejects_overflow`], [`src/${c.word}.rs:${c.line}`], [`left: ${c.a}`, `right: ${c.b}`])),
  'h2-rustc-mismatch': c => out('cargo', 'cargo build', `${prelude(c, 'rust')}
   Compiling ${c.word}-core v0.4.${c.serial % 10} (${c.abs('core')})
error[E0308]: mismatched types
  --> core${c.windows ? '\\src\\' : '/src/'}${c.stem}.rs:${c.line}:${c.col}
   |
${c.line} |     let count: u32 = parse_${c.word}(input);
   |                ---   ^^^^^^^^^^^^^^^^^^^^ expected \`u32\`, found \`Option<u32>\`
   |                |
   |                expected due to this
   |
   = note: expected type \`u32\`
              found enum \`Option<u32>\`
help: consider using \`Option::expect\` to unwrap the \`Option<u32>\` value, panicking if the value is an \`Option::None\`
   |
${c.line} |     let count: u32 = parse_${c.word}(input).expect("REASON");
   |                                         +++++++++++++++++

For more information about this error, try \`rustc --explain E0308\`.
error: could not compile \`${c.word}-core\` (lib) due to 1 previous error`,
  gold([], [`${c.stem}.rs:${c.line}:${c.col}`], ['error[E0308]: mismatched types', 'expected `u32`, found `Option<u32>`'])),
  'h2-clippy-deny': c => out('cargo', 'cargo clippy -- -D warnings', `${prelude(c, 'rust')}
    Checking ${c.word}-cli v0.2.${c.serial % 10} (/srv/ci/${c.stem})
error: this \`if\` has identical blocks
  --> src/bin/${c.stem}.rs:${c.line}:${c.col}
   |
${c.line} |       if verbose {
   |  _______________^
${c.line + 1} | |         flush_${c.word}();
${c.line + 2} | |     } else {
   | |_____^
   |
   = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#if_same_then_else
   = note: \`-D clippy::if-same-then-else\` implied by \`-D warnings\`

error: could not compile \`${c.word}-cli\` (bin "${c.stem}") due to 1 previous error`,
  gold([], [`src/bin/${c.stem}.rs:${c.line}:${c.col}`], ['this `if` has identical blocks'])),
  'h2-tsc-pretty': c => {
    const l2 = c.line + 40;
    return out('tsc', 'npx tsc --noEmit', `${prelude(c, 'log', 12)}
src/${c.word}/${c.stem}.ts:${c.line}:${c.col} - error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.

${c.line}     total += format${c.Word}(row.amount);
                               ~~~~~~~~~~

src/${c.word}/index.ts:${l2}:3 - error TS2741: Property 'id${c.serial}' is missing in type '{ name: string; }' but required in type '${c.Word}Row'.

${l2}   rows.push({ name });
      ~~~~~~~~~~~~~~~~~~

  src/${c.word}/types.ts:4:3
    4   id${c.serial}: number;
        ~~~~~~~~~~~~
    'id${c.serial}' is declared here.


Found 2 errors in 2 files.

Errors  Files
     1  src/${c.word}/${c.stem}.ts:${c.line}
     1  src/${c.word}/index.ts:${l2}`, gold([], [`src/${c.word}/${c.stem}.ts:${c.line}`, `src/${c.word}/index.ts:${l2}`], ['TS2345', `Property 'id${c.serial}' is missing`]));
  },
  'h2-biome-check': c => {
    const l2 = c.line + 17;
    return out('biome', 'npx biome check .', `${prelude(c, 'log', 12)}
src/${c.stem}.ts:${c.line}:${c.col} lint/style/useConst  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × This let declares a variable that is only assigned once.

  > ${c.line} │   let ${c.word}Count = rows.length;
      │   ^^^

  i 'let' is used here.

src/${c.stem}.ts:${l2}:3 lint/suspicious/noDoubleEquals  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × Use === instead of ==

  > ${l2} │   if (${c.word}Count == limit) {
      │                ^^

check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × Some errors were emitted while running checks.

Checked ${c.serial % 200 + 30} files in ${c.serial % 90 + 10}ms. No fixes applied.
Found 2 errors.`, gold([], [`src/${c.stem}.ts:${c.line}:${c.col}`, `src/${c.stem}.ts:${l2}:3`], ['lint/style/useConst', 'lint/suspicious/noDoubleEquals']));
  },
  'h2-ruff-concise': c => out('ruff', 'ruff check --output-format=concise .', `${prelude(c, 'log', 16)}
${c.word}/${c.stem}.py:${c.line}:${c.col}: F841 Local variable \`retry_${c.serial}\` is assigned to but never used
${c.word}/models.py:${c.line + 3}:1: E402 Module level import not at top of file
Found 2 errors.
No fixes available (1 hidden fix can be enabled with the \`--unsafe-fixes\` option).`,
  gold([], [`${c.word}/${c.stem}.py:${c.line}:${c.col}`, `${c.word}/models.py:${c.line + 3}`], [`F841 Local variable \`retry_${c.serial}\``, 'E402 Module level import not at top of file'])),
  'h2-pyright': c => out('pyright', 'npx pyright', `${prelude(c, 'log', 14)}
${c.abs(`src/${c.word}/${c.stem}.py`)}
  ${c.abs(`src/${c.word}/${c.stem}.py`)}:${c.line}:${c.col} - error: Argument of type "str" cannot be assigned to parameter "limit" of type "int" in function "fetch_${c.word}"
    "str" is not assignable to "int" (reportArgumentType)
1 error, 0 warnings, 0 informations`, gold([], [`${c.stem}.py:${c.line}:${c.col}`], [`parameter "limit" of type "int"`])),
  'h2-maven-surefire': c => out('maven', 'mvn -B test', `${prelude(c, 'jvm')}
[INFO] Running com.acme.${c.word}.${c.Word}ServiceTest
[ERROR] Tests run: 7, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.084 s <<< FAILURE! -- in com.acme.${c.word}.${c.Word}ServiceTest
[ERROR] com.acme.${c.word}.${c.Word}ServiceTest.rejectsExpired${c.serial} -- Time elapsed: 0.012 s <<< FAILURE!
org.opentest4j.AssertionFailedError: expected: <${c.a}> but was: <${c.b}>
	at ${JVM_LIB[0]}
	at org.junit.jupiter.api.AssertEquals.assertEquals(AssertEquals.java:150)
	at com.acme.${c.word}.${c.Word}ServiceTest.rejectsExpired${c.serial}(${c.Word}ServiceTest.java:${c.line})
	at ${JVM_LIB[1]}

[INFO]
[INFO] Results:
[INFO]
[ERROR] Failures:
[ERROR]   ${c.Word}ServiceTest.rejectsExpired${c.serial}:${c.line} expected: <${c.a}> but was: <${c.b}>
[INFO]
[ERROR] Tests run: ${c.serial % 60 + 41}, Failures: 1, Errors: 0, Skipped: 2
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------`,
  gold([`rejectsExpired${c.serial}`], [`${c.Word}ServiceTest.java:${c.line}`], [`expected: <${c.a}> but was: <${c.b}>`], JVM_LIB)),
  'h2-kotlin-compile': c => out('gradle', './gradlew build', `${prelude(c, 'log', 14)}
> Task :app:compileKotlin FAILED
e: ${c.url(`app/src/main/kotlin/com/acme/${c.Word}Repo.kt`)}:${c.line}:${c.col} Unresolved reference 'find${c.Word}${c.serial}'.
e: ${c.url(`app/src/main/kotlin/com/acme/${c.Word}Repo.kt`)}:${c.line + 8}:17 Argument type mismatch: actual type is 'String', but 'Int' was expected.

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:compileKotlin'.
> A failure occurred while executing org.jetbrains.kotlin.compilerRunner.GradleCompilerRunnerWithWorkers$GradleKotlinCompilerWorkAction
   > Compilation error. See log for more details

* Try:
> Run with --stacktrace option to get the stack trace.

BUILD FAILED in ${c.serial % 40 + 8}s
${c.serial % 9 + 3} actionable tasks: 2 executed, ${c.serial % 9 + 1} up-to-date`,
  gold([], [`${c.Word}Repo.kt:${c.line}:${c.col}`, `${c.Word}Repo.kt:${c.line + 8}`], [`Unresolved reference 'find${c.Word}${c.serial}'`, "actual type is 'String'"])),
  'h2-dotnet-xunit': c => out('dotnet', 'dotnet test', `  Determining projects to restore...
${prelude(c, 'dotnet', 12)}
  Acme.${c.Word} -> ${c.abs(`src/bin/Debug/net8.0/Acme.${c.Word}.dll`)}
  Acme.${c.Word}.Tests -> ${c.abs(`tests/bin/Debug/net8.0/Acme.${c.Word}.Tests.dll`)}
Test run for ${c.abs(`tests/bin/Debug/net8.0/Acme.${c.Word}.Tests.dll`)} (.NETCoreApp,Version=v8.0)
VSTest version 17.11.1 (x64)

Starting test execution, please wait...
A total of 1 test files matched the specified pattern.
[xUnit.net 00:00:00.42]     Acme.${c.Word}.Tests.${c.Word}CalculatorTests.Applies_Fee_${c.serial} [FAIL]
  Failed Acme.${c.Word}.Tests.${c.Word}CalculatorTests.Applies_Fee_${c.serial} [8 ms]
  Error Message:
   Assert.Equal() Failure: Values differ
Expected: ${c.a}
Actual:   ${c.b}
  Stack Trace:
     at Acme.${c.Word}.Tests.${c.Word}CalculatorTests.Applies_Fee_${c.serial}() in ${c.abs(`tests/${c.Word}CalculatorTests.cs`)}:line ${c.line}
   at System.RuntimeMethodHandle.InvokeMethod(Object target, Void** arguments, Signature sig, Boolean isConstructor)

Failed!  - Failed:     1, Passed:    ${c.serial % 60 + 10}, Skipped:     0, Total:    ${c.serial % 60 + 11}, Duration: 61 ms - Acme.${c.Word}.Tests.dll (net8.0)`,
  gold([`Applies_Fee_${c.serial}`], [`${c.Word}CalculatorTests.cs:line ${c.line}`], [`Expected: ${c.a}`, `Actual:   ${c.b}`], ['System.RuntimeMethodHandle.InvokeMethod'])),
  'h2-swift-testing': c => out('swift', 'swift test', `Building for debugging...
${Array.from({ length: 14 + c.serial % 8 }, (_, i) => `[${i + 1}/${22 + c.serial % 8}] Compiling ${c.Word}Core Part${i}.swift`).join('\n')}
Build complete! (${c.serial % 20 + 4}.${c.serial % 90}s)
◇ Test run started.
↳ Testing Library Version: 6.0.3
◇ Test totalIsRounded${c.serial}() started.
✘ Test totalIsRounded${c.serial}() recorded an issue at ${c.Word}Tests.swift:${c.line}:${c.col}: Expectation failed: (total → ${c.b}) == ${c.a}
✘ Test totalIsRounded${c.serial}() failed after 0.002 seconds with 1 issue.
✘ Test run with ${c.serial % 30 + 9} tests failed after 0.004 seconds with 1 issue.`,
  gold([`totalIsRounded${c.serial}()`], [`${c.Word}Tests.swift:${c.line}:${c.col}`], [`(total → ${c.b}) == ${c.a}`])),
  'h2-pest-php': c => out('pest', './vendor/bin/pest', `${Array.from({ length: 10 + c.serial % 6 }, (_, i) => `   PASS  Tests\\Unit\\${c.Word}Part${i}Test\n  ✓ it formats part ${i}                                              0.0${i % 9}s`).join('\n')}

   FAIL  Tests\\Feature\\${c.Word}CheckoutTest
  ⨯ it charges the cart total ${c.serial}                                  0.04s
  ────────────────────────────────────────────────────────────────────────────
   FAILED  Tests\\Feature\\${c.Word}CheckoutTest > it charges the cart total ${c.serial}
  Failed asserting that ${c.b} is identical to ${c.a}.

  at tests/Feature/${c.Word}CheckoutTest.php:${c.line}
    ${c.line - 1}▕     $total = $cart->total();
  ➜ ${c.line}▕     expect($total)->toBe(${c.a});
    ${c.line + 1}▕ });

  Tests:    1 failed, ${c.serial % 40 + 11} passed (${c.serial % 90 + 27} assertions)
  Duration: 0.${c.serial % 80 + 11}s`,
  gold([`it charges the cart total ${c.serial}`], [`tests/Feature/${c.Word}CheckoutTest.php:${c.line}`], [`Failed asserting that ${c.b} is identical to ${c.a}`])),
  'h2-hspec': c => out('hspec', 'cabal test', `${prelude(c, 'log', 12)}
${c.Word}.Parser
  parse
    accepts digits [✔]
    rejects trailing ${c.word} [✘]

Failures:

  test/${c.Word}/ParserSpec.hs:${c.line}:${c.col}:
  1) ${c.Word}.Parser.parse rejects trailing ${c.word}
       expected: Left "trailing input ${c.serial}"
        but got: Right ${c.a}

  To rerun use: --match "/${c.Word}.Parser/parse/rejects trailing ${c.word}/" --seed ${c.serial % 9000}

Randomized with seed ${c.serial % 9000}

Finished in 0.0021 seconds
${c.serial % 40 + 12} examples, 1 failure`, gold([`rejects trailing ${c.word}`], [`ParserSpec.hs:${c.line}:${c.col}`], [`expected: Left "trailing input ${c.serial}"`, `but got: Right ${c.a}`])),
  'h2-zig-test': c => out('zig', 'zig build test', `${prelude(c, 'log', 14)}
test
└─ run test 3/4 passed, 1 failed
error: 'test.${c.word} rounds down' failed: expected ${c.a}, found ${c.b}
/usr/lib/zig/std/testing.zig:103:17: 0x1039f1c in expectEqualInner__anon_1500 (test)
                return error.TestExpectedEqual;
                ^
${c.abs(`src/${c.stem}.zig`)}:${c.line}:${c.col}: 0x1039fb2 in test.${c.word} rounds down (test)
    try std.testing.expectEqual(@as(u32, ${c.a}), round(${c.word}_input));
    ^
error: while executing test 'test.${c.word} rounds down', the following command exited with code 1 (expected exited with code 0):
Build Summary: 3/5 steps succeeded; 1 failed; 3/4 tests passed; 1 failed`,
  gold([`${c.word} rounds down`], [`${c.stem}.zig:${c.line}:${c.col}`], [`expected ${c.a}, found ${c.b}`], ['/usr/lib/zig/std/testing.zig:103:17'])),
  'h2-dart-test': c => out('dart', 'dart test', `${Array.from({ length: 16 + c.serial % 8 }, (_, i) => `00:0${Math.floor(i / 8)} +${i}: test/${c.word}_part_${i}_test.dart: part ${i} keeps state`).join('\n')}
00:01 +${16 + c.serial % 8}: test/${c.stem}_test.dart: ${c.Word}Cache stores entries
00:01 +${16 + c.serial % 8} -1: test/${c.stem}_test.dart: ${c.Word}Cache evicts oldest ${c.serial} [E]
  Expected: <${c.a}>
    Actual: <${c.b}>

  package:matcher                     expect
  test/${c.stem}_test.dart ${c.line}:${c.col}  main.<fn>.<fn>

00:01 +${18 + c.serial % 8} -1: Some tests failed.`, gold([`evicts oldest ${c.serial}`], [`test/${c.stem}_test.dart ${c.line}:${c.col}`], [`Expected: <${c.a}>`, `Actual: <${c.b}>`])),
  'h2-cypress': c => out('cypress', 'npx cypress run', `
====================================================================================================

  (Run Starting)

  ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
  │ Cypress:        13.13.${c.serial % 4}                                                                         │
  │ Browser:        Electron 118 (headless)                                                        │
  │ Specs:          3 found (login_${c.stem}.cy.ts, cart.cy.ts, search.cy.ts)                           │
  └────────────────────────────────────────────────────────────────────────────────────────────────┘

────────────────────────────────────────────────────────────────────────────────────────────────────

  Running:  login_${c.stem}.cy.ts                                                           (1 of 3)


  ${c.Word} login
    ✓ shows the form (412ms)
    1) submits valid credentials


  1 passing (5s)
  1 failing

  1) ${c.Word} login
       submits valid credentials:
     AssertionError: Timed out retrying after 4000ms: Expected to find content: '${c.want}' but never did.
      at Context.eval (webpack://${c.word}/./cypress/e2e/login_${c.stem}.cy.ts:${c.line}:${c.col})


  (Results)

  ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
  │ Tests:        2                                                                                │
  │ Passing:      1                                                                                │
  │ Failing:      1                                                                                │
  └────────────────────────────────────────────────────────────────────────────────────────────────┘`,
  gold(['submits valid credentials'], [`login_${c.stem}.cy.ts:${c.line}:${c.col}`], [`Expected to find content: '${c.want}'`])),
  'h2-webpack-resolve': c => out('webpack', 'npx webpack --mode production', `${Array.from({ length: 12 + c.serial % 7 }, (_, i) => `asset chunk-${i}.${(c.serial * (i + 3)).toString(16)}.js ${(i * 3.7 + 1.2).toFixed(1)} KiB [emitted] [minimized]`).join('\n')}
orphan modules ${c.serial % 900 + 100} KiB [orphan] ${c.serial % 90 + 30} modules
runtime modules 2.${c.serial % 9} KiB 6 modules

ERROR in ./src/${c.word}/${c.stem}.ts ${c.line}:${c.col}-${c.col + 24}
Module not found: Error: Can't resolve './${c.word}-helpers' in '${c.abs(`src/${c.word}`)}'
resolve './${c.word}-helpers' in '${c.abs(`src/${c.word}`)}'
  using description file: ${c.abs('package.json')} (relative path: ./src/${c.word})

webpack 5.94.0 compiled with 1 error in ${c.serial % 4000 + 900} ms`, gold([], [`./src/${c.word}/${c.stem}.ts ${c.line}:${c.col}`], [`Can't resolve './${c.word}-helpers'`])),
  'h2-next-type-error': c => out('next', 'npm run build', `
> ${c.word}-web@0.${c.serial % 30}.0 build
> next build

  ▲ Next.js 14.2.${c.serial % 9}

   Creating an optimized production build ...
${prelude(c, 'log', 10)}
 ✓ Compiled successfully
   Linting and checking validity of types  ..Failed to compile.

./src/app/${c.word}/page.tsx:${c.line}:${c.col}
Type error: Property '${c.word}Id' does not exist on type '{ params: { slug: string; }; }'.

  ${c.line - 1} | export default function Page(props: Props) {
> ${c.line} |   const id = props.${c.word}Id;
    |                    ^
  ${c.line + 1} |   return <View id={id} />;
Next.js build worker exited with code: 1 and signal: null`, gold([], [`./src/app/${c.word}/page.tsx:${c.line}:${c.col}`], [`Property '${c.word}Id' does not exist`])),
  'h2-clang-ninja': c => out('ninja', 'cmake --build build', `${prelude(c, 'build')}
FAILED: src/CMakeFiles/${c.word}.dir/${c.stem}.cpp.o
/usr/bin/c++ -I/srv/ci/${c.stem}/include -O2 -std=c++20 -MD -MT src/CMakeFiles/${c.word}.dir/${c.stem}.cpp.o -c /srv/ci/${c.stem}/src/${c.stem}.cpp
/srv/ci/${c.stem}/src/${c.stem}.cpp:${c.line}:${c.col}: error: no member named 'flush${c.serial}' in '${c.Word}::Writer'
  ${c.line} |     writer.flush${c.serial}();
      |     ~~~~~~ ^
1 error generated.
ninja: build stopped: subcommand failed.`, gold([], [`${c.stem}.cpp:${c.line}:${c.col}`], [`no member named 'flush${c.serial}'`])),
  'h2-gitlab-ansi-jest': c => {
    const E = '\u001b';
    return out('jest', 'npm test', `${E}[0Ksection_start:${1760000000 + c.serial}:prepare_script\r${E}[0K${E}[0K${E}[36;1mPreparing environment${E}[0;m
Running on runner-${c.serial % 900} via ci-${c.word}...
${Array.from({ length: 12 + c.serial % 6 }, (_, i) => `${E}[0;m${E}[1m${E}[42m PASS ${E}[49m${E}[22m ${E}[2msrc/${c.word}/${E}[22m${E}[1mpart_${i}.test.ts${E}[22m`).join('\n')}
${E}[0;m${E}[1m${E}[41m FAIL ${E}[49m${E}[22m ${E}[2msrc/cart/${E}[22m${E}[1m${c.stem}.test.ts${E}[22m
${E}[1m${E}[31m  ${E}[1m● ${E}[22m${E}[1m${c.Word} cart › keeps quantity${E}[39m${E}[22m

    ${E}[2mexpect(${E}[22m${E}[31mreceived${E}[39m${E}[2m).${E}[22mtoBe${E}[2m(${E}[22m${E}[32mexpected${E}[39m${E}[2m) // Object.is equality${E}[22m

    Expected: ${E}[32m"${c.want}"${E}[39m
    Received: ${E}[31m"${c.got}"${E}[39m

${E}[2m      at Object.<anonymous> (${E}[22m${E}[36msrc/cart/${c.stem}.test.ts${E}[39m${E}[2m:${c.line}:${c.col})${E}[22m

${E}[1mTests:       ${E}[22m${E}[1m${E}[31m1 failed${E}[39m${E}[22m, ${E}[1m${E}[32m${c.serial % 90 + 20} passed${E}[39m${E}[22m, ${c.serial % 90 + 21} total
${E}[0Ksection_end:${1760000090 + c.serial}:step_script\r${E}[0K${E}[31;1mERROR: Job failed: exit code 1
${E}[0;m`, gold([`${c.Word} cart › keeps quantity`], [`src/cart/${c.stem}.test.ts`, `:${c.line}:${c.col})`], [c.want, c.got]));
  },
  'h2-python-chained': c => {
    const l2 = c.line + 40, l3 = c.line + 12;
    return out('python', `python -m ${c.word}.main`, `${prelude(c, 'log')}
Traceback (most recent call last):
  File "${c.abs(`${c.word}/config.py`)}", line ${c.line}, in load
    return settings["${c.word}_url"]
           ~~~~~~~~^^^^^^^^^^^^^^^^^^^^
KeyError: '${c.word}_url'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "${c.abs(`${c.word}/main.py`)}", line ${l2}, in <module>
    main()
  File "${c.abs(`${c.word}/main.py`)}", line ${l3}, in main
    cfg = load()
          ^^^^^^
  File "${c.abs(`${c.word}/config.py`)}", line ${c.line + 2}, in load
    raise ConfigError("missing ${c.word}_url")
${c.word}.config.ConfigError: missing ${c.word}_url`, gold([], [`config.py", line ${c.line}`], [`KeyError: '${c.word}_url'`, `ConfigError: missing ${c.word}_url`]));
  },
  'h2-jest-console-noise': c => out('jest', 'npx jest', `${Array.from({ length: 6 + c.serial % 4 }, (_, i) => `  console.log
    ${c.word} cache warmed ${c.serial + i}

      at log (src/${c.word}/cache.ts:${10 + i * 3}:13)

  console.warn
    deprecated option ${c.word}Mode${i}

      at warn (src/${c.word}/config.ts:${30 + i * 2}:11)
`).join('\n')}
FAIL src/${c.word}/${c.stem}.test.ts
  ● ${c.word} cache › expires stale entries

    expect(received).toBe(expected) // Object.is equality

    Expected: false
    Received: true

      at Object.<anonymous> (src/${c.word}/${c.stem}.test.ts:${c.line}:${c.col})

Test Suites: 1 failed, 2 passed, 3 total
Tests:       1 failed, ${c.serial % 30 + 8} passed, ${c.serial % 30 + 9} total`,
  gold([`${c.word} cache › expires stale entries`], [`src/${c.word}/${c.stem}.test.ts:${c.line}`], ['Expected: false', 'Received: true'])),
  'h2-pytest-many-failures': c => {
    const n = 32 + c.serial % 9;
    const blocks = Array.from({ length: n }, (_, i) => `_______________________ test_${c.word}_roundtrip[${i}] ________________________

value = ${i}

    @pytest.mark.parametrize("value", range(${n + 6}))
    def test_${c.word}_roundtrip(value):
>       assert decode(encode(value)) == value
E       assert ${i + 1} == ${i}
E        +  where ${i + 1} = decode('${(i + c.serial).toString(16)}')

tests/test_${c.stem}.py:${c.line}: AssertionError`).join('\n');
    return out('pytest', 'pytest', `============================= test session starts ==============================
platform linux -- Python 3.12.${c.serial % 8}, pytest-8.3.${c.serial % 5}, pluggy-1.5.0
rootdir: /srv/ci/${c.stem}
collected ${n + 6} items

tests/test_${c.stem}.py ${'F'.repeat(n)}${'.'.repeat(6)}                      [100%]

=================================== FAILURES ===================================
${blocks}
=========================== short test summary info ============================
${Array.from({ length: n }, (_, i) => `FAILED tests/test_${c.stem}.py::test_${c.word}_roundtrip[${i}] - assert ${i + 1} == ${i}`).join('\n')}
========================= ${n} failed, 6 passed in 0.${c.serial % 80 + 11}s =========================`,
    gold([`test_${c.word}_roundtrip[0]`], [`tests/test_${c.stem}.py:${c.line}`], [`${n} failed, 6 passed`]));
  },
  'h2-catch2-ctest': c => {
    const l2 = c.line - 6;
    return out('ctest', 'ctest --output-on-failure', `Test project ${c.abs('build')}
    Start 1: ${c.word}_unit
1/3 Test #1: ${c.word}_unit .....................***Failed    0.02 sec
Randomness seeded to: ${c.serial * 13}

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
${c.word}_unit is a Catch2 v3.7.${c.serial % 2} host application.
Run with -? for options

-------------------------------------------------------------------------------
${c.word} totals round to cents
-------------------------------------------------------------------------------
${c.abs(`tests/${c.stem}_test.cpp`)}:${l2}
...............................................................................

${c.abs(`tests/${c.stem}_test.cpp`)}:${c.line}: FAILED:
  REQUIRE( total == ${c.a} )
with expansion:
  ${c.b} == ${c.a}

===============================================================================
test cases: ${c.serial % 20 + 4} | ${c.serial % 20 + 3} passed | 1 failed
assertions: ${c.serial % 50 + 9} | ${c.serial % 50 + 8} passed | 1 failed

${Array.from({ length: 2 }, (_, i) => `    Start ${i + 2}: ${c.word}_part${i}\n${i + 2}/3 Test #${i + 2}: ${c.word}_part${i} ....................   Passed    0.0${i + 1} sec`).join('\n')}

67% tests passed, 1 tests failed out of 3

Total Test time (real) =   0.${c.serial % 90 + 10} sec

The following tests FAILED:
	  1 - ${c.word}_unit (Failed)
Errors while running CTest`, gold([`${c.word} totals round to cents`], [`${c.stem}_test.cpp:${c.line}`], [`REQUIRE( total == ${c.a} )`, `${c.b} == ${c.a}`]));
  },
  'h2-cargo-passing-warnings': c => {
    const n = c.serial % 80 + 30;
    return out('cargo', 'cargo test', `${prelude(c, 'rust', 20)}
warning: unused variable: \`scratch\`
  --> src/${c.word}.rs:${c.line}:9
   |
${c.line} |     let scratch = Vec::with_capacity(8);
   |         ^^^^^^^ help: if this is intentional, prefix it with an underscore: \`_scratch\`
   |
   = note: \`#[warn(unused_variables)]\` on by default

warning: \`${c.word}\` (lib test) generated 1 warning
    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 9.${c.serial % 9}s
     Running unittests src/lib.rs (target/debug/deps/${c.word}-${(c.serial * 31).toString(16)})

running ${n} tests
${Array.from({ length: 8 }, (_, i) => `test ${c.word}::tests::case_${i} ... ok`).join('\n')}

test result: ok. ${n} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.0${c.serial % 9}s`,
    gold([], [], [`test result: ok. ${n} passed; 0 failed`]), 0);
  },
  'h2-pytest-passing-warnings': c => {
    const n = c.serial % 300 + 60;
    return out('pytest', 'pytest', `============================= test session starts ==============================
platform darwin -- Python 3.13.${c.serial % 4}, pytest-8.3.${c.serial % 5}, pluggy-1.5.0
rootdir: /srv/ci/${c.stem}
collected ${n} items

${prelude(c, 'py', 18)}

=============================== warnings summary ===============================
tests/test_${c.stem}.py::test_${c.word}_legacy
  /srv/ci/${c.stem}/${c.word}/compat.py:${c.line}: DeprecationWarning: ${c.word}.load_v1 is deprecated
    warnings.warn("${c.word}.load_v1 is deprecated", DeprecationWarning)

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
======================= ${n} passed, 1 warning in 4.${c.serial % 90}s ========================`,
    gold([], [], [`${n} passed, 1 warning`]), 0);
  },
};

const tasks = Object.entries(FAMILIES).flatMap(([family, render], ordinal) =>
  Array.from({ length: PER_FAMILY }, (_, variant) => ({ id: `holdout2-test-${family}-${variant + 1}`, family, ...render(context(ordinal, variant)) })));

// Gold must be literally present, logs unique, and every log long enough to need a digest.
const outputs = new Set();
for (const t of tasks) {
  assert(!outputs.has(t.rawOutput), `Duplicate log ${t.id}`); outputs.add(t.rawOutput);
  const facts = [...t.gold.expectedTests, ...t.gold.expectedFiles, ...t.gold.expectedAssertions];
  assert(facts.length && facts.length <= 12, `Gold size ${t.id}`);
  for (const fact of facts) assert(t.rawOutput.includes(fact), `Gold missing from log ${t.id}: ${fact}`);
  for (const bad of t.gold.forbiddenStrings) assert(t.rawOutput.includes(bad) && !facts.some(f => f.includes(bad)), `Forbidden string ${t.id}: ${bad}`);
  assert(t.rawOutput.length > 800, `Log too short to need a digest: ${t.id}`);
}
assert.equal(tasks.length, 1000);
const directory = path.join(HERE, 'quality/holdout2');
const content = JSON.stringify(tasks, null, 2) + '\n';
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'test.json'), content);
writeFileSync(path.join(directory, 'test-manifest.json'), JSON.stringify({ tasks: tasks.length, dataSha256: sha(content), split: 'holdout2',
  families: Object.fromEntries(Object.keys(FAMILIES).map(family => [family, PER_FAMILY])),
  scope: 'Second Test holdout. Layouts authored from tool output conventions on 2026-10-16; serials 610000+; new word list. Aggregate-only scoring of frozen candidates; failure rows are not read for tuning.',
  trainingInputsUsed: false, sealedInputsUsed: false, developmentInputsUsed: false, firstHoldoutInputsUsed: false }, null, 2) + '\n');
console.log(JSON.stringify({ head: 'test', split: 'holdout2', tasks: tasks.length, families: Object.keys(FAMILIES).length, sha256: sha(content) }));
