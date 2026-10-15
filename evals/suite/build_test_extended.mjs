// Extended Test development set: failure layouts the original development set lacks,
// written from each framework's documented output conventions. Development only; it does
// not read the Test holdout renderers, and no model or sealed input is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const PER_FAMILY = 13;
const WORDS = ['lantern', 'meadow', 'saddle', 'thimble', 'walnut', 'beacon', 'kettle', 'mosaic', 'pebble', 'velvet'];
const gold = (tests = [], files = [], assertions = [], forbidden = []) => ({
  expectedTests: tests, expectedFiles: files, expectedAssertions: assertions, forbiddenStrings: forbidden,
});

function context(ordinal, variant) {
  const serial = 520000 + ordinal * 100 + variant;
  const word = WORDS[(ordinal * 3 + variant) % WORDS.length];
  const Word = word[0].toUpperCase() + word.slice(1);
  const stem = `${word}_${serial}`;
  const windows = variant % 3 === 1;
  const root = windows ? `D:\\builds\\${stem}` : `/home/ci/${stem}`;
  return {
    serial, word, Word, stem, root, windows,
    want: `expected-${word}-${serial + 5}`, got: `actual-${word}-${serial + 9}`,
    line: 12 + (ordinal * 7 + variant * 11) % 180, col: 3 + variant % 9,
    abs: rel => windows ? `${root}\\${rel.replaceAll('/', '\\')}` : `${root}/${rel}`,
  };
}
// Runner chatter that carries no failure signal.
function chatter(c, count = 16) {
  return Array.from({ length: count + c.serial % 7 }, (_, i) =>
    `[${String(i).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}] ${c.stem} prepared fixture ${i + 1} of ${count + 6} (seed ${c.serial * 3 + i})`).join('\n');
}
const libStack = c => [`    at runTest (${c.abs('node_modules/test-runner-core/lib/run.js')}:211:19)`, '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)'].join('\n');
const libForbidden = ['test-runner-core', 'node:internal/process/task_queues:95:5'];
const out = (framework, command, rawOutput, g, exitCode = 1) => ({ framework, command, exitCode, rawOutput: rawOutput.trimEnd(), gold: g });

const FAMILIES = {
  'ext-jest-three-failures': c => {
    const names = [`${c.word} totals add tax`, `${c.word} totals round half up`, `${c.word} refunds keep currency`];
    const files = [`src/${c.stem}.test.ts:${c.line}`, `src/${c.stem}.test.ts:${c.line + 9}`, `src/refund_${c.serial}.test.ts:${c.line + 2}`];
    return out('jest', 'npx jest', `${chatter(c)}
FAIL src/${c.stem}.test.ts
  ● ${names[0]}

    expect(received).toBe(expected) // Object.is equality

    Expected: ${c.serial + 1}
    Received: ${c.serial + 2}

      at Object.<anonymous> (${files[0]}:14)

  ● ${names[1]}

    expect(received).toBeCloseTo(expected, 2)

    Expected: 0.${c.serial % 89 + 10}
    Received: 0.${c.serial % 89 + 11}

      at Object.<anonymous> (${files[1]}:20)

FAIL src/refund_${c.serial}.test.ts
  ● ${names[2]}

    TypeError: Cannot read properties of undefined (reading 'currency_${c.serial}')

      at Object.<anonymous> (${files[2]}:7)
${libStack(c)}

Test Suites: 2 failed, 9 passed, 11 total
Tests:       3 failed, 58 passed, 61 total`, gold(names, files, [`Expected: ${c.serial + 1}`, `Received: ${c.serial + 2}`, `reading 'currency_${c.serial}'`], libForbidden));
  },
  'ext-vitest-snapshot-file': c => out('vitest', 'npx vitest run', `${chatter(c)}
 ❯ src/${c.stem}.spec.ts (6 tests | 1 failed) 31ms
   × renders ${c.word} badge 9ms
     → Snapshot \`renders ${c.word} badge 1\` mismatched

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/${c.stem}.spec.ts > renders ${c.word} badge
Error: Snapshot \`renders ${c.word} badge 1\` mismatched

- Expected
+ Received

- <span class="badge">${c.want}</span>
+ <span class="badge">${c.got}</span>

 ❯ src/${c.stem}.spec.ts:${c.line}:${c.col}

 Test Files  1 failed | 4 passed (5)
      Tests  1 failed | 27 passed (28)`, gold([`renders ${c.word} badge`], [`src/${c.stem}.spec.ts:${c.line}`], [c.want, c.got])),
  'ext-vitest-timeout': c => out('vitest', 'npx vitest run', `${chatter(c)}
 FAIL  test/${c.stem}.test.ts > ${c.word} sync waits for ack
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/${c.stem}.test.ts:${c.line}:3

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 15 passed (16)`, gold([`${c.word} sync waits for ack`], [`test/${c.stem}.test.ts:${c.line}`], ['Test timed out in 5000ms'])),
  'ext-node-uncaught': c => out('node', `node scripts/${c.stem}.mjs`, `${chatter(c)}
file://${c.windows ? '/D:/builds/' + c.stem : '/home/ci/' + c.stem}/scripts/${c.stem}.mjs:${c.line}
  return config.${c.word}.limit_${c.serial};
                            ^

TypeError: Cannot read properties of undefined (reading 'limit_${c.serial}')
    at loadLimits (file://${c.windows ? '/D:/builds/' + c.stem : '/home/ci/' + c.stem}/scripts/${c.stem}.mjs:${c.line}:29)
    at file://${c.windows ? '/D:/builds/' + c.stem : '/home/ci/' + c.stem}/scripts/${c.stem}.mjs:${c.line + 20}:1
    at ModuleJob.run (node:internal/modules/esm/module_job:271:25)

Node.js v22.16.0`, gold([], [`scripts/${c.stem}.mjs:${c.line}:29`], [`reading 'limit_${c.serial}'`])),
  'ext-pytest-parametrize': c => out('pytest', 'pytest -q', `${chatter(c)}
..........F.....                                                         [100%]
=================================== FAILURES ===================================
________________ test_${c.word}_parse[case-${c.serial % 9}-${c.want}] _________________

raw = '${c.got}', expected = '${c.want}'

    @pytest.mark.parametrize("raw,expected", CASES)
    def test_${c.word}_parse(raw, expected):
>       assert parse(raw) == expected
E       AssertionError: assert '${c.got}' == '${c.want}'

tests/test_${c.stem}.py:${c.line}: AssertionError
=========================== short test summary info ============================
FAILED tests/test_${c.stem}.py::test_${c.word}_parse[case-${c.serial % 9}-${c.want}] - AssertionError
1 failed, 15 passed in 0.38s`, gold([`test_${c.word}_parse[case-${c.serial % 9}-${c.want}]`], [`tests/test_${c.stem}.py:${c.line}`], [c.want, c.got])),
  'ext-pytest-dict-diff': c => out('pytest', 'pytest -vv', `${chatter(c)}
tests/test_${c.stem}.py::test_${c.word}_record FAILED                    [ 50%]
=================================== FAILURES ===================================
____________________________ test_${c.word}_record _____________________________

    def test_${c.word}_record():
>       assert build_record() == {"id": ${c.serial}, "state": "${c.want}"}
E       AssertionError: assert {'id': ${c.serial}, 'state': '${c.got}'} == {'id': ${c.serial}, 'state': '${c.want}'}
E
E         Common items:
E         {'id': ${c.serial}}
E         Differing items:
E         {'state': '${c.got}'} != {'state': '${c.want}'}

tests/test_${c.stem}.py:${c.line}: AssertionError
----------------------------- Captured stdout call -----------------------------
building ${c.word} record ${c.serial}
=========================== short test summary info ============================
FAILED tests/test_${c.stem}.py::test_${c.word}_record - AssertionError: assert {...
========================= 1 failed, 1 passed in 0.21s ==========================`, gold([`test_${c.word}_record`], [`tests/test_${c.stem}.py:${c.line}`], [`{'state': '${c.got}'} != {'state': '${c.want}'}`])),
  'ext-pytest-collection-error': c => out('pytest', 'pytest', `${chatter(c)}
==================================== ERRORS ====================================
__________________ ERROR collecting tests/test_${c.stem}.py ___________________
ImportError while importing test module '${c.abs(`tests/test_${c.stem}.py`)}'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
/usr/lib/python3.12/importlib/__init__.py:90: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
tests/test_${c.stem}.py:${c.line}: in <module>
    from ${c.word}.codec import decode_${c.serial}
E   ImportError: cannot import name 'decode_${c.serial}' from '${c.word}.codec'
=========================== short test summary info ============================
ERROR tests/test_${c.stem}.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
1 error in 0.19s`, gold([], [`tests/test_${c.stem}.py:${c.line}`], [`cannot import name 'decode_${c.serial}'`], ['importlib/__init__.py:90'])),
  'ext-go-panic': c => out('go', 'go test ./...', `${chatter(c)}
--- FAIL: Test${c.Word}Window (0.00s)
panic: runtime error: index out of range [${c.serial % 50 + 5}] with length ${c.serial % 50 + 5} [recovered]
	panic: runtime error: index out of range [${c.serial % 50 + 5}] with length ${c.serial % 50 + 5}

goroutine 7 [running]:
testing.tRunner.func1.2({0x1023c4a40, 0x14000126018})
	/usr/local/go/src/testing/testing.go:1632 +0x1bc
example.com/${c.word}/window.(*Ring).At(...)
	${c.abs(`window/ring.go`)}:${c.line}
example.com/${c.word}/window.Test${c.Word}Window(0x14000103380)
	${c.abs(`window/ring_test.go`)}:${c.line + 30} +0x48
FAIL	example.com/${c.word}/window	0.011s
FAIL`, gold([`Test${c.Word}Window`], [`ring.go:${c.line}`], [`index out of range [${c.serial % 50 + 5}]`], ['testing/testing.go:1632'])),
  'ext-go-testify': c => out('go', 'go test ./...', `${chatter(c)}
--- FAIL: Test${c.Word}Status (0.00s)
    status_test.go:${c.line}:
        	Error Trace:	${c.abs('status/status_test.go')}:${c.line}
        	Error:      	Not equal:
        	            	expected: "${c.want}"
        	            	actual  : "${c.got}"
        	Test:       	Test${c.Word}Status
FAIL
FAIL	example.com/${c.word}/status	0.006s`, gold([`Test${c.Word}Status`], [`status_test.go:${c.line}`], [c.want, c.got])),
  'ext-cargo-nextest': c => out('cargo', 'cargo nextest run', `${chatter(c)}
    Starting 24 tests across 3 binaries
        PASS [   0.004s] ${c.word} codec::tests::encodes_empty
        FAIL [   0.006s] ${c.word} codec::tests::decodes_${c.word}

--- STDOUT:              ${c.word} codec::tests::decodes_${c.word} ---

running 1 test
test codec::tests::decodes_${c.word} ... FAILED

--- STDERR:              ${c.word} codec::tests::decodes_${c.word} ---
thread 'codec::tests::decodes_${c.word}' panicked at src/codec.rs:${c.line}:9:
assertion \`left == right\` failed
  left: "${c.got}"
 right: "${c.want}"

     Summary [   0.031s] 24 tests run: 23 passed, 1 failed, 0 skipped
        FAIL [   0.006s] ${c.word} codec::tests::decodes_${c.word}
error: test run failed`, gold([`codec::tests::decodes_${c.word}`], [`src/codec.rs:${c.line}`], [c.want, c.got])),
  'ext-cargo-test-compile': c => out('cargo', 'cargo test', `${chatter(c)}
   Compiling ${c.word} v0.4.${c.serial % 10} (${c.abs('')})
error[E0425]: cannot find value \`${c.word}_limit_${c.serial}\` in this scope
  --> tests/${c.stem}.rs:${c.line}:17
   |
${c.line} |     assert_eq!(${c.word}_limit_${c.serial}, 4);
   |                 ^^^^^^^^^^^^^^^^^ not found in this scope

For more information about this error, try \`rustc --explain E0425\`.
error: could not compile \`${c.word}\` (test "${c.stem}") due to 1 previous error`, gold([], [`tests/${c.stem}.rs:${c.line}`], ['E0425', `cannot find value \`${c.word}_limit_${c.serial}\``])),
  'ext-tsc-three-errors': c => out('tsc', 'npx tsc -p .', `${chatter(c)}
src/${c.word}/model.ts:${c.line}:${c.col} - error TS2339: Property 'total_${c.serial}' does not exist on type '${c.Word}Order'.

${c.line}     return order.total_${c.serial};
                       ~~~~~~~~~~~~

src/${c.word}/view.tsx:${c.line + 4}:5 - error TS2741: Property 'label' is missing in type '{}' but required in type '${c.Word}Props'.

src/${c.word}/api.ts:${c.line + 8}:12 - error TS7006: Parameter 'payload' implicitly has an 'any' type.

Found 3 errors in 3 files.

Errors  Files
     1  src/${c.word}/model.ts:${c.line}
     1  src/${c.word}/view.tsx:${c.line + 4}
     1  src/${c.word}/api.ts:${c.line + 8}`, gold([], [`src/${c.word}/model.ts:${c.line}:${c.col}`, `src/${c.word}/view.tsx:${c.line + 4}:5`, `src/${c.word}/api.ts:${c.line + 8}:12`], ['TS2339', 'TS2741', 'TS7006'])),
  'ext-eslint': c => out('eslint', 'npx eslint .', `${chatter(c)}

${c.abs(`src/${c.stem}.js`)}
  ${c.line}:${c.col}  error    '${c.word}Cache${c.serial}' is assigned a value but never used  no-unused-vars
  ${c.line + 6}:1  warning  Unexpected console statement                                   no-console

✖ 2 problems (1 error, 1 warning)`, gold([], [`${c.line}:${c.col}`], [`'${c.word}Cache${c.serial}' is assigned a value but never used`, 'no-unused-vars'])),
  'ext-mypy': c => out('mypy', 'mypy src', `${chatter(c)}
src/${c.word}/service.py:${c.line}: error: Incompatible return value type (got "str", expected "int")  [return-value]
src/${c.word}/service.py:${c.line + 11}: error: Argument 1 to "lookup_${c.serial}" has incompatible type "None"; expected "str"  [arg-type]
Found 2 errors in 1 file (checked 37 source files)`, gold([], [`src/${c.word}/service.py:${c.line}`, `src/${c.word}/service.py:${c.line + 11}`], ['[return-value]', `"lookup_${c.serial}"`])),
  'ext-gradle-junit': c => out('gradle', './gradlew test', `${chatter(c)}
> Task :app:test

${c.Word}ServiceTest > computes${c.Word}Total() FAILED
    org.opentest4j.AssertionFailedError: expected: <${c.want}> but was: <${c.got}>
        at app//org.junit.jupiter.api.AssertionFailureBuilder.build(AssertionFailureBuilder.java:151)
        at app//com.example.${c.word}.${c.Word}ServiceTest.computes${c.Word}Total(${c.Word}ServiceTest.java:${c.line})

42 tests completed, 1 failed

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:test'.
> There were failing tests. See the report at: file://${c.abs('app/build/reports/tests/test/index.html')}

BUILD FAILED in 9s`, gold([`computes${c.Word}Total`], [`${c.Word}ServiceTest.java:${c.line}`], [c.want, c.got], ['AssertionFailureBuilder.java:151'])),
  'ext-phpunit': c => out('phpunit', 'vendor/bin/phpunit', `${chatter(c)}
PHPUnit 11.4.3 by Sebastian Bergmann and contributors.

.......F...                                                       11 / 11 (100%)

Time: 00:00.041, Memory: 10.00 MB

There was 1 failure:

1) Tests\\${c.Word}\\InvoiceTest::test${c.Word}Number
Failed asserting that two strings are identical.
--- Expected
+++ Actual
@@ @@
-'${c.want}'
+'${c.got}'

${c.abs(`tests/${c.Word}/InvoiceTest.php`)}:${c.line}

FAILURES!
Tests: 11, Assertions: 19, Failures: 1.`, gold([`test${c.Word}Number`], [`InvoiceTest.php:${c.line}`], [c.want, c.got])),
  'ext-rspec': c => out('rspec', 'bundle exec rspec', `${chatter(c)}
.....F..

Failures:

  1) ${c.Word}Quote applies the ${c.word} discount
     Failure/Error: expect(quote.total).to eq("${c.want}")

       expected: "${c.want}"
            got: "${c.got}"

       (compared using ==)
     # ./spec/models/${c.stem}_spec.rb:${c.line}:in \`block (2 levels) in <top (required)>'

Finished in 0.0712 seconds (files took 0.4 seconds to load)
8 examples, 1 failure

Failed examples:

rspec ./spec/models/${c.stem}_spec.rb:${c.line - 2} # ${c.Word}Quote applies the ${c.word} discount`, gold([`${c.Word}Quote applies the ${c.word} discount`], [`spec/models/${c.stem}_spec.rb:${c.line}`], [c.want, c.got])),
  'ext-exunit': c => out('exunit', 'mix test', `${chatter(c)}
.....

  1) test ${c.word} slug is normalized (${c.Word}.SlugTest)
     test/${c.word}/slug_test.exs:${c.line}
     Assertion with == failed
     code:  assert Slug.normalize(input) == "${c.want}"
     left:  "${c.got}"
     right: "${c.want}"
     stacktrace:
       test/${c.word}/slug_test.exs:${c.line + 2}: (test)

Finished in 0.04 seconds (0.02s async, 0.02s sync)
6 tests, 1 failure`, gold([`${c.word} slug is normalized`], [`test/${c.word}/slug_test.exs:${c.line}`], [c.want, c.got])),
  'ext-xctest': c => out('xctest', 'swift test', `${chatter(c)}
Test Suite '${c.Word}Tests' started at 2026-10-15 09:12:44.101.
Test Case '-[${c.Word}Tests.${c.Word}Tests testFormat${c.serial}]' started.
${c.abs(`Tests/${c.Word}Tests/${c.Word}Tests.swift`)}:${c.line}: error: -[${c.Word}Tests.${c.Word}Tests testFormat${c.serial}] : XCTAssertEqual failed: ("${c.got}") is not equal to ("${c.want}")
Test Case '-[${c.Word}Tests.${c.Word}Tests testFormat${c.serial}]' failed (0.003 seconds).
Test Suite '${c.Word}Tests' failed at 2026-10-15 09:12:44.109.
	 Executed 9 tests, with 1 failure (0 unexpected) in 0.008 (0.009) seconds
error: fatalError`, gold([`testFormat${c.serial}`], [`${c.Word}Tests.swift:${c.line}`], [c.want, c.got])),
  'ext-deno': c => out('deno', 'deno test', `${chatter(c)}
running 4 tests from ./${c.stem}_test.ts
${c.word} merges headers ... FAILED (3ms)

 ERRORS

${c.word} merges headers => ./${c.stem}_test.ts:${c.line}:6
error: AssertionError: Values are not equal.


    [Diff] Actual / Expected


-   "${c.got}"
+   "${c.want}"

    at assertEquals (https://jsr.io/@std/assert/1.0.13/equals.ts:64:9)
    at file://${c.windows ? '/D:/builds/' + c.stem : '/home/ci/' + c.stem}/${c.stem}_test.ts:${c.line + 3}:3

 FAILURES

${c.word} merges headers => ./${c.stem}_test.ts:${c.line}:6

FAILED | 3 passed | 1 failed (14ms)`, gold([`${c.word} merges headers`], [`${c.stem}_test.ts:${c.line}`], [c.want, c.got], ['jsr.io/@std/assert'])),
  'ext-bun': c => out('bun', 'bun test', `${chatter(c)}
bun test v1.2.15

test/${c.stem}.test.ts:
✓ ${c.word} > parses header [0.21ms]
${c.line - 2} |   const parsed = parse${c.Word}(input);
${c.line - 1} |
${c.line} |   expect(parsed.code).toBe("${c.want}");
                            ^
error: expect(received).toBe(expected)

Expected: "${c.want}"
Received: "${c.got}"

      at <anonymous> (${c.abs(`test/${c.stem}.test.ts`)}:${c.line}:23)
✗ ${c.word} > parses footer [0.44ms]

 1 pass
 1 fail
 2 expect() calls
Ran 2 tests across 1 file. [18.00ms]`, gold([`${c.word} > parses footer`], [`${c.stem}.test.ts:${c.line}:23`], [c.want, c.got])),
  'ext-playwright': c => out('playwright', 'npx playwright test', `${chatter(c)}
Running 12 tests using 4 workers

  1) [chromium] › tests/${c.stem}.spec.ts:${c.line}:5 › ${c.word} checkout shows total ──────────────

    Error: expect(locator).toHaveText(expected) failed

    Locator: getByTestId('total')
    Expected string: "${c.want}"
    Received string: "${c.got}"
    Timeout: 5000ms

      ${c.line + 4} |   await expect(page.getByTestId('total')).toHaveText('${c.want}');
         |                                            ^
        at ${c.abs(`tests/${c.stem}.spec.ts`)}:${c.line + 4}:44

  1 failed
    [chromium] › tests/${c.stem}.spec.ts:${c.line}:5 › ${c.word} checkout shows total
  11 passed (8.1s)`, gold([`${c.word} checkout shows total`], [`tests/${c.stem}.spec.ts:${c.line}`], [c.want, c.got])),
  'ext-gtest-ctest': c => out('ctest', 'ctest --output-on-failure', `${chatter(c)}
    Start 3: ${c.word}_tests
3/5 Test #3: ${c.word}_tests ......................***Failed    0.02 sec
[==========] Running 6 tests from 1 test suite.
[ RUN      ] ${c.Word}Parser.Reads${c.serial}
${c.abs(`tests/${c.word}_parser_test.cc`)}:${c.line}: Failure
Expected equality of these values:
  parser.read()
    Which is: "${c.got}"
  "${c.want}"
[  FAILED  ] ${c.Word}Parser.Reads${c.serial} (0 ms)
[==========] 6 tests from 1 test suite ran. (1 ms total)
[  PASSED  ] 5 tests.
[  FAILED  ] 1 test, listed below:
[  FAILED  ] ${c.Word}Parser.Reads${c.serial}

80% tests passed, 1 tests failed out of 5

The following tests FAILED:
	  3 - ${c.word}_tests (Failed)
Errors while running CTest`, gold([`${c.Word}Parser.Reads${c.serial}`], [`${c.word}_parser_test.cc:${c.line}`], [c.want, c.got])),
  'ext-gcc-make': c => out('make', 'make', `${chatter(c)}
cc -O2 -Wall -c src/${c.word}.c -o build/${c.word}.o
src/${c.word}.c: In function '${c.word}_flush':
src/${c.word}.c:${c.line}:${c.col}: error: '${c.word}_count_${c.serial}' undeclared (first use in this function)
   ${c.line} |     return ${c.word}_count_${c.serial} + 1;
      |            ^~~~~~~~~~~~~~~~~~~~
src/${c.word}.c:${c.line}:${c.col}: note: each undeclared identifier is reported only once for each function it appears in
make: *** [Makefile:${c.serial % 40 + 10}: build/${c.word}.o] Error 1`, gold([], [`src/${c.word}.c:${c.line}:${c.col}`], [`'${c.word}_count_${c.serial}' undeclared`])),
  'ext-vite-build': c => out('vite', 'npm run build', `${chatter(c)}
> ${c.word}-web@1.0.0 build
> vite build

vite v6.3.5 building for production...
transforming...
✓ ${c.serial % 300 + 20} modules transformed.
x Build failed in 412ms
error during build:
[vite]: Rollup failed to resolve import "@${c.word}/charts-${c.serial}" from "${c.abs('src/pages/Report.tsx')}".
This is most likely unintended because it can break your application at runtime.`, gold([], ['Report.tsx'], [`Rollup failed to resolve import "@${c.word}/charts-${c.serial}"`])),
  'ext-crlf-jest': c => out('jest', 'npx jest', `${chatter(c)}
FAIL src/${c.stem}.test.js
  ● ${c.word} csv keeps quotes

    expect(received).toBe(expected) // Object.is equality

    Expected: "${c.want}"
    Received: "${c.got}"

      at Object.<anonymous> (src/${c.stem}.test.js:${c.line}:23)

Tests:       1 failed, 12 passed, 13 total`.replaceAll('\n', '\r\n'), gold([`${c.word} csv keeps quotes`], [`src/${c.stem}.test.js:${c.line}`], [c.want, c.got])),
  'ext-failure-midlog': c => out('pytest', 'pytest -q -s', `${chatter(c)}
F
=================================== FAILURES ===================================
_____________________________ test_${c.word}_quota _____________________________

>       assert remaining == ${c.serial % 1000}
E       assert ${c.serial % 1000 + 3} == ${c.serial % 1000}

tests/test_quota_${c.serial}.py:${c.line}: AssertionError
${Array.from({ length: 70 }, (_, i) => `teardown: released ${c.word} lease ${i + 1} (handle ${c.serial + i * 13})`).join('\n')}
1 failed, 40 passed in 2.04s`, gold([`test_${c.word}_quota`], [`tests/test_quota_${c.serial}.py:${c.line}`], [`assert ${c.serial % 1000 + 3} == ${c.serial % 1000}`])),
  'ext-python-module-missing': c => out('python', `python -m ${c.word}.cli selftest`, `${chatter(c)}
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File "${c.abs(`${c.word}/cli.py`)}", line ${c.line}, in <module>
    import ${c.word}_native_${c.serial}
ModuleNotFoundError: No module named '${c.word}_native_${c.serial}'`, gold([], ['cli.py', `line ${c.line}`], [`No module named '${c.word}_native_${c.serial}'`])),
  'ext-jest-ansi-two': c => {
    const red = s => `\x1b[31m${s}\x1b[39m`, dim = s => `\x1b[2m${s}\x1b[22m`;
    return out('jest', 'npx jest --colors', `${chatter(c)}
${red('FAIL')} ${dim('src/')}${c.stem}.test.ts
  ${red('●')} ${c.word} cart › merges lines
    Expected: ${'\x1b[32m'}"${c.want}"${'\x1b[39m'}
    Received: ${'\x1b[31m'}"${c.got}"${'\x1b[39m'}
      ${dim('at Object.<anonymous> (')}src/${c.stem}.test.ts:${c.line}:31${dim(')')}
  ${red('●')} ${c.word} cart › drops empty lines
    Expected: ${'\x1b[32m'}0${'\x1b[39m'}
    Received: ${'\x1b[31m'}${c.serial % 7 + 1}${'\x1b[39m'}
      ${dim('at Object.<anonymous> (')}src/${c.stem}.test.ts:${c.line + 12}:31${dim(')')}
Tests:       ${red('2 failed')}, 30 passed, 32 total`, gold([`${c.word} cart › merges lines`, `${c.word} cart › drops empty lines`],
      [`src/${c.stem}.test.ts:${c.line}`, `src/${c.stem}.test.ts:${c.line + 12}`], [c.want, c.got]));
  },
  'ext-node-spec-reporter': c => out('node:test', 'node --test', `${chatter(c)}
▶ ${c.word} ledger
  ✔ opens empty (0.41ms)
  ✖ posts ${c.word} entry ${c.serial} (1.9ms)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

    '${c.got}' !== '${c.want}'

        at TestContext.<anonymous> (${c.abs(`test/${c.stem}.test.mjs`)}:${c.line}:12)
        at Test.runInAsyncScope (node:async_hooks:211:14)
        at Test.run (node:internal/test_runner/test:979:25) {
      generatedMessage: true,
      code: 'ERR_ASSERTION',
      actual: '${c.got}',
      expected: '${c.want}',
      operator: 'strictEqual'
    }

▶ ${c.word} ledger (3.1ms)
ℹ tests 9
ℹ suites 1
ℹ pass 8
ℹ fail 1
ℹ duration_ms 61.2

✖ failing tests:

test at test/${c.stem}.test.mjs:${c.line - 3}:3
✖ posts ${c.word} entry ${c.serial} (1.9ms)`, gold([`posts ${c.word} entry ${c.serial}`], [`${c.stem}.test.mjs:${c.line}`], [c.want, c.got], ['node:internal/test_runner/test:979:25'])),
  'ext-unittest-verbose-failure': c => out('unittest', 'python -m unittest -v', `${chatter(c)}
test_${c.word}_rounding (tests.test_${c.stem}.${c.Word}Tests.test_${c.word}_rounding) ... FAIL
test_${c.word}_zero (tests.test_${c.stem}.${c.Word}Tests.test_${c.word}_zero) ... ok

======================================================================
FAIL: test_${c.word}_rounding (tests.test_${c.stem}.${c.Word}Tests.test_${c.word}_rounding)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "${c.abs(`tests/test_${c.stem}.py`)}", line ${c.line}, in test_${c.word}_rounding
    self.assertEqual(round_amount(${c.serial}), '${c.want}')
AssertionError: '${c.got}' != '${c.want}'
- ${c.got}
+ ${c.want}


----------------------------------------------------------------------
Ran 2 tests in 0.001s

FAILED (failures=1)`, gold([`test_${c.word}_rounding`], [`test_${c.stem}.py`, `line ${c.line}`], [`AssertionError: '${c.got}' != '${c.want}'`])),
  'ext-turbo-prefixed': c => out('jest', 'npx turbo run test', `${chatter(c)}
@${c.word}/api:test: cache miss, executing 7f3c${c.serial}
@${c.word}/web:test: PASS src/app.test.tsx
@${c.word}/api:test: FAIL src/routes/${c.stem}.test.ts
@${c.word}/api:test:   ● ${c.word} route rejects stale token
@${c.word}/api:test:     Expected: 401
@${c.word}/api:test:     Received: ${200 + c.serial % 4}
@${c.word}/api:test:       at Object.<anonymous> (src/routes/${c.stem}.test.ts:${c.line}:28)
@${c.word}/api:test: Tests:       1 failed, 22 passed, 23 total
@${c.word}/api:test: ERROR: command finished with error: command (packages/api) npm run test exited (1)
 Tasks:    1 successful, 2 total
Failed:    @${c.word}/api#test`, gold([`${c.word} route rejects stale token`], [`src/routes/${c.stem}.test.ts:${c.line}`], ['Expected: 401', `Received: ${200 + c.serial % 4}`])),
  'ext-actions-timestamps': c => {
    const ts = i => `2026-10-15T09:${String(10 + i).padStart(2, '0')}:0${i % 10}.${String(c.serial).slice(-7)}Z`;
    return out('pytest', 'pytest', `${chatter(c).split('\n').map((l, i) => `${ts(i % 40)} ${l}`).join('\n')}
${ts(41)} ________________________ test_${c.word}_retry_limit _________________________
${ts(42)} >       assert client.retries == 3
${ts(43)} E       assert ${c.serial % 5 + 4} == 3
${ts(44)} tests/test_${c.stem}.py:${c.line}: AssertionError
${ts(45)} =========================== short test summary info ============================
${ts(46)} FAILED tests/test_${c.stem}.py::test_${c.word}_retry_limit - assert ${c.serial % 5 + 4} == 3
${ts(47)} 1 failed, 64 passed in 3.11s
${ts(48)} ##[error]Process completed with exit code 1.`, gold([`test_${c.word}_retry_limit`], [`tests/test_${c.stem}.py:${c.line}`], [`assert ${c.serial % 5 + 4} == 3`]));
  },
  'ext-docker-build': c => out('docker', 'docker build .', `${chatter(c)}
#11 [builder 6/7] RUN npm ci
#11 4.120 added 612 packages in 4s
#11 DONE 4.6s

#12 [builder 7/7] RUN npm test
#12 0.731 FAIL src/${c.stem}.test.js
#12 0.732   ● ${c.word} parser keeps unicode
#12 0.733     Expected: "${c.want}"
#12 0.733     Received: "${c.got}"
#12 0.734       at Object.<anonymous> (src/${c.stem}.test.js:${c.line}:19)
#12 0.801 Tests:       1 failed, 40 passed, 41 total
#12 ERROR: process "/bin/sh -c npm test" did not complete successfully: exit code: 1
------
 > [builder 7/7] RUN npm test:
------
ERROR: failed to solve: process "/bin/sh -c npm test" did not complete successfully: exit code: 1`, gold([`${c.word} parser keeps unicode`], [`src/${c.stem}.test.js:${c.line}`], [c.want, c.got])),
  'ext-pytest-three-failures': c => {
    const names = [`test_${c.word}_open`, `test_${c.word}_close`, `test_${c.word}_reopen`];
    return out('pytest', 'pytest -q', `${chatter(c)}
..F..F...F                                                               [100%]
=================================== FAILURES ===================================
${names.map((name, i) => `_______________________________ ${name} _______________________________

>       assert state(${i}) == "${c.want}-${i}"
E       AssertionError: assert '${c.got}-${i}' == '${c.want}-${i}'

tests/test_${c.stem}.py:${c.line + i * 9}: AssertionError`).join('\n')}
=========================== short test summary info ============================
${names.map(name => `FAILED tests/test_${c.stem}.py::${name} - AssertionError`).join('\n')}
3 failed, 7 passed in 0.12s`, gold(names, names.map((_, i) => `tests/test_${c.stem}.py:${c.line + i * 9}`), [`${c.got}-0`, `${c.want}-2`]));
  },
  'ext-go-verbose-subtests': c => out('go', 'go test -v ./...', `${chatter(c)}
=== RUN   Test${c.Word}Parse
=== RUN   Test${c.Word}Parse/empty
=== RUN   Test${c.Word}Parse/unicode
    parse_test.go:${c.line}: parsing "${c.word}-${c.serial}"
    parse_test.go:${c.line + 4}: got ${c.got}, want ${c.want}
=== RUN   Test${c.Word}Parse/long
--- FAIL: Test${c.Word}Parse (0.00s)
    --- PASS: Test${c.Word}Parse/empty (0.00s)
    --- FAIL: Test${c.Word}Parse/unicode (0.00s)
    --- PASS: Test${c.Word}Parse/long (0.00s)
FAIL
FAIL	example.com/${c.word}/parse	0.004s
FAIL`, gold([`Test${c.Word}Parse/unicode`], [`parse_test.go:${c.line + 4}`], [`got ${c.got}, want ${c.want}`])),
  'ext-doctest': c => out('doctest', 'python -m doctest -v src/money.py', `${chatter(c)}
**********************************************************************
File "${c.abs(`src/${c.stem}.py`)}", line ${c.line}, in ${c.stem}.format_amount
Failed example:
    format_amount(${c.serial})
Expected:
    '${c.want}'
Got:
    '${c.got}'
**********************************************************************
1 items had failures:
   1 of   4 in ${c.stem}.format_amount
***Test Failed*** 1 failures.`, gold([`${c.stem}.format_amount`], [`line ${c.line}`], [c.want, c.got])),
  'ext-maven-compile': c => out('maven', 'mvn -q test', `${chatter(c)}
[ERROR] COMPILATION ERROR :
[ERROR] /home/ci/${c.stem}/src/main/java/com/example/${c.Word}Service.java:[${c.line},${c.col}] cannot find symbol
  symbol:   method total${c.serial}()
  location: variable order of type com.example.Order
[INFO] 1 error
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.13.0:compile (default-compile) on project ${c.word}: Compilation failure`, gold([], [`${c.Word}Service.java:[${c.line},${c.col}]`], ['cannot find symbol', `total${c.serial}()`])),
  'ext-dotnet-build': c => out('dotnet', 'dotnet test', `${chatter(c)}
  Determining projects to restore...
  All projects are up-to-date for restore.
${c.abs(`src/${c.Word}/Ledger.cs`)}(${c.line},${c.col}): error CS0103: The name '${c.word}Rate${c.serial}' does not exist in the current context [${c.abs(`src/${c.Word}/${c.Word}.csproj`)}]

Build FAILED.
    0 Warning(s)
    1 Error(s)`, gold([], [`Ledger.cs(${c.line},${c.col})`], ['CS0103', `'${c.word}Rate${c.serial}' does not exist`])),
  'ext-jasmine': c => out('jasmine', 'npx jasmine', `${chatter(c)}
Randomized with seed ${c.serial}
Started
....F...

Failures:
1) ${c.Word}Formatter formats ${c.word} labels
  Message:
    Expected '${c.got}' to equal '${c.want}'.
  Stack:
        at <Jasmine>
        at UserContext.<anonymous> (${c.abs(`spec/${c.stem}Spec.js`)}:${c.line}:30)
        at <Jasmine>

8 specs, 1 failure
Finished in 0.019 seconds`, gold([`${c.Word}Formatter formats ${c.word} labels`], [`${c.stem}Spec.js:${c.line}`], [`Expected '${c.got}' to equal '${c.want}'.`])),
  'ext-ava': c => out('ava', 'npx ava', `${chatter(c)}
  ✔ ${c.word} › loads defaults
  ✘ [fail]: ${c.word} › merges overrides ${c.serial}

  ─

  ${c.word} › merges overrides ${c.serial}

  test/${c.stem}.js:${c.line}

   ${c.line - 1}:   const merged = merge(base, overrides);
   ${c.line}:   t.is(merged.mode, '${c.want}');
   ${c.line + 1}: });

  Difference (- actual, + expected):

  - '${c.got}'
  + '${c.want}'

  ─

  1 test failed`, gold([`${c.word} › merges overrides ${c.serial}`], [`test/${c.stem}.js:${c.line}`], [c.want, c.got])),
  'ext-many-failures': c => {
    const n = 30 + c.serial % 10;
    const failing = Array.from({ length: n }, (_, i) => `FAIL src/batch_${c.serial}_${i}.test.ts\n  ● ${c.word} batch case ${i}\n    Expected: "${c.want}-${i}"\n    Received: "${c.got}-${i}"\n      at Object.<anonymous> (src/batch_${c.serial}_${i}.test.ts:${c.line}:9)`).join('\n');
    return out('jest', 'npx jest', `${chatter(c)}\n${failing}\nTest Suites: ${n} failed, 2 passed, ${n + 2} total\nTests:       ${n} failed, 9 passed, ${n + 9} total`,
      gold([`${c.word} batch case 0`], [`src/batch_${c.serial}_0.test.ts:${c.line}`], [`Tests:       ${n} failed`]));
  },
  'ext-gradle-passing': c => out('gradle', './gradlew test', `${chatter(c, 30)}
> Task :app:compileJava UP-TO-DATE
> Task :app:test

BUILD SUCCESSFUL in ${c.serial % 20 + 5}s
${c.serial % 9 + 3} actionable tasks: 2 executed, ${c.serial % 9 + 1} up-to-date`, gold([], [], ['BUILD SUCCESSFUL']), 0),
  'ext-go-passing': c => out('go', 'go test ./...', `${chatter(c, 30)}
ok  	example.com/${c.word}/api	0.${c.serial % 90 + 10}s
ok  	example.com/${c.word}/store	0.0${c.serial % 9 + 1}1s
?   	example.com/${c.word}/cmd	[no test files]`, gold([], [], [`ok  	example.com/${c.word}/api`]), 0),
};

const tasks = Object.entries(FAMILIES).flatMap(([family, render], ordinal) =>
  Array.from({ length: PER_FAMILY }, (_, variant) => ({ id: `extended-test-${family}-${variant + 1}`, family, ...render(context(ordinal, variant)) })));

// Gold must be literally present, logs unique, and failing logs long enough to need a digest.
const outputs = new Set();
for (const t of tasks) {
  assert(!outputs.has(t.rawOutput), `Duplicate log ${t.id}`); outputs.add(t.rawOutput);
  const facts = [...t.gold.expectedTests, ...t.gold.expectedFiles, ...t.gold.expectedAssertions];
  assert(facts.length && facts.length <= 12, `Gold size ${t.id}`);
  for (const fact of facts) assert(t.rawOutput.includes(fact), `Gold missing from log ${t.id}: ${fact}`);
  for (const bad of t.gold.forbiddenStrings) assert(t.rawOutput.includes(bad) && !facts.some(f => f.includes(bad)), `Forbidden string ${t.id}: ${bad}`);
  assert(t.rawOutput.length > 800, `Log too short to need a digest: ${t.id}`);
}
const directory = path.join(HERE, 'quality/extended');
const content = JSON.stringify(tasks, null, 2) + '\n';
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'test.json'), content);
writeFileSync(path.join(directory, 'test-manifest.json'), JSON.stringify({ tasks: tasks.length, dataSha256: sha(content), split: 'extended',
  families: Object.fromEntries(Object.keys(FAMILIES).map(family => [family, PER_FAMILY])),
  scope: 'Development only. Failure layouts authored from framework conventions; serials 520000+. Not a holdout.',
  trainingInputsUsed: false, sealedInputsUsed: false, holdoutInputsUsed: false }, null, 2) + '\n');
console.log(JSON.stringify({ head: 'test', split: 'extended', tasks: tasks.length, families: Object.keys(FAMILIES).length, sha256: sha(content) }));
