// Second Test development set (dev2): layouts from tools and formats the original and extended
// development sets do not cover, written from what each tool prints. Development only. Its author
// did not read either Test holdout or its builder, and no model or sealed input is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const PER_FAMILY = 20;
const WORDS = ['quokka', 'fjord', 'tundra', 'zephyr', 'obsidian', 'marigold', 'cobalt', 'juniper', 'sorrel', 'basalt', 'heron', 'tamarind'];
// Families that render their own CI wrapper skip the generic timestamp prefix.
const OWN_WRAPPER = new Set(['dev2-gitlab-rspec', 'dev2-jenkins-gradle', 'dev2-gha-cargo']);
const gold = (tests = [], files = [], assertions = [], forbidden = []) => ({
  expectedTests: tests, expectedFiles: files, expectedAssertions: assertions, forbiddenStrings: forbidden,
});

function context(ordinal, variant) {
  const serial = 700000 + ordinal * 100 + variant;
  const word = WORDS[(ordinal * 5 + variant) % WORDS.length];
  const Word = word[0].toUpperCase() + word.slice(1);
  const stem = `${word}_${serial}`;
  const windows = variant % 3 === 1;
  const root = windows ? `D:\\a\\${stem}\\${stem}` : `/home/runner/work/${stem}`;
  const line = 14 + (ordinal * 13 + variant * 17) % 170;
  const n = 10 + serial % 83;
  return {
    serial, word, Word, WORD: word.toUpperCase(), stem, root, windows, variant,
    want: `${word}-${serial + 3}`, got: `${word}-${serial + 8}`,
    line, line2: line + 23 + variant % 11, line3: line + 41 + variant % 5, col: 5 + variant % 13,
    n, m: n + 1 + serial % 7, hex: (serial * 2654435761 % 0xffffff).toString(16).padStart(6, '0'),
    abs: rel => windows ? `${root}\\${rel.replaceAll('/', '\\')}` : `${root}/${rel}`,
    // Forward-slash absolute path, as Go, Kotlin and file:// URLs print it on Windows.
    fwd: rel => windows ? `D:/a/${stem}/${stem}/${rel}` : `/home/runner/work/${stem}/${rel}`,
    rel: rel => windows ? rel.replaceAll('/', '\\') : rel,
    pylib: windows ? 'C:\\hostedtoolcache\\windows\\Python\\3.12.7\\x64\\Lib' : '/usr/lib/python3.12',
    site: rel => windows ? `${root}\\.venv\\Lib\\site-packages\\${rel.replaceAll('/', '\\')}` : `${root}/.venv/lib/python3.12/site-packages/${rel}`,
    goroot: windows ? 'C:/hostedtoolcache/windows/go/1.23.2/x64/src' : '/opt/hostedtoolcache/go/1.23.2/x64/src',
  };
}
const sep = c => c.windows ? '\\' : '/';
// Neutral runner chatter: no failure words, no dashes or plus signs, no source locations.
function chatter(c, count = 14) {
  return Array.from({ length: count + c.serial % 6 }, (_, i) =>
    `› ${c.stem} worker${i % 4} warmed ${(c.serial * 7 + i * 131) % 9000} cache entries in ${(i * 37 + c.serial) % 400}ms (digest ${((c.serial + i) * 40503 % 0xfffff).toString(16)})`).join('\n');
}
const out = (framework, command, rawOutput, g, exitCode = 1) => ({ framework, command, exitCode, rawOutput: rawOutput.trimEnd(), gold: g });

const FAMILIES = {
  // ---- JavaScript and TypeScript runners ----
  'dev2-mocha-spec': c => out('mocha', 'npx mocha', `${chatter(c)}

  ${c.Word}Ledger
    ✔ opens an empty ledger
    ✔ posts a debit (41ms)
    1) posts a ${c.word} credit ${c.serial}
  ${c.Word}Ledger reconciliation
    ✔ balances across months


  3 passing (88ms)
  1 failing

  1) ${c.Word}Ledger
       posts a ${c.word} credit ${c.serial}:

      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

'${c.got}' !== '${c.want}'

      + expected - actual

      -${c.got}
      +${c.want}

      at Context.<anonymous> (${c.abs(`test/${c.stem}.spec.js`)}:${c.line}:14)
      at process.processImmediate (node:internal/timers:483:21)`,
  gold([`posts a ${c.word} credit ${c.serial}`], [`${c.stem}.spec.js:${c.line}`], [`'${c.got}' !== '${c.want}'`], ['node:internal/timers:483:21'])),

  'dev2-karma-jasmine': c => {
    const browser = 'Chrome Headless 129.0.6668.58 (Linux x86_64)';
    return out('karma', 'npx ng test --watch=false', `16 10 2026 09:12:01.233:INFO [karma-server]: Karma v6.4.4 server started at http://localhost:9876/
16 10 2026 09:12:01.235:INFO [launcher]: Launching browsers ChromeHeadless with concurrency unlimited
16 10 2026 09:12:01.240:INFO [launcher]: Starting browser ChromeHeadless
${chatter(c)}
16 10 2026 09:12:03.012:INFO [${browser}]: Connected on socket 3xQ${c.serial} with id ${c.serial % 9000}
${browser} ${c.Word}Service should compute the ${c.word} total FAILED
	Expected ${c.m} to equal ${c.n}.
	    at <Jasmine>
	    at UserContext.apply (src/app/${c.word}/${c.word}.service.spec.ts:${c.line}:${c.col})
	    at _ZoneDelegate.invoke (node_modules/zone.js/fesm2015/zone.js:369:28)
	    at ProxyZoneSpec.onInvoke (node_modules/zone.js/fesm2015/zone-testing.js:2081:39)
${browser}: Executed 41 of 41 (1 FAILED) (0.512 secs / 0.37 secs)
TOTAL: 1 FAILED, 40 SUCCESS`, gold([`${c.Word}Service should compute the ${c.word} total`], [`${c.word}.service.spec.ts:${c.line}`], [`Expected ${c.m} to equal ${c.n}.`], ['zone.js/fesm2015/zone.js:369:28']));
  },

  'dev2-cypress-run': c => {
    const bar = '─'.repeat(96);
    return out('cypress', 'npx cypress run', `${chatter(c)}
====================================================================================================

  Running:  ${c.word}/checkout.cy.ts                                                          (2 of 5)


  ${c.Word} checkout
    ✓ loads the cart (812ms)
    1) shows the ${c.word} total ${c.serial}


  1 passing (6s)
  1 failing

  1) ${c.Word} checkout
       shows the ${c.word} total ${c.serial}:
     AssertionError: Timed out retrying after 4000ms: expected '<span#total>' to have text '${c.want}', but the text was '${c.got}'
      at Context.eval (webpack://${c.word}-web/./cypress/e2e/${c.word}/checkout.cy.ts:${c.line}:${c.col})




  (Results)

  ┌${bar}┐
  │ Tests:        2                                                                                │
  │ Passing:      1                                                                                │
  │ Failing:      1                                                                                │
  │ Screenshots:  1                                                                                │
  │ Video:        false                                                                            │
  │ Duration:     6 seconds                                                                        │
  │ Spec Ran:     ${c.word}/checkout.cy.ts                                                         │
  └${bar}┘


  (Screenshots)

  -  /home/runner/work/${c.stem}/cypress/screenshots/${c.word}/checkout.cy.ts/${c.Word} checkout -- shows the ${c.word} total ${c.serial} (failed).png  (1280x720)

====================================================================================================

  (Run Finished)

       Spec                                              Tests  Passing  Failing  Pending  Skipped
  ┌${bar}┐
  │ ✖  ${c.word}/checkout.cy.ts                   00:06        2        1        1        -        - │
  └${bar}┘
    ✖  1 of 5 failed (20%)                      00:31       14       13        1        -        -`,
    gold([`shows the ${c.word} total ${c.serial}`], [`cypress/e2e/${c.word}/checkout.cy.ts:${c.line}`], [`expected '<span#total>' to have text '${c.want}', but the text was '${c.got}'`]));
  },

  'dev2-jest-suite-failed-to-run': c => out('jest', 'npx jest', `${chatter(c)}
PASS src/${c.word}/format.test.ts
PASS src/${c.word}/parse.test.ts
FAIL src/${c.word}/${c.stem}.test.ts
  ● Test suite failed to run

    src/${c.word}/${c.stem}.test.ts:${c.line}:${c.col} - error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.

    ${c.line}     expect(price${c.Word}("${c.serial}")).toBe(${c.serial});
                          ~~~~~~~~~

Test Suites: 1 failed, 14 passed, 15 total
Tests:       52 passed, 52 total
Snapshots:   0 total
Time:        4.113 s
Ran all test suites.`, gold([], [`src/${c.word}/${c.stem}.test.ts:${c.line}:${c.col}`], ['TS2345', `Argument of type 'string' is not assignable to parameter of type 'number'`])),

  'dev2-jest-timeout': c => out('jest', 'npx jest', `${chatter(c)}
 FAIL  src/${c.stem}.test.ts (6.21 s)
  ${c.word} sync
    ✓ connects (12 ms)
    ✕ flushes pending ${c.word} writes (5003 ms)

  ● ${c.word} sync › flushes pending ${c.word} writes

    thrown: "Exceeded timeout of 5000 ms for a test.
    Add a timeout value to this test to increase the timeout, if this is a long-running test. See https://jestjs.io/docs/api#testname-fn-timeout."

      ${c.line - 2} |
      ${c.line - 1} | describe('${c.word} sync', () => {
    > ${c.line} |   it('flushes pending ${c.word} writes', async () => {
         |   ^
      ${c.line + 1} |     await client.flush();
      ${c.line + 2} |     expect(client.pending).toBe(0);

      at it (src/${c.stem}.test.ts:${c.line}:3)
      at Object.describe (src/${c.stem}.test.ts:${c.line - 1}:1)

Test Suites: 1 failed, 6 passed, 7 total
Tests:       1 failed, 30 passed, 31 total`, gold([`${c.word} sync › flushes pending ${c.word} writes`], [`src/${c.stem}.test.ts:${c.line}:3`], ['Exceeded timeout of 5000 ms for a test'])),

  'dev2-webpack-ts-loader': c => out('webpack', 'npx webpack --mode production', `${chatter(c)}
asset main.${c.hex}.js 1.21 MiB [emitted] [immutable] (name: main)
orphan modules 412 KiB [orphan] 88 modules
runtime modules 2.47 KiB 5 modules
cacheable modules 1.1 MiB
  modules by path ./src/ 94 KiB 31 modules
  modules by path ./node_modules/ 1.01 MiB 64 modules

ERROR in ./src/${c.word}/cart.ts ${c.line2}:0-41
Module not found: Error: Can't resolve './${c.word}-pricing' in '${c.abs(`src/${c.word}`)}'
resolve './${c.word}-pricing' in '${c.abs(`src/${c.word}`)}'
  using description file: ${c.abs('package.json')} (relative path: ./src/${c.word})
    Field 'browser' doesn't contain a valid alias configuration
    using description file: ${c.abs('package.json')} (relative path: ./src/${c.word}/${c.word}-pricing)
      no extension
 @ ./src/index.ts 3:0-35 9:2-12

ERROR in ${c.abs(`src/${c.word}/checkout.ts`)}
./src/${c.word}/checkout.ts ${c.line}:${c.col}-${c.col + 9}
[tsl] ERROR in ${c.abs(`src/${c.word}/checkout.ts`)}(${c.line},${c.col})
      TS2304: Cannot find name '${c.word}Total'.
 @ ./src/index.ts 4:0-40

webpack 5.95.0 compiled with 2 errors in 2381 ms`, gold([], [`./src/${c.word}/cart.ts ${c.line2}:0-41`, `checkout.ts(${c.line},${c.col})`], [`Can't resolve './${c.word}-pricing'`, `TS2304: Cannot find name '${c.word}Total'`])),

  'dev2-esbuild': c => out('esbuild', 'node build.mjs', `${chatter(c)}
✘ [ERROR] Could not resolve "@${c.word}/charts"

    src/pages/${c.Word}Report.tsx:${c.line}:${c.col}:
      ${c.line} │ import { Bar } from "@${c.word}/charts";
         ╵                     ~~~~~~~~~~~~~~~~~

  You can mark the path "@${c.word}/charts" as external to exclude it from the bundle, which will remove this error and leave the unresolved path in the bundle.

✘ [ERROR] No matching export in "src/${c.word}/format.ts" for import "format${c.Word}"

    src/pages/${c.Word}Report.tsx:${c.line + 2}:9:
      ${c.line + 2} │ import { format${c.Word} } from "../${c.word}/format";
         ╵          ~~~~~~~~~~~~~~

2 errors`, gold([], [`src/pages/${c.Word}Report.tsx:${c.line}:${c.col}`, `src/pages/${c.Word}Report.tsx:${c.line + 2}:9`], [`Could not resolve "@${c.word}/charts"`, `No matching export in "src/${c.word}/format.ts" for import "format${c.Word}"`])),

  'dev2-svelte-check': c => out('svelte-check', 'npx svelte-check', `${chatter(c)}
====================================
Loading svelte-check in workspace: ${c.abs('')}
Getting Svelte diagnostics...

${c.abs(`src/routes/${c.word}/+page.svelte`)}:${c.line}:${c.col}
Error: Type 'string' is not assignable to type 'number'. (ts)
    <${c.Word}Total amount={label} />

${c.abs(`src/lib/${c.Word}Card.svelte`)}:${c.line2}:3
Warn: A11y: <img> element should have an alt attribute
https://svelte.dev/docs/accessibility-warnings#a11y-missing-attribute (svelte)
    <img src={logo} />

====================================
svelte-check found 1 error and 1 warning in 2 files`, gold([], [`+page.svelte:${c.line}:${c.col}`], [`Type 'string' is not assignable to type 'number'`])),

  'dev2-vue-tsc': c => out('vue-tsc', 'npx vue-tsc --noEmit', `${chatter(c)}
src/components/${c.Word}Cart.vue:${c.line}:${c.col} - error TS2339: Property '${c.word}Total' does not exist on type 'CreateComponentPublicInstanceWithMixins<ToResolvedProps<{}, {}>, {}, {}, {}, {}>'.

${c.line}   <p class="total">{{ ${c.word}Total }}</p>
                         ~~~~~~~~~~~

src/stores/${c.word}.ts:${c.line2}:7 - error TS2322: Type 'null' is not assignable to type '${c.Word}Line[]'.

${c.line2}       lines: null,
          ~~~~~


Found 2 errors in 2 files.

Errors  Files
     1  src/components/${c.Word}Cart.vue:${c.line}
     1  src/stores/${c.word}.ts:${c.line2}`, gold([], [`src/components/${c.Word}Cart.vue:${c.line}:${c.col}`, `src/stores/${c.word}.ts:${c.line2}:7`], ['TS2339', `Property '${c.word}Total' does not exist`, 'TS2322'])),

  'dev2-biome': c => {
    const rule = '━'.repeat(40);
    return out('biome', 'npx biome check .', `${chatter(c)}
src/${c.word}/ledger.ts:${c.line}:${c.col} lint/correctness/noUnusedVariables  FIXABLE  ${rule}

  ✖ This variable ${c.word}Draft${c.serial} is unused.

    ${c.line - 1} │ export function post(entry: Entry) {
  > ${c.line} │   const ${c.word}Draft${c.serial} = clone(entry);
       │         ^^^^^^^^^^^^^^^^^
    ${c.line + 1} │   return commit(entry);
    ${c.line + 2} │ }

  ℹ Unused variables are often the result of an incomplete refactoring, typos, or other sources of bugs.

  ℹ Unsafe fix: If this is intentional, prepend ${c.word}Draft${c.serial} with an underscore.


src/${c.word}/format.ts format ${rule}

  ✖ Formatter would have printed the following content:

    ${c.line2} ${c.line2} │ export const label = (v: number) =>
    ${c.line2 + 1}    │ - → \`\${v}\`
       ${c.line2 + 1} │ + → \`\${v}\`;

check ${rule}

  ✖ Some errors were emitted while running checks.


Checked 84 files in 41ms. No fixes applied.
Found 2 errors.`, gold([], [`src/${c.word}/ledger.ts:${c.line}:${c.col}`, `src/${c.word}/format.ts format`], ['lint/correctness/noUnusedVariables', `This variable ${c.word}Draft${c.serial} is unused`]));
  },

  'dev2-pnpm-recursive': c => {
    const ui = `packages/${c.word}-ui test:`, core = `packages/${c.word}-core test:`;
    return out('vitest', 'pnpm -r test', `${chatter(c)}
Scope: 4 of 5 workspace projects
packages/${c.word}-core test$ vitest run
packages/${c.word}-ui test$ vitest run
${core}  RUN  v2.1.3 ${c.fwd(`packages/${c.word}-core`)}
${ui}  RUN  v2.1.3 ${c.fwd(`packages/${c.word}-ui`)}
${core}  ✓ src/money.test.ts (12 tests) 6ms
${ui}  ❯ src/Badge.test.tsx (3 tests | 1 failed) 22ms
${ui}    × Badge > shows ${c.word} count ${c.serial} 9ms
${ui}      → expected '${c.got}' to be '${c.want}' // Object.is equality
${core}  Test Files  1 passed (1)
${core}       Tests  12 passed (12)
${ui} ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
${ui}  FAIL  src/Badge.test.tsx > Badge > shows ${c.word} count ${c.serial}
${ui} AssertionError: expected '${c.got}' to be '${c.want}' // Object.is equality
${ui} - Expected
${ui} + Received
${ui} - ${c.want}
${ui} + ${c.got}
${ui}  ❯ src/Badge.test.tsx:${c.line}:${c.col}
${ui} ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
${ui}  Test Files  1 failed (1)
${ui}       Tests  1 failed | 2 passed (3)
${ui} Failed
${c.fwd(`packages/${c.word}-ui`)}:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @${c.word}/ui@0.4.0 test: \`vitest run\`
Exit status 1`, gold([`Badge > shows ${c.word} count ${c.serial}`], [`src/Badge.test.tsx:${c.line}:${c.col}`], [`expected '${c.got}' to be '${c.want}'`]));
  },

  'dev2-npm-eresolve': c => out('npm', 'npm ci', `${chatter(c)}
npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error
npm error While resolving: ${c.word}-web@2.3.${c.serial % 10}
npm error Found: react@18.3.1
npm error node_modules/react
npm error   react@"^18.3.1" from the root project
npm error
npm error Could not resolve dependency:
npm error peer react@"^19.0.0" from @${c.word}/widgets@${c.n}.0.0
npm error node_modules/@${c.word}/widgets
npm error   @${c.word}/widgets@"^${c.n}.0.0" from the root project
npm error
npm error Fix the upstream dependency conflict, or retry
npm error this command with --force or --legacy-peer-deps
npm error to accept an incorrect (and potentially broken) dependency resolution.
npm error
npm error
npm error For a full report see:
npm error /home/runner/.npm/_logs/2026-10-16T09_12_00_${c.serial % 1000}Z-eresolve-report.txt
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-16T09_12_00_${c.serial % 1000}Z-debug-0.log`,
  gold([], [], ['ERESOLVE unable to resolve dependency tree', `While resolving: ${c.word}-web@2.3.${c.serial % 10}`, `peer react@"^19.0.0" from @${c.word}/widgets@${c.n}.0.0`])),

  // ---- Python ----
  'dev2-pytest-xdist-short': c => out('pytest', 'pytest -n 4 --tb=short', `============================= test session starts ==============================
platform linux -- Python 3.12.7, pytest-8.3.3, pluggy-1.5.0
rootdir: ${c.abs('')}
configfile: pyproject.toml
plugins: xdist-3.6.1, cov-5.0.0
created: 4/4 workers
4 workers [62 items]
${chatter(c)}
........................F.....................................          [100%]
=================================== FAILURES ===================================
____________________ test_${c.word}_window_rolls_over ______________________
[gw2] linux -- Python 3.12.7 ${c.abs('.venv/bin/python')}
tests/test_${c.stem}.py:${c.line}: in test_${c.word}_window_rolls_over
    assert window.close(${c.serial}) == "${c.want}"
src/${c.word}/window.py:${c.line2}: in close
    return self._label(ts)
E   AssertionError: assert '${c.got}' == '${c.want}'
E
E     - ${c.want}
E     + ${c.got}
=========================== short test summary info ============================
FAILED tests/test_${c.stem}.py::test_${c.word}_window_rolls_over - AssertionError: assert '${c.got}' == '${c.want}'
1 failed, 61 passed in 3.40s`, gold([`test_${c.word}_window_rolls_over`], [`tests/test_${c.stem}.py:${c.line}`, `src/${c.word}/window.py:${c.line2}`], [`assert '${c.got}' == '${c.want}'`])),

  'dev2-pytest-native-tb': c => out('pytest', 'pytest --tb=native', `${chatter(c)}
collected 24 items

tests/test_${c.stem}.py ......F.................                          [100%]

=================================== FAILURES ===================================
_________________________ test_${c.word}_settles_batch __________________________
Traceback (most recent call last):
  File "${c.abs(`tests/test_${c.stem}.py`)}", line ${c.line}, in test_${c.word}_settles_batch
    assert settle(batch) == ${c.n}
           ^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: assert ${c.m} == ${c.n}
 +  where ${c.m} = settle([Entry(id=${c.serial}), Entry(id=${c.serial + 1})])
------------------------------ Captured log call -------------------------------
INFO     ${c.word}.settle:settle.py:${c.line2} settling 14 entries
=========================== short test summary info ============================
FAILED tests/test_${c.stem}.py::test_${c.word}_settles_batch - AssertionError: assert ${c.m} == ${c.n}
========================= 1 failed, 23 passed in 0.31s =========================`,
  gold([`test_${c.word}_settles_batch`], [`test_${c.stem}.py", line ${c.line}`], [`assert ${c.m} == ${c.n}`])),

  'dev2-pytest-timeout-dump': c => out('pytest', 'pytest --timeout=10 --timeout-method=thread', `${chatter(c)}
collected 23 items

tests/test_${c.stem}.py::test_${c.word}_opens PASSED                     [  4%]
tests/test_${c.stem}.py::test_${c.word}_drains_queue
+++++++++++++++++++++++++++++++++++ Timeout ++++++++++++++++++++++++++++++++++++
~~~~~~~~~~~~~~~~~~~~ Stack of ${c.word}-worker-1 (1401${c.serial}) ~~~~~~~~~~~~~~~~~~~~
  File "${c.pylib}${sep(c)}threading.py", line 1032, in _bootstrap
    self._bootstrap_inner()
  File "${c.pylib}${sep(c)}threading.py", line 1075, in _bootstrap_inner
    self.run()
  File "${c.abs(`src/${c.word}/worker.py`)}", line ${c.line3}, in run
    item = self._queue.get()
~~~~~~~~~~~~~~~~~~~~~~~ Stack of MainThread (1400${c.serial}) ~~~~~~~~~~~~~~~~~~~~~~~
  File "${c.site('_pytest/python.py')}", line 159, in pytest_pyfunc_call
    result = testfunction(**testargs)
  File "${c.abs(`tests/test_${c.stem}.py`)}", line ${c.line}, in test_${c.word}_drains_queue
    worker.join()
  File "${c.abs(`src/${c.word}/worker.py`)}", line ${c.line2}, in join
    self._done.wait()
  File "${c.pylib}${sep(c)}threading.py", line 655, in wait
    signaled = self._cond.wait(timeout)
  File "${c.pylib}${sep(c)}threading.py", line 355, in wait
    waiter.acquire()
+++++++++++++++++++++++++++++++++++ Timeout ++++++++++++++++++++++++++++++++++++`,
  gold([`test_${c.word}_drains_queue`], [`test_${c.stem}.py", line ${c.line}`, `worker.py", line ${c.line2}`], ['Timeout'], ['threading.py", line 355', 'threading.py", line 1075'])),

  'dev2-hypothesis': c => out('pytest', 'pytest -x', `${chatter(c)}
F
=================================== FAILURES ===================================
__________________________ test_${c.word}_roundtrip ___________________________

    @given(st.text())
>   def test_${c.word}_roundtrip(s):

tests/test_${c.stem}.py:${c.line - 1}:
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _

s = '${c.word}\\x8${c.serial % 10}'

    @given(st.text())
    def test_${c.word}_roundtrip(s):
>       assert decode_${c.word}(encode_${c.word}(s)) == s
E       AssertionError: assert '${c.word}' == '${c.word}\\x8${c.serial % 10}'

tests/test_${c.stem}.py:${c.line}: AssertionError
---------------------------------- Hypothesis ----------------------------------
Falsifying example: test_${c.word}_roundtrip(
    s='${c.word}\\x8${c.serial % 10}',
)
=========================== short test summary info ============================
FAILED tests/test_${c.stem}.py::test_${c.word}_roundtrip - AssertionError: assert '${c.word}' == '${c.word}\\x8${c.serial % 10}'
!!!!!!!!!!!!!!!!!!!!!!!!!! stopping after 1 failures !!!!!!!!!!!!!!!!!!!!!!!!!!!
1 failed, 8 passed in 1.92s`, gold([`test_${c.word}_roundtrip`], [`tests/test_${c.stem}.py:${c.line}`], [`Falsifying example: test_${c.word}_roundtrip(`, `s='${c.word}\\x8${c.serial % 10}',`])),

  'dev2-django-test': c => out('django', 'python manage.py test', `${chatter(c)}
Found 48 test(s).
Creating test database for alias 'default'...
System check identified no issues (0 silenced).
.......F........E...............................
======================================================================
ERROR: test_${c.word}_export (shop.tests.test_${c.stem}.ExportTests.test_${c.word}_export)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "${c.site('django/test/utils.py')}", line 446, in inner
    return func(*args, **kwargs)
  File "${c.abs(`shop/tests/test_${c.stem}.py`)}", line ${c.line}, in test_${c.word}_export
    response = self.client.get(reverse("${c.word}-export"))
  File "${c.site('django/urls/base.py')}", line 88, in reverse
    return resolver._reverse_with_prefix(view, prefix, *args, **kwargs)
  File "${c.site('django/urls/resolvers.py')}", line 831, in _reverse_with_prefix
    raise NoReverseMatch(msg)
django.urls.exceptions.NoReverseMatch: Reverse for '${c.word}-export' not found. '${c.word}-export' is not a valid view function or pattern name.

======================================================================
FAIL: test_${c.word}_totals (shop.tests.test_${c.stem}.TotalsTests.test_${c.word}_totals)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "${c.abs(`shop/tests/test_${c.stem}.py`)}", line ${c.line3}, in test_${c.word}_totals
    self.assertEqual(order.total, Decimal("${c.n}.00"))
AssertionError: Decimal('${c.m}.00') != Decimal('${c.n}.00')

----------------------------------------------------------------------
Ran 48 tests in 2.114s

FAILED (failures=1, errors=1)
Destroying test database for alias 'default'...`,
  gold([`test_${c.word}_export`, `test_${c.word}_totals`], [`test_${c.stem}.py", line ${c.line}`, `test_${c.stem}.py", line ${c.line3}`], [`Reverse for '${c.word}-export' not found`, `Decimal('${c.m}.00') != Decimal('${c.n}.00')`], ['resolvers.py", line 831'])),

  'dev2-ruff': c => out('ruff', 'ruff check .', `${chatter(c)}
F841 [*] Local variable \`${c.word}_total\` is assigned to but never used
  --> ${c.rel(`src/${c.word}/ledger.py`)}:${c.line}:5
   |
${c.line - 1} | def settle(rows):
${c.line} |     ${c.word}_total = sum(r.amount for r in rows)
   |     ^^^^^^^^^^^^^
${c.line + 1} |     return rows
   |
help: Remove assignment to unused variable \`${c.word}_total\`

E711 Comparison to \`None\` should be \`cond is None\`
  --> ${c.rel(`src/${c.word}/api.py`)}:${c.line2}:17
   |
${c.line2} |     if payload == None:
   |                  ^^^^
   |
help: Replace with \`cond is None\`

Found 2 errors.
[*] 1 fixable with the \`--fix\` option (1 hidden fix can be enabled with the \`--unsafe-fixes\` option).`,
  gold([], [`${c.rel(`src/${c.word}/ledger.py`)}:${c.line}:5`, `${c.rel(`src/${c.word}/api.py`)}:${c.line2}:17`], ['F841', `Local variable \`${c.word}_total\` is assigned to but never used`, 'E711'])),

  'dev2-pylint': c => out('pylint', `pylint ${c.word}`, `${chatter(c)}
************* Module ${c.word}.cart
${c.rel(`${c.word}/cart.py`)}:${c.line}:4: W0612: Unused variable 'subtotal_${c.serial}' (unused-variable)
${c.rel(`${c.word}/cart.py`)}:${c.line2}:0: C0116: Missing function or method docstring (missing-function-docstring)
${c.rel(`${c.word}/cart.py`)}:${c.line3}:11: E1120: No value for argument 'currency' in function call (no-value-for-parameter)
************* Module ${c.word}.api
${c.rel(`${c.word}/api.py`)}:1:0: C0114: Missing module docstring (missing-module-docstring)
${c.rel(`${c.word}/api.py`)}:${c.line + 3}:8: R1705: Unnecessary "else" after "return", remove the "else" and de-indent the code inside it (no-else-return)

-----------------------------------
Your code has been rated at 6.84/10`,
  gold([], [`${c.rel(`${c.word}/cart.py`)}:${c.line3}:11`, `${c.rel(`${c.word}/cart.py`)}:${c.line}:4`], ['E1120', `No value for argument 'currency'`, `subtotal_${c.serial}`])),

  'dev2-pyright': c => out('pyright', 'pyright', `${chatter(c)}
${c.abs(`src/${c.word}/models.py`)}
  ${c.abs(`src/${c.word}/models.py`)}:${c.line}:${c.col} - error: Cannot access attribute "${c.word}_rate" for class "Invoice"
    Attribute "${c.word}_rate" is unknown (reportAttributeAccessIssue)
  ${c.abs(`src/${c.word}/models.py`)}:${c.line + 7}:12 - warning: Import "yaml" could not be resolved from source (reportMissingModuleSource)
${c.abs(`src/${c.word}/views.py`)}
  ${c.abs(`src/${c.word}/views.py`)}:${c.line2}:5 - error: Argument of type "str | None" cannot be assigned to parameter "key" of type "str" in function "lookup"
    Type "str | None" is not assignable to type "str"
      "None" is not assignable to "str" (reportArgumentType)
2 errors, 1 warning, 0 informations`,
  gold([], [`models.py:${c.line}:${c.col}`, `views.py:${c.line2}:5`], [`Cannot access attribute "${c.word}_rate" for class "Invoice"`, `cannot be assigned to parameter "key"`])),

  'dev2-python-segfault': c => out('pytest', 'pytest tests/test_native.py', `${chatter(c)}
collected 9 items

tests/test_${c.stem}.py::test_${c.word}_decode_native Fatal Python error: Segmentation fault

Thread 0x00007f3a${c.hex} (most recent call first):
  File "${c.pylib}${sep(c)}threading.py", line 355 in wait
  File "${c.pylib}${sep(c)}concurrent${sep(c)}futures${sep(c)}thread.py", line 89 in _worker
  File "${c.pylib}${sep(c)}threading.py", line 1012 in run

Current thread 0x00007f3b${c.hex} (most recent call first):
  File "${c.abs(`src/${c.word}/native.py`)}", line ${c.line} in decode_frame
  File "${c.abs(`tests/test_${c.stem}.py`)}", line ${c.line2} in test_${c.word}_decode_native
  File "${c.site('_pytest/python.py')}", line 159 in pytest_pyfunc_call
  File "${c.site('pluggy/_callers.py')}", line 103 in _multicall
  File "${c.site('pluggy/_manager.py')}", line 120 in _hookexec

Extension modules: numpy._core._multiarray_umath, ${c.word}._native (total: 14)
Segmentation fault (core dumped)`,
  gold([`test_${c.word}_decode_native`], [`native.py", line ${c.line}`, `test_${c.stem}.py", line ${c.line2}`], ['Fatal Python error: Segmentation fault'], ['thread.py", line 89 in _worker']), 139),

  'dev2-interleaved-stderr': c => {
    const port = 8000 + c.serial % 900;
    return out('unittest', 'python -m unittest -v', `${chatter(c)}
test_${c.word}_parse (tests.test_client.ClientTests.test_${c.word}_parse) ... ok
test_${c.word}_fetch (tests.test_client.ClientTests.test_${c.word}_fetch) ... WARNING:urllib3.connectionpool:Retrying (Retry(total=2, connect=None, read=None, redirect=None, status=None)) after connection broken by 'NewConnectionError("HTTPConnection(host='localhost', port=${port}): Failed to establish a new connection: [Errno 111] Connection refused")': /v1/${c.word}
WARNING:urllib3.connectionpool:Retrying (Retry(total=1, connect=None, read=None, redirect=None, status=None)) after connection broken by 'NewConnectionError("HTTPConnection(host='localhost', port=${port}): Failed to establish a new connection: [Errno 111] Connection refused")': /v1/${c.word}
ERROR
test_${c.word}_retry (tests.test_client.ClientTests.test_${c.word}_retry) ... ok

======================================================================
ERROR: test_${c.word}_fetch (tests.test_client.ClientTests.test_${c.word}_fetch)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "${c.site('urllib3/connection.py')}", line 199, in _new_conn
    sock = connection.create_connection(
ConnectionRefusedError: [Errno 111] Connection refused

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "${c.abs('tests/test_client.py')}", line ${c.line}, in test_${c.word}_fetch
    body = client.fetch("${c.word}", ${c.serial})
  File "${c.abs(`src/${c.word}/transport.py`)}", line ${c.line2}, in fetch
    resp = self.session.get(url, timeout=2)
  File "${c.site('requests/sessions.py')}", line 602, in get
    return self.request("GET", url, **kwargs)
  File "${c.site('requests/adapters.py')}", line 700, in send
    raise ConnectionError(e, request=request)
requests.exceptions.ConnectionError: HTTPConnectionPool(host='localhost', port=${port}): Max retries exceeded with url: /v1/${c.word} (Caused by NewConnectionError("HTTPConnection(host='localhost', port=${port}): Failed to establish a new connection: [Errno 111] Connection refused"))
DEBUG:${c.word}.transport:closing session ${c.serial}

----------------------------------------------------------------------
Ran 14 tests in 3.021s

FAILED (errors=1)`, gold([`test_${c.word}_fetch`], [`test_client.py", line ${c.line}`, `transport.py", line ${c.line2}`], [`Max retries exceeded with url: /v1/${c.word}`], ['sessions.py", line 602', 'adapters.py", line 700']));
  },

  'dev2-tox': c => out('tox', 'tox', `${chatter(c)}
py311: install_deps> python -I -m pip install pytest pytest-cov
py311: commands[0]> pytest -q
....................                                                     [100%]
20 passed in 0.41s
py311: OK ✔ in 4.12 seconds
py312: install_deps> python -I -m pip install pytest pytest-cov
py312: commands[0]> pytest -q
.........F..........                                                     [100%]
=================================== FAILURES ===================================
_______________________ test_${c.word}_slug_${c.serial} ________________________

    def test_${c.word}_slug_${c.serial}():
>       assert slugify("${c.Word} Ünï ${c.serial}") == "${c.word}-uni-${c.serial}"
E       AssertionError: assert '${c.word}-n-${c.serial}' == '${c.word}-uni-${c.serial}'

tests/test_slug.py:${c.line}: AssertionError
=========================== short test summary info ============================
FAILED tests/test_slug.py::test_${c.word}_slug_${c.serial} - AssertionError: assert '${c.word}-n-${c.serial}' == '${c.word}-uni-${c.serial}'
1 failed, 19 passed in 0.39s
py312: exit 1 (0.71 seconds) ${c.abs('')}> pytest -q pid=${c.serial % 30000}
  py311: OK (4.12=setup[3.70]+cmd[0.42] seconds)
  py312: FAIL code 1 (3.98=setup[3.27]+cmd[0.71] seconds)
  evaluation failed :( (8.17 seconds)`,
  gold([`test_${c.word}_slug_${c.serial}`], [`tests/test_slug.py:${c.line}`], [`assert '${c.word}-n-${c.serial}' == '${c.word}-uni-${c.serial}'`])),

  // ---- Rust ----
  'dev2-cargo-backtrace': c => {
    const rustc = '/rustc/f6e511eec7342f59a25f7c0534f1dbea00d01b14/library';
    return out('cargo', 'RUST_BACKTRACE=1 cargo test', `${chatter(c)}
   Compiling ${c.word} v0.3.${c.serial % 10} (${c.abs('')})
    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 3.12s
     Running unittests src/lib.rs (target/debug/deps/${c.word}-${c.hex}${c.hex})

running 6 tests
test codec::tests::encodes_${c.word} ... ok
test codec::tests::decodes_${c.word}_frame ... FAILED
test codec::tests::rejects_short ... ok
test ledger::tests::opens ... ok
test ledger::tests::posts ... ok
test ledger::tests::closes ... ok

failures:

---- codec::tests::decodes_${c.word}_frame stdout ----

thread 'codec::tests::decodes_${c.word}_frame' panicked at src/codec.rs:${c.line}:9:
called \`Result::unwrap()\` on an \`Err\` value: InvalidHeader(${c.serial})
stack backtrace:
   0: rust_begin_unwind
             at ${rustc}/std/src/panicking.rs:665:5
   1: core::panicking::panic_fmt
             at ${rustc}/core/src/panicking.rs:74:14
   2: core::result::unwrap_failed
             at ${rustc}/core/src/result.rs:1700:5
   3: core::result::Result<T,E>::unwrap
             at ${rustc}/core/src/result.rs:1104:23
   4: ${c.word}::codec::tests::decodes_${c.word}_frame
             at ./src/codec.rs:${c.line}:9
   5: ${c.word}::codec::tests::decodes_${c.word}_frame::{{closure}}
             at ./src/codec.rs:${c.line - 6}:31
   6: core::ops::function::FnOnce::call_once
             at ${rustc}/core/src/ops/function.rs:250:5
note: Some details are omitted, run with \`RUST_BACKTRACE=full\` for a verbose backtrace.


failures:
    codec::tests::decodes_${c.word}_frame

test result: FAILED. 5 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

error: test failed, to rerun pass \`--lib\``, gold([`codec::tests::decodes_${c.word}_frame`], [`src/codec.rs:${c.line}:9`], [`InvalidHeader(${c.serial})`], ['std/src/panicking.rs:665:5', 'core/src/result.rs:1700:5']), 101);
  },

  'dev2-clippy': c => out('clippy', 'cargo clippy -- -D warnings', `${chatter(c)}
    Checking ${c.word} v0.3.${c.serial % 10} (${c.abs('')})
error: this \`if\` has identical blocks
  --> ${c.rel(`src/${c.word}/rules.rs`)}:${c.line}:${c.col}
   |
${c.line} |       if limit > ${c.n} {
   |  _____________________^
${c.line + 1} | |         apply(limit)
${c.line + 2} | |     } else {
   | |_____^
   |
note: same as this
  --> ${c.rel(`src/${c.word}/rules.rs`)}:${c.line + 2}:12
   |
${c.line + 2} |       } else {
   |  ____________^
${c.line + 3} | |         apply(limit)
${c.line + 4} | |     }
   | |_____^
   = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#if_same_then_else
   = note: \`#[deny(clippy::if_same_then_else)]\` on by default

warning: unused variable: \`${c.word}_cap\`
  --> ${c.rel('src/lib.rs')}:${c.line2}:9
   |
${c.line2} |     let ${c.word}_cap = 4;
   |         ^^^^^^^^^^ help: if this is intentional, prefix it with an underscore: \`_${c.word}_cap\`
   |
   = note: \`#[warn(unused_variables)]\` on by default

warning: \`${c.word}\` (lib) generated 1 warning
error: could not compile \`${c.word}\` (lib) due to 1 previous error; 1 warning emitted`,
  gold([], [`${c.rel(`src/${c.word}/rules.rs`)}:${c.line}:${c.col}`], ['this `if` has identical blocks', 'clippy::if_same_then_else']), 101),

  'dev2-gha-cargo': c => {
    let t = 0;
    const ts = () => `2026-10-16T09:${String(12 + Math.floor(t / 60) % 40).padStart(2, '0')}:${String(t++ % 60).padStart(2, '0')}.${String(c.serial * 13 + t).padStart(7, '0').slice(-7)}Z`;
    const body = `##[group]Run cargo test --workspace
cargo test --workspace
shell: /usr/bin/bash -e {0}
env:
  CARGO_TERM_COLOR: always
  RUSTFLAGS: -D warnings
##[endgroup]
${chatter(c)}
   Compiling ${c.word}-core v0.9.${c.serial % 10} (${c.abs(`crates/${c.word}-core`)})
    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 41.20s
     Running unittests src/lib.rs (target/debug/deps/${c.word}_core-${c.hex})

running 42 tests
test ledger::tests::rejects_${c.word}_overdraft ... FAILED

failures:

---- ledger::tests::rejects_${c.word}_overdraft stdout ----

thread 'ledger::tests::rejects_${c.word}_overdraft' panicked at crates/${c.word}-core/src/ledger.rs:${c.line}:5:
assertion failed: matches!(result, Err(LedgerError::Overdraft { .. }))
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace


failures:
    ledger::tests::rejects_${c.word}_overdraft

test result: FAILED. 41 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s

error: test failed, to rerun pass \`-p ${c.word}-core --lib\`
##[error]Process completed with exit code 101.`;
    return out('cargo', 'cargo test --workspace', body.split('\n').map(l => `${ts()} ${l}`).join('\n'),
      gold([`ledger::tests::rejects_${c.word}_overdraft`], [`crates/${c.word}-core/src/ledger.rs:${c.line}:5`], ['assertion failed: matches!(result, Err(LedgerError::Overdraft { .. }))']), 101);
  },

  // ---- Go ----
  'dev2-go-race': c => out('go', 'go test -race ./...', `${chatter(c)}
==================
WARNING: DATA RACE
Write at 0x00c0001a40d8 by goroutine 9:
  example.com/${c.word}/cache.(*Store).Put()
      ${c.fwd('cache/store.go')}:${c.line} +0x84
  example.com/${c.word}/cache.TestStoreConcurrent${c.Word}.func1()
      ${c.fwd('cache/store_test.go')}:${c.line2} +0x5c

Previous read at 0x00c0001a40d8 by goroutine 8:
  example.com/${c.word}/cache.(*Store).Get()
      ${c.fwd('cache/store.go')}:${c.line + 9} +0x6f
  example.com/${c.word}/cache.TestStoreConcurrent${c.Word}.func2()
      ${c.fwd('cache/store_test.go')}:${c.line2 + 6} +0x48

Goroutine 9 (running) created at:
  example.com/${c.word}/cache.TestStoreConcurrent${c.Word}()
      ${c.fwd('cache/store_test.go')}:${c.line2 - 3} +0x10b
  testing.tRunner()
      ${c.goroot}/testing/testing.go:1690 +0x226
  testing.(*T).Run.gowrap1()
      ${c.goroot}/testing/testing.go:1743 +0x44
==================
--- FAIL: TestStoreConcurrent${c.Word} (0.00s)
    testing.go:1399: race detected during execution of test
FAIL
FAIL	example.com/${c.word}/cache	0.031s
FAIL`, gold([`TestStoreConcurrent${c.Word}`], [`store.go:${c.line}`, `store_test.go:${c.line2}`], ['WARNING: DATA RACE', 'race detected during execution of test'], ['testing/testing.go:1690', 'testing/testing.go:1743'])),

  'dev2-go-build-failed': c => out('go', 'go test ./...', `${chatter(c)}
# example.com/${c.word}/api [example.com/${c.word}/api.test]
${c.rel('api/handler.go')}:${c.line}:${c.col}: undefined: decode${c.Word}${c.serial}
${c.rel('api/handler.go')}:${c.line + 6}:2: declared and not used: retries
${c.rel('api/handler_test.go')}:${c.line2}:14: too many arguments in call to newRouter
	have (string, int)
	want (string)
FAIL	example.com/${c.word}/api [build failed]
ok  	example.com/${c.word}/store	0.012s
?   	example.com/${c.word}/cmd/${c.word}d	[no test files]
FAIL`, gold([], [`${c.rel('api/handler.go')}:${c.line}:${c.col}`, `${c.rel('api/handler_test.go')}:${c.line2}:14`], [`undefined: decode${c.Word}${c.serial}`, 'declared and not used: retries', 'too many arguments in call to newRouter'])),

  'dev2-go-test-timeout': c => out('go', 'go test -timeout 30s ./...', `${chatter(c)}
panic: test timed out after 30s
	running tests:
		Test${c.Word}Drain (30s)

goroutine 41 [running]:
testing.(*M).startAlarm.func1()
	${c.goroot}/testing/testing.go:2373 +0x385
created by time.goFunc
	${c.goroot}/time/sleep.go:215 +0x2d

goroutine 1 [chan receive]:
testing.(*T).Run(0xc000003a00, {0x6b4e2a?, 0x0?}, 0x6d9c88)
	${c.goroot}/testing/testing.go:1751 +0x3ab
testing.runTests.func1(0xc000003a00)
	${c.goroot}/testing/testing.go:2168 +0x37

goroutine 22 [select]:
example.com/${c.word}/queue.(*Queue).Drain(0xc0000a4000, {0x7a1c40, 0xc0000b2000})
	${c.fwd('queue/queue.go')}:${c.line} +0x10f
example.com/${c.word}/queue.Test${c.Word}Drain(0xc000003ba0)
	${c.fwd('queue/queue_test.go')}:${c.line2} +0x8a
testing.tRunner(0xc000003ba0, 0x6d9c90)
	${c.goroot}/testing/testing.go:1690 +0xf4
created by testing.(*T).Run in goroutine 1
	${c.goroot}/testing/testing.go:1743 +0x390
FAIL	example.com/${c.word}/queue	30.017s
FAIL`, gold([`Test${c.Word}Drain`], [`queue.go:${c.line}`, `queue_test.go:${c.line2}`], ['panic: test timed out after 30s'], ['time/sleep.go:215', 'testing/testing.go:2373'])),

  'dev2-golangci-lint': c => out('golangci-lint', 'golangci-lint run', `${chatter(c)}
level=info msg="[runner] linters took 1.2${c.serial % 10}s with stages: goanalysis_metalinter: 1.1s"
${c.rel(`internal/${c.word}/store.go`)}:${c.line}:${c.col}: Error return value of \`f.Close\` is not checked (errcheck)
	defer f.Close()
	      ^
${c.rel(`internal/${c.word}/http.go`)}:${c.line2}:2: ineffectual assignment to err (ineffassign)
	err = json.Unmarshal(body, &req)
	^
${c.rel(`internal/${c.word}/http.go`)}:${c.line3}:6: func \`legacy${c.Word}Handler\` is unused (unused)
func legacy${c.Word}Handler(w http.ResponseWriter, r *http.Request) {
     ^
3 issues:
* errcheck: 1
* ineffassign: 1
* unused: 1`, gold([], [`${c.rel(`internal/${c.word}/store.go`)}:${c.line}:${c.col}`, `${c.rel(`internal/${c.word}/http.go`)}:${c.line2}:2`, `${c.rel(`internal/${c.word}/http.go`)}:${c.line3}:6`], ['Error return value of `f.Close` is not checked', 'ineffectual assignment to err', `func \`legacy${c.Word}Handler\` is unused`])),

  'dev2-go-many-subtests': c => {
    const k = 32 + c.serial % 9;
    const cases = Array.from({ length: k }, (_, i) => `    --- FAIL: TestParse${c.Word}/case_${String(i).padStart(2, '0')} (0.00s)
        parse_test.go:${c.line}: Parse("${c.word}-in-${i}") = "${c.got}-${i}", want "${c.want}-${i}"`).join('\n');
    return out('go', 'go test ./...', `${chatter(c)}
--- FAIL: TestParse${c.Word} (0.01s)
${cases}
FAIL
FAIL	example.com/${c.word}/parse	0.006s
FAIL`, gold([`TestParse${c.Word}/case_00`], [`parse_test.go:${c.line}`], [`Parse("${c.word}-in-0") = "${c.got}-0", want "${c.want}-0"`]));
  },

  // ---- JVM ----
  'dev2-maven-surefire': c => out('maven', 'mvn test', `${chatter(c)}
[INFO] -------------------------------------------------------
[INFO]  T E S T S
[INFO] -------------------------------------------------------
[INFO] Running com.example.${c.word}.${c.Word}PricingTest
[ERROR] Tests run: 7, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.081 s <<< FAILURE! -- in com.example.${c.word}.${c.Word}PricingTest
[ERROR] com.example.${c.word}.${c.Word}PricingTest.appliesBulk${c.Word}Discount -- Time elapsed: 0.012 s <<< FAILURE!
org.opentest4j.AssertionFailedError: expected: <${c.want}> but was: <${c.got}>
	at org.junit.jupiter.api.AssertionFailureBuilder.build(AssertionFailureBuilder.java:151)
	at org.junit.jupiter.api.AssertionFailureBuilder.buildAndThrow(AssertionFailureBuilder.java:132)
	at org.junit.jupiter.api.AssertEquals.failNotEqual(AssertEquals.java:197)
	at org.junit.jupiter.api.AssertEquals.assertEquals(AssertEquals.java:182)
	at org.junit.jupiter.api.Assertions.assertEquals(Assertions.java:1156)
	at com.example.${c.word}.${c.Word}PricingTest.appliesBulk${c.Word}Discount(${c.Word}PricingTest.java:${c.line})
	at java.base/java.lang.reflect.Method.invoke(Method.java:580)
	at java.base/java.util.ArrayList.forEach(ArrayList.java:1596)

[INFO] Running com.example.${c.word}.${c.Word}RepositoryTest
[INFO] Tests run: 12, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.214 s -- in com.example.${c.word}.${c.Word}RepositoryTest
[INFO]
[INFO] Results:
[INFO]
[ERROR] Failures:
[ERROR]   ${c.Word}PricingTest.appliesBulk${c.Word}Discount:${c.line} expected: <${c.want}> but was: <${c.got}>
[INFO]
[ERROR] Tests run: 19, Failures: 1, Errors: 0, Skipped: 0
[INFO]
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  6.412 s
[INFO] Finished at: 2026-10-16T09:14:22Z
[INFO] ------------------------------------------------------------------------
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.5.1:test (default-test) on project ${c.word}-core: There are test failures.
[ERROR]
[ERROR] Please refer to ${c.abs('target/surefire-reports')} for the individual test results.
[ERROR] Please refer to dump files (if any exist) [date].dump, [date]-jvmRun[N].dump and [date].dumpstream.
[ERROR] -> [Help 1]`, gold([`appliesBulk${c.Word}Discount`], [`${c.Word}PricingTest.java:${c.line}`], [`expected: <${c.want}> but was: <${c.got}>`])),

  'dev2-kotlin-compile': c => out('gradle', './gradlew build', `${chatter(c)}
> Task :app:checkKotlinGradlePluginConfigurationErrors
> Task :app:processResources UP-TO-DATE

> Task :app:compileKotlin FAILED
e: file://${c.windows ? '/' : ''}${c.fwd(`app/src/main/kotlin/com/example/${c.word}/${c.Word}Repository.kt`)}:${c.line}:${c.col} Unresolved reference 'find${c.Word}ById'.
e: file://${c.windows ? '/' : ''}${c.fwd(`app/src/main/kotlin/com/example/${c.word}/${c.Word}Service.kt`)}:${c.line2}:21 Argument type mismatch: actual type is 'String', but 'Long' was expected.
w: file://${c.windows ? '/' : ''}${c.fwd(`app/src/main/kotlin/com/example/${c.word}/Legacy.kt`)}:12:5 'fun legacy(): Unit' is deprecated. Use v2.

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:compileKotlin'.
> A failure occurred while executing org.jetbrains.kotlin.compilerRunner.GradleCompilerRunnerWithWorkers$GradleKotlinCompilerWorkAction
   > Compilation error. See log for more details

* Try:
> Run with --stacktrace option to get the stack trace.
> Run with --info or --debug option to get more log output.
> Run with --scan to get full insights.
> Get more help at https://help.gradle.org.

BUILD FAILED in 14s
4 actionable tasks: 1 executed, 3 up-to-date`, gold([], [`${c.Word}Repository.kt:${c.line}:${c.col}`, `${c.Word}Service.kt:${c.line2}:21`], [`Unresolved reference 'find${c.Word}ById'`, `actual type is 'String', but 'Long' was expected`])),

  'dev2-sbt-scalatest': c => out('sbt', 'sbt test', `[info] welcome to sbt 1.10.2 (Eclipse Adoptium Java 21.0.4)
[info] loading project definition from ${c.abs('project')}
${chatter(c).split('\n').map(l => `[info] ${l}`).join('\n')}
[info] compiling 3 Scala sources to ${c.abs('target/scala-3.5.1/test-classes')} ...
[info] ${c.Word}LedgerSpec:
[info] A ${c.Word}Ledger
[info] - should open empty
[info] - should post a ${c.word} entry ${c.serial} *** FAILED ***
[info]   "${c.got}" did not equal "${c.want}" (${c.Word}LedgerSpec.scala:${c.line})
[info] - should close the period
[info] Run completed in 912 milliseconds.
[info] Total number of tests run: 3
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 2, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
[error] Failed tests:
[error] 	com.example.${c.word}.${c.Word}LedgerSpec
[error] (Test / test) sbt.TestsFailedException: Tests unsuccessful
[error] Total time: 7 s, completed Oct 16, 2026, 9:12:44 AM`,
  gold([`should post a ${c.word} entry ${c.serial}`], [`${c.Word}LedgerSpec.scala:${c.line}`], [`"${c.got}" did not equal "${c.want}"`])),

  'dev2-jenkins-gradle': c => {
    const k = 3 + c.serial % 5;
    let t = 0;
    const ts = () => `[2026-10-16T09:${String(12 + Math.floor(t / 60) % 40).padStart(2, '0')}:${String(t++ % 60).padStart(2, '0')}.${String(c.serial % 1000).padStart(3, '0')}Z]`;
    const shell = `+ ./gradlew test --no-daemon
${chatter(c)}
> Task :service:compileKotlin UP-TO-DATE
> Task :service:test

${c.Word}ClientTest > retries${c.Word}OnTimeout() FAILED
    java.lang.IllegalStateException: retry budget exhausted after ${k} attempts
        at com.example.${c.word}.RetryPolicy.next(RetryPolicy.kt:${c.line})
        at com.example.${c.word}.${c.Word}Client.send(${c.Word}Client.kt:${c.line2})
        at com.example.${c.word}.${c.Word}ClientTest.retries${c.Word}OnTimeout(${c.Word}ClientTest.kt:${c.line3})

31 tests completed, 1 failed

> Task :service:test FAILED

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':service:test'.
> There were failing tests. See the report at: file:///var/jenkins/workspace/${c.word}-service/service/build/reports/tests/test/index.html

BUILD FAILED in 38s`;
    return out('gradle', './gradlew test', `Started by upstream project "${c.word}-pipeline" build number ${c.n}
originally caused by:
 Started by user ci-bot
[Pipeline] Start of Pipeline
[Pipeline] node
Running on agent-${c.n} in /var/jenkins/workspace/${c.word}-service
[Pipeline] {
[Pipeline] stage
[Pipeline] { (Test)
[Pipeline] sh
${shell.split('\n').map(l => `${ts()} ${l}`).join('\n')}
[Pipeline] }
[Pipeline] // stage
[Pipeline] }
[Pipeline] // node
[Pipeline] End of Pipeline
ERROR: script returned exit code 1
Finished: FAILURE`, gold([`retries${c.Word}OnTimeout`], [`RetryPolicy.kt:${c.line}`, `${c.Word}ClientTest.kt:${c.line3}`], [`retry budget exhausted after ${k} attempts`]));
  },

  'dev2-jvm-oom': c => out('gradle', './gradlew test', `${chatter(c)}
> Task :${c.word}-batch:test

${c.Word}ImportTest > imports${c.Word}Archive() FAILED
    java.lang.OutOfMemoryError: Java heap space
        at java.base/java.util.Arrays.copyOf(Arrays.java:3541)
        at java.base/java.io.ByteArrayOutputStream.ensureCapacity(ByteArrayOutputStream.java:100)
        at java.base/java.io.ByteArrayOutputStream.write(ByteArrayOutputStream.java:132)
        at com.example.${c.word}.ArchiveReader.readAll(ArchiveReader.java:${c.line})
        at com.example.${c.word}.${c.Word}ImportTest.imports${c.Word}Archive(${c.Word}ImportTest.java:${c.line2})

Exception in thread "Test worker" java.lang.OutOfMemoryError: Java heap space

12 tests completed, 1 failed

> Task :${c.word}-batch:test FAILED

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':${c.word}-batch:test'.
> Process 'Gradle Test Executor ${c.serial % 9 + 1}' finished with non-zero exit value 1
  This problem might be caused by incorrect test process configuration.
  For more on test execution, please refer to https://docs.gradle.org/8.10.2/userguide/java_testing.html#sec:test_execution in the Gradle documentation.

BUILD FAILED in 1m 2s`, gold([`imports${c.Word}Archive`], [`ArchiveReader.java:${c.line}`, `${c.Word}ImportTest.java:${c.line2}`], ['java.lang.OutOfMemoryError: Java heap space'])),

  // ---- .NET ----
  'dev2-dotnet-xunit': c => out('dotnet', 'dotnet test', `${chatter(c)}
  Determining projects to restore...
  All projects are up-to-date for restore.
  ${c.Word}.Core -> ${c.abs(`src/${c.Word}.Core/bin/Debug/net8.0/${c.Word}.Core.dll`)}
  ${c.Word}.Tests -> ${c.abs(`tests/${c.Word}.Tests/bin/Debug/net8.0/${c.Word}.Tests.dll`)}
Test run for ${c.abs(`tests/${c.Word}.Tests/bin/Debug/net8.0/${c.Word}.Tests.dll`)} (.NETCoreApp,Version=v8.0)
VSTest version 17.11.1 (x64)

Starting test execution, please wait...
A total of 1 test files matched the specified pattern.
[xUnit.net 00:00:00.41]     ${c.Word}.Tests.InvoiceTests.Computes${c.Word}Total [FAIL]
  Failed ${c.Word}.Tests.InvoiceTests.Computes${c.Word}Total [8 ms]
  Error Message:
   Assert.Equal() Failure: Strings differ
           ↓ (pos 7)
Expected: "${c.want}"
Actual:   "${c.got}"
           ↑ (pos 7)
  Stack Trace:
     at ${c.Word}.Tests.InvoiceTests.Computes${c.Word}Total() in ${c.abs(`tests/${c.Word}.Tests/InvoiceTests.cs`)}:line ${c.line}
   at System.RuntimeMethodHandle.InvokeMethod(Object target, Void** arguments, Signature sig, Boolean isConstructor)
   at System.Reflection.MethodBaseInvoker.InvokeWithNoArgs(Object obj, BindingFlags invokeAttr)

Failed!  - Failed:     1, Passed:    37, Skipped:     0, Total:    38, Duration: 61 ms - ${c.Word}.Tests.dll (net8.0)`,
  gold([`Computes${c.Word}Total`], [`InvoiceTests.cs:line ${c.line}`], [`Expected: "${c.want}"`, `Actual:   "${c.got}"`], ['System.RuntimeMethodHandle.InvokeMethod', 'MethodBaseInvoker.InvokeWithNoArgs'])),

  'dev2-dotnet-nunit': c => out('dotnet', 'dotnet test', `${chatter(c)}
Starting test execution, please wait...
A total of 1 test files matched the specified pattern.
  Failed Settles${c.Word}Batch [41 ms]
  Error Message:
   System.InvalidOperationException : Sequence contains no matching element
  Stack Trace:
     at System.Linq.ThrowHelper.ThrowNoMatchException()
   at System.Linq.Enumerable.First[TSource](IEnumerable\`1 source, Func\`2 predicate)
   at ${c.Word}.Billing.Settlement.Pick(IEnumerable\`1 rows, Int32 id) in ${c.abs(`src/${c.Word}.Billing/Settlement.cs`)}:line ${c.line}
   at ${c.Word}.Billing.Tests.SettlementTests.Settles${c.Word}Batch() in ${c.abs(`tests/${c.Word}.Billing.Tests/SettlementTests.cs`)}:line ${c.line2}

1)    at ${c.Word}.Billing.Settlement.Pick(IEnumerable\`1 rows, Int32 id) in ${c.abs(`src/${c.Word}.Billing/Settlement.cs`)}:line ${c.line}


Failed!  - Failed:     1, Passed:    55, Skipped:     2, Total:    58, Duration: 312 ms - ${c.Word}.Billing.Tests.dll (net8.0)`,
  gold([`Settles${c.Word}Batch`], [`Settlement.cs:line ${c.line}`, `SettlementTests.cs:line ${c.line2}`], ['Sequence contains no matching element'], ['System.Linq.ThrowHelper.ThrowNoMatchException', 'System.Linq.Enumerable.First'])),

  // ---- Apple, functional and other languages ----
  'dev2-swift-testing': c => {
    const mac = c.variant % 2 === 1;
    const [start, pass, fail, info] = mac ? ['\u{100148}', '\u{10105B}', '\u{100884}', '\u{100135}'] : ['◇', '✔', '✘', '↳'];
    return out('swift-testing', 'swift test', `${chatter(c)}
[1/1] Planning build
Building for debugging...
[14/14] Linking ${c.Word}PackageTests
Build complete! (6.21s)
Test Suite 'All tests' started at 2026-10-16 09:12:44.101.
Test Suite 'All tests' passed at 2026-10-16 09:12:44.102.
	 Executed 0 tests, with 0 failures (0 unexpected) in 0.000 (0.001) seconds
${start} Test run started.
${info} Testing Library Version: 6.0.0
${start} Suite ${c.Word}FormatterTests started.
${start} Test "formats ${c.word} amounts" started.
${start} Test "rounds ${c.word} totals ${c.serial}" started.
${pass} Test "formats ${c.word} amounts" passed after 0.002 seconds.
${fail} Test "rounds ${c.word} totals ${c.serial}" recorded an issue at ${c.Word}FormatterTests.swift:${c.line}:9: Expectation failed: (formatter.round(${c.n}) → "${c.got}") == "${c.want}"
${fail} Test "rounds ${c.word} totals ${c.serial}" failed after 0.003 seconds with 1 issue.
${fail} Suite ${c.Word}FormatterTests failed after 0.004 seconds with 1 issue.
${fail} Test run with 2 tests failed after 0.004 seconds with 1 issue.`,
    gold([`rounds ${c.word} totals ${c.serial}`], [`${c.Word}FormatterTests.swift:${c.line}:9`], [`Expectation failed: (formatter.round(${c.n}) → "${c.got}") == "${c.want}"`]));
  },

  'dev2-ghc-compile': c => out('cabal', 'cabal build', `${chatter(c)}
Resolving dependencies...
Build profile: -w ghc-9.8.2 -O1
In order, the following will be built (use -v for more details):
 - ${c.word}-0.1.0.0 (lib) (first run)
Preprocessing library for ${c.word}-0.1.0.0..
Building library for ${c.word}-0.1.0.0..
[3 of 7] Compiling ${c.Word}.Ledger    ( src/${c.Word}/Ledger.hs, dist-newstyle/build/x86_64-linux/ghc-9.8.2/${c.word}-0.1.0.0/build/${c.Word}/Ledger.o )

src/${c.Word}/Ledger.hs:${c.line}:${c.col}: error: [GHC-88464]
    Variable not in scope: post${c.Word}Entry :: Entry -> Ledger -> Ledger
    Suggested fix: Perhaps use ‘postEntry’ (line ${c.line - 9})
   |
${c.line} |   in post${c.Word}Entry e l
   |      ^^^^^^^^^^^^^^^

src/${c.Word}/Ledger.hs:${c.line2}:${c.col}: error: [GHC-83865]
    • Couldn't match expected type ‘Int’ with actual type ‘Integer’
    • In the first argument of ‘replicate’, namely ‘n’
      In the expression: replicate n ' '
   |
${c.line2} |   pad n = replicate n ' '
   |                     ^
Error: [Cabal-7125]
Failed to build ${c.word}-0.1.0.0 (which is required by test:${c.word}-test from ${c.word}-0.1.0.0).`,
  gold([], [`src/${c.Word}/Ledger.hs:${c.line}:${c.col}`, `src/${c.Word}/Ledger.hs:${c.line2}:${c.col}`], [`Variable not in scope: post${c.Word}Entry`, "Couldn't match expected type ‘Int’ with actual type ‘Integer’"])),

  'dev2-hspec': c => out('hspec', 'cabal test', `${chatter(c)}
Running 1 test suites...
Test suite ${c.word}-test: RUNNING...

${c.Word}.Parser
  parseAmount
    parses whole numbers [✔]
    parses ${c.word} decimals ${c.serial} [✘]
${c.Word}.Render
  render
    pads columns [✔]

Failures:

  test/${c.Word}/ParserSpec.hs:${c.line}:${c.col}:
  1) ${c.Word}.Parser, parseAmount, parses ${c.word} decimals ${c.serial}
       expected: Right ${c.n}
        but got: Left "unexpected '.' at column ${c.col}"

  To rerun use: --match "/${c.Word}.Parser/parseAmount/parses ${c.word} decimals ${c.serial}/" --seed ${c.serial}

Randomized with seed ${c.serial}

Finished in 0.0021 seconds
3 examples, 1 failure
Test suite ${c.word}-test: FAIL
Test suite logged to:
${c.abs(`dist-newstyle/build/x86_64-linux/ghc-9.8.2/${c.word}-0.1.0.0/t/${c.word}-test/test/${c.word}-0.1.0.0-${c.word}-test.log`)}
0 of 1 test suites (0 of 1 test cases) passed.
Error: [Cabal-7125]
Tests failed for test:${c.word}-test from ${c.word}-0.1.0.0.`,
  gold([`parses ${c.word} decimals ${c.serial}`], [`test/${c.Word}/ParserSpec.hs:${c.line}:${c.col}`], [`expected: Right ${c.n}`, `but got: Left "unexpected '.' at column ${c.col}"`])),

  'dev2-ocaml-compile': c => out('dune', 'dune build', `${chatter(c)}
File "src/${c.word}_ledger.ml", line ${c.line}, characters ${c.col}-${c.col + 12}:
${c.line} |   let total = sum_${c.word} entries in
                    ^^^^^^^^^^^^
Error: Unbound value sum_${c.word}
Hint: Did you mean sum_entries?
File "test/test_${c.word}.ml", line ${c.line2}, characters 22-30:
${c.line2} |   Alcotest.(check int) "total" ${c.n} (Ledger.label l)
                           ^^^^^^^^
Error: This expression has type string but an expression was expected of type
         int`, gold([], [`File "src/${c.word}_ledger.ml", line ${c.line}`, `File "test/test_${c.word}.ml", line ${c.line2}`], [`Unbound value sum_${c.word}`, 'This expression has type string but an expression was expected of type'])),

  'dev2-alcotest': c => {
    const box = '─'.repeat(78);
    return out('alcotest', 'dune test', `${chatter(c)}
Testing \`${c.word}'.
This run has ID \`X${c.hex.toUpperCase()}'.

  [OK]          ledger          0   opens empty.
  [FAIL]        ledger          1   posts ${c.word} entry ${c.serial}.
  [OK]          render          0   pads.

┌${box}┐
│ [FAIL]        ledger          1   posts ${c.word} entry ${c.serial}.${' '.repeat(Math.max(1, 40 - String(c.serial).length - c.word.length))}│
└${box}┘
ASSERT total
FAIL total

   Expected: \`${c.n}'
   Received: \`${c.m}'

Raised at Alcotest_engine__Test.check in file "src/alcotest-engine/test.ml", line 216, characters 4-261
Called from Test_${c.word}.test_post in file "test/test_${c.word}.ml", line ${c.line}, characters 4-48
Called from Alcotest_engine__Core.Make.protect_test.(fun) in file "src/alcotest-engine/core.ml", line 186, characters 17-23
Called from Alcotest_engine__Monad.Identity.catch in file "src/alcotest-engine/monad.ml", line 24, characters 31-35

Logs saved to \`~/_build/default/test/_build/_tests/${c.word}/ledger.001.output'.
${box}

Full test results in \`~/_build/default/test/_build/_tests/${c.word}'.
1 failure! in 0.001s. 3 tests run.`, gold([`posts ${c.word} entry ${c.serial}`], [`test/test_${c.word}.ml", line ${c.line}`], [`Expected: \`${c.n}'`, `Received: \`${c.m}'`], ['alcotest-engine/test.ml", line 216', 'alcotest-engine/core.ml", line 186']));
  },

  'dev2-zig-test': c => out('zig', 'zig build test', `${chatter(c)}
test
└─ run test 3/4 passed, 1 failed
error: 'test.${c.word} ledger posts entry ${c.serial}' failed:
expected ${c.n}, found ${c.m}
${c.windows ? 'C:\\zig\\lib\\std\\testing.zig' : '/usr/lib/zig/std/testing.zig'}:103:17: 0x10457c3 in expectEqualInner__anon_1734 (test)
                return error.TestExpectedEqual;
                ^
${c.abs(`src/${c.word}.zig`)}:${c.line}:5: 0x1045a91 in test.${c.word} ledger posts entry ${c.serial} (test)
    try std.testing.expectEqual(@as(u32, ${c.n}), ledger.total());
    ^
error: while executing test 'test.${c.word} ledger posts entry ${c.serial}', the following test command failed:
${c.abs('.zig-cache/o/3b1f0c9a/test')} --seed=0x${c.hex} --cache-dir=${c.abs('.zig-cache')} --listen=-
Build Summary: 1/3 steps succeeded; 1 failed; 3/4 tests passed; 1 failed
test transitive failure
└─ run test 3/4 passed, 1 failed
error: the following build command failed with exit code 1:
${c.abs('.zig-cache/o/a91e/build')} /usr/bin/zig ${c.abs('')} ${c.abs('.zig-cache')} test`,
  gold([`${c.word} ledger posts entry ${c.serial}`], [`${c.word}.zig:${c.line}:5`], [`expected ${c.n}, found ${c.m}`], ['testing.zig:103:17'])),

  'dev2-julia-test': c => {
    const stdlib = '~/.julia/juliaup/julia-1.10.5+0.x64.linux.gnu/share/julia/stdlib/v1.10';
    return out('julia', 'julia --project -e "using Pkg; Pkg.test()"', `${chatter(c)}
     Testing Running tests...
${c.word} ledger ${c.serial}: Test Failed at ${c.abs('test/runtests.jl')}:${c.line}
  Expression: post_${c.word}(ledger, ${c.n}) == ${c.n}
   Evaluated: ${c.m} == ${c.n}

Stacktrace:
 [1] macro expansion
   @ ${stdlib}/Test/src/Test.jl:672 [inlined]
 [2] macro expansion
   @ ${c.abs('test/runtests.jl')}:${c.line} [inlined]
 [3] macro expansion
   @ ${stdlib}/Test/src/Test.jl:1577 [inlined]
 [4] top-level scope
   @ ${c.abs('test/runtests.jl')}:${c.line - 4}
Test Summary:          | Pass  Fail  Total  Time
${c.word} ledger ${c.serial} |   11     1     12  0.8s
ERROR: LoadError: Some tests did not pass: 11 passed, 1 failed, 0 errored, 0 broken.
in expression starting at ${c.abs('test/runtests.jl')}:${c.line - 5}
ERROR: Package ${c.Word} errored during testing
Stacktrace:
 [1] pkgerror(msg::String)
   @ Pkg.Types ${stdlib}/Pkg/src/Types.jl:70
 [2] test(ctx::Pkg.Types.Context, pkgs::Vector{Pkg.Types.PackageSpec})
   @ Pkg.Operations ${stdlib}/Pkg/src/Operations.jl:2112`, gold([`${c.word} ledger ${c.serial}`], [`runtests.jl:${c.line}`], [`Evaluated: ${c.m} == ${c.n}`], ['Test/src/Test.jl:672', 'Pkg/src/Types.jl:70']));
  },

  'dev2-flutter-test': c => out('flutter', 'flutter test', `${chatter(c)}
00:01 +0: loading ${c.abs(`test/${c.word}_cart_test.dart`)}
00:02 +3: ${c.abs(`test/${c.word}_cart_test.dart`)}: ${c.Word}Cart adds lines
00:02 +3 -1: ${c.abs(`test/${c.word}_cart_test.dart`)}: ${c.Word}Cart totals ${c.word} lines ${c.serial} [E]
  Expected: <${c.n}>
    Actual: <${c.m}>

  package:matcher                                     expect
  package:flutter_test/src/widget_tester.dart 474:18  expect
  test/${c.word}_cart_test.dart ${c.line}:7               main.<fn>.<fn>


To run this test again: /opt/flutter/bin/cache/dart-sdk/bin/dart test ${c.abs(`test/${c.word}_cart_test.dart`)} -p vm --plain-name '${c.Word}Cart totals ${c.word} lines ${c.serial}'
00:03 +9 -1: Some tests failed.`, gold([`${c.Word}Cart totals ${c.word} lines ${c.serial}`], [`test/${c.word}_cart_test.dart ${c.line}:7`], [`Expected: <${c.n}>`, `Actual: <${c.m}>`], ['package:flutter_test/src/widget_tester.dart 474:18'])),

  'dev2-elixir-compile': c => out('mix', 'mix compile --warnings-as-errors', `${chatter(c)}
==> ${c.word}
Compiling 14 files (.ex)
    error: undefined function post_${c.word}/2 (expected ${c.Word}.Ledger to define such a function or for it to be imported, but none are available)
    │
 ${c.line} │     post_${c.word}(ledger, entry)
    │     ^^^^^^^^^^^
    │
    └─ lib/${c.word}/ledger.ex:${c.line}:5: ${c.Word}.Ledger.close/1

    warning: variable "rate" is unused (if the variable is not meant to be used, prefix it with an underscore)
    │
 ${c.line2} │   def total(rate, rows) do
    │             ~~~~
    │
    └─ lib/${c.word}/totals.ex:${c.line2}:13: ${c.Word}.Totals.total/2


== Compilation error in file lib/${c.word}/ledger.ex ==
** (CompileError) lib/${c.word}/ledger.ex: cannot compile module ${c.Word}.Ledger (errors have been logged)
    (elixir 1.17.3) expanding macro: Kernel.def/2`, gold([], [`lib/${c.word}/ledger.ex:${c.line}:5`], [`undefined function post_${c.word}/2`])),

  // ---- PHP, Ruby, Perl, Lua, R ----
  'dev2-phpstan': c => {
    const rule = ` ------ ${'-'.repeat(70)} `;
    return out('phpstan', 'vendor/bin/phpstan analyse', `${chatter(c)}
Note: Using configuration file ${c.abs('phpstan.neon')}.
 41/41 [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100%

${rule}
  Line   src/${c.Word}/Invoice.php
${rule}
  ${c.line}     Call to an undefined method App\\${c.Word}\\Ledger::post${c.Word}${c.serial}().
         🪪  method.notFound
  ${c.line2}     Parameter #1 $amount of method App\\${c.Word}\\Invoice::add() expects int, string given.
         🪪  argument.type
${rule}


 [ERROR] Found 2 errors`, gold([], ['src/' + c.Word + '/Invoice.php'], [`${c.line}     Call to an undefined method App\\${c.Word}\\Ledger::post${c.Word}${c.serial}()`, `${c.line2}     Parameter #1 $amount of method App\\${c.Word}\\Invoice::add() expects int, string given`]));
  },

  'dev2-pest': c => out('pest', 'vendor/bin/pest', `${chatter(c)}
   PASS  Tests\\Unit\\${c.Word}FormatterTest
  ✓ it formats whole amounts                                             0.01s

   FAIL  Tests\\Feature\\${c.Word}CheckoutTest
  ✓ it shows the cart                                                    0.12s
  ⨯ it applies the ${c.word} coupon ${c.serial}                                   0.08s
  ────────────────────────────────────────────────────────────────────────────
   FAILED  Tests\\Feature\\${c.Word}CheckoutTest > it applies the ${c.word} coupon ${c.serial}
  Failed asserting that ${c.m} is identical to ${c.n}.

  at tests/Feature/${c.Word}CheckoutTest.php:${c.line}
    ${c.line - 2}▕     $cart = Cart::fromFixture('${c.word}');
    ${c.line - 1}▕     $cart->apply('${c.WORD}${c.serial}');
  ➜ ${c.line}▕     expect($cart->total())->toBe(${c.n});
    ${c.line + 1}▕ });

  1   tests/Feature/${c.Word}CheckoutTest.php:${c.line}


  Tests:    1 failed, 2 passed (5 assertions)
  Duration: 0.31s`, gold([`it applies the ${c.word} coupon ${c.serial}`], [`tests/Feature/${c.Word}CheckoutTest.php:${c.line}`], [`Failed asserting that ${c.m} is identical to ${c.n}.`])),

  'dev2-minitest': c => out('minitest', 'bin/rails test', `${chatter(c)}
Run options: --seed ${c.serial % 65536}

# Running:

.....F...E..

Finished in 0.214733s, 55.88 runs/s, 93.14 assertions/s.

  1) Failure:
${c.Word}CartTest#test_${c.word}_total_includes_tax [test/models/${c.word}_cart_test.rb:${c.line}]:
Expected: ${c.n}
  Actual: ${c.m}

  2) Error:
${c.Word}CartTest#test_${c.word}_checkout_clears_lines:
NoMethodError: undefined method \`clear_${c.word}' for nil
    app/models/${c.word}_cart.rb:${c.line2}:in \`block in checkout!'
    /usr/local/bundle/gems/activerecord-7.2.1/lib/active_record/relation/delegation.rb:100:in \`each'
    app/models/${c.word}_cart.rb:${c.line2 - 3}:in \`checkout!'
    test/models/${c.word}_cart_test.rb:${c.line3}:in \`block in <class:${c.Word}CartTest>'

12 runs, 20 assertions, 1 failures, 1 errors, 0 skips`,
  gold([`test_${c.word}_total_includes_tax`, `test_${c.word}_checkout_clears_lines`], [`test/models/${c.word}_cart_test.rb:${c.line}`, `app/models/${c.word}_cart.rb:${c.line2}`], [`Expected: ${c.n}`, `Actual: ${c.m}`, `undefined method \`clear_${c.word}' for nil`], ['active_record/relation/delegation.rb:100'])),

  'dev2-rubocop': c => out('rubocop', 'bundle exec rubocop', `${chatter(c)}
Inspecting 41 files
.......C..............W...........C......

Offenses:

app/models/${c.word}_ledger.rb:${c.line}:${c.col}: C: [Correctable] Style/StringLiterals: Prefer single-quoted strings when you don't need string interpolation or special symbols.
    label = "${c.word}"
            ^^^^^^^^^^
app/services/${c.word}_sync.rb:${c.line2}:5: W: Lint/UselessAssignment: Useless assignment to variable ${c.word}_count_${c.serial}.
    ${c.word}_count_${c.serial} = rows.size
    ^^^^^^^^^^^^^^^^^^^^
app/services/${c.word}_sync.rb:${c.line3}:3: C: [Correctable] Layout/EmptyLineAfterGuardClause: Add empty line after guard clause.
  return if rows.empty?
  ^^^^^^^^^^^^^^^^^^^^^

41 files inspected, 3 offenses detected, 2 offenses autocorrectable`,
  gold([], [`app/models/${c.word}_ledger.rb:${c.line}:${c.col}`, `app/services/${c.word}_sync.rb:${c.line2}:5`], ['Style/StringLiterals', `Lint/UselessAssignment: Useless assignment to variable ${c.word}_count_${c.serial}`])),

  'dev2-gitlab-rspec': c => {
    const sec = (kind, name, at) => `section_${kind}:${1760605900 + at}:${name}\r\x1b[0K`;
    return out('rspec', 'bundle exec rspec', `Running with gitlab-runner 17.4.0 (b92ee590)
  on docker-auto-scale-runner-7 t1_k2LmN, system ID: s_0c1d2e3f4a5b
${sec('start', 'prepare_executor', 1)}\x1b[0K\x1b[36;1mPreparing the "docker+machine" executor\x1b[0;m
Using Docker executor with image ruby:3.3 ...
Pulling docker image ruby:3.3 ...
${sec('end', 'prepare_executor', 9)}
${sec('start', 'step_script', 12)}\x1b[0K\x1b[36;1mExecuting "step_script" stage of the job script\x1b[0;m
\x1b[32;1m$ bundle exec rspec\x1b[0;m
${chatter(c)}
.......F....

Failures:

  1) ${c.Word}::Invoice#total sums ${c.word} lines ${c.serial}
     Got 2 failures from failure aggregation block.
     # ./spec/models/${c.word}/invoice_spec.rb:${c.line}:in \`block (3 levels) in <top (required)>'

     1.1) Failure/Error: expect(invoice.total).to eq(${c.n})

            expected: ${c.n}
                 got: ${c.m}

            (compared using ==)
          # ./spec/models/${c.word}/invoice_spec.rb:${c.line + 1}:in \`block (4 levels) in <top (required)>'

     1.2) Failure/Error: expect(invoice.currency).to eq("${c.want}")

            expected: "${c.want}"
                 got: "${c.got}"

            (compared using ==)
          # ./spec/models/${c.word}/invoice_spec.rb:${c.line + 2}:in \`block (4 levels) in <top (required)>'

Finished in 1.42 seconds (files took 2.1 seconds to load)
212 examples, 1 failure

Failed examples:

rspec ./spec/models/${c.word}/invoice_spec.rb:${c.line - 1} # ${c.Word}::Invoice#total sums ${c.word} lines ${c.serial}
${sec('end', 'step_script', 40)}
${sec('start', 'cleanup_file_variables', 41)}\x1b[0K\x1b[36;1mCleaning up project directory and file based variables\x1b[0;m
${sec('end', 'cleanup_file_variables', 42)}
\x1b[31;1mERROR: Job failed: exit code 1
\x1b[0;m`, gold([`${c.Word}::Invoice#total sums ${c.word} lines ${c.serial}`], [`spec/models/${c.word}/invoice_spec.rb:${c.line + 1}`], [`expected: ${c.n}`, `got: ${c.m}`, `expected: "${c.want}"`, `got: "${c.got}"`]));
  },

  'dev2-perl-prove': c => out('prove', 'prove -l t', `${chatter(c)}
t/00-load.t ......... ok
t/${c.word}_ledger.t .. 1/7
#   Failed test 'posts ${c.word} entry ${c.serial}'
#   at t/${c.word}_ledger.t line ${c.line}.
#          got: '${c.got}'
#     expected: '${c.want}'
# Looks like you failed 1 test of 7.
t/${c.word}_ledger.t .. Dubious, test returned 1 (wstat 256, 0x100)
Failed 1/7 subtests
t/${c.word}_render.t .. ok

Test Summary Report
-------------------
t/${c.word}_ledger.t (Wstat: 256 (exited 1) Tests: 7 Failed: 1)
  Failed test:  4
  Non-zero exit status: 1
Files=3, Tests=19,  0 wallclock secs ( 0.02 usr  0.01 sys +  0.21 cusr  0.03 csys =  0.27 CPU)
Result: FAIL`, gold([`posts ${c.word} entry ${c.serial}`], [`t/${c.word}_ledger.t line ${c.line}`], [`got: '${c.got}'`, `expected: '${c.want}'`])),

  'dev2-busted': c => out('busted', 'busted', `${chatter(c)}
●●●●◼●●
6 successes / 1 failure / 0 errors / 0 pending : 0.012 seconds

Failure → spec/${c.word}_ledger_spec.lua @ ${c.line - 3}
${c.word} ledger posts entries ${c.serial}
spec/${c.word}_ledger_spec.lua:${c.line}: Expected objects to be the same.
Passed in:
(number) ${c.m}
Expected:
(number) ${c.n}

stack traceback:
	spec/${c.word}_ledger_spec.lua:${c.line}: in function <spec/${c.word}_ledger_spec.lua:${c.line - 3}>`,
  gold([`${c.word} ledger posts entries ${c.serial}`], [`spec/${c.word}_ledger_spec.lua:${c.line}`], [`(number) ${c.m}`, `(number) ${c.n}`])),

  'dev2-testthat': c => out('testthat', 'Rscript -e "devtools::test()"', `${chatter(c)}
ℹ Testing ${c.word}
✔ | F W  S  OK | Context
✔ |          4 | format
✖ | 1        6 | ${c.word} [0.2s]
────────────────────────────────────────────────────────────────────────────────
Failure (test-${c.word}.R:${c.line}:3): ${c.word} totals include tax ${c.serial}
\`total_${c.word}(cart)\` (\`actual\`) not equal to ${c.n} (\`expected\`).

  \`actual\`: ${c.m}
\`expected\`: ${c.n}
────────────────────────────────────────────────────────────────────────────────

══ Results ═════════════════════════════════════════════════════════════════════
Duration: 0.4 s

── Failed tests ────────────────────────────────────────────────────────────────
── Failure (test-${c.word}.R:${c.line}:3): ${c.word} totals include tax ${c.serial} ──
\`total_${c.word}(cart)\` (\`actual\`) not equal to ${c.n} (\`expected\`).

  \`actual\`: ${c.m}
\`expected\`: ${c.n}

[ FAIL 1 | WARN 0 | SKIP 0 | PASS 10 ]
Error: Test failures
Execution halted`, gold([`${c.word} totals include tax ${c.serial}`], [`test-${c.word}.R:${c.line}:3`], [`\`actual\`: ${c.m}`, `\`expected\`: ${c.n}`])),

  // ---- C and C++ ----
  'dev2-clang-ninja': c => out('ninja', 'cmake --build build', `${chatter(c)}
[1/14] Building CXX object src/CMakeFiles/${c.word}.dir/ledger.cpp.o
[2/14] Building CXX object src/CMakeFiles/${c.word}.dir/codec.cpp.o
FAILED: src/CMakeFiles/${c.word}.dir/codec.cpp.o
/usr/bin/clang++ -DNDEBUG -I${c.abs('include')} -O2 -std=c++20 -MD -MT src/CMakeFiles/${c.word}.dir/codec.cpp.o -MF src/CMakeFiles/${c.word}.dir/codec.cpp.o.d -o src/CMakeFiles/${c.word}.dir/codec.cpp.o -c ${c.abs('src/codec.cpp')}
${c.abs('src/codec.cpp')}:${c.line}:${c.col}: error: no member named 'decode_${c.word}' in '${c.word}::Frame'
   ${c.line} |   return frame.decode_${c.word}(buf);
      |          ~~~~~ ^
${c.abs('src/codec.cpp')}:${c.line2}:10: error: no matching function for call to 'push_back'
   ${c.line2} |   frames.push_back(${c.word}_id, buf);
      |   ~~~~~~~^~~~~~~~~
/usr/include/c++/14/bits/stl_vector.h:1281:7: note: candidate function not viable: requires single argument '__x', but 2 arguments were provided
 1281 |       push_back(const value_type& __x)
      |       ^         ~~~~~~~~~~~~~~~~~~~~~
2 errors generated.
ninja: build stopped: subcommand failed.`, gold([], [`codec.cpp:${c.line}:${c.col}`, `codec.cpp:${c.line2}:10`], [`no member named 'decode_${c.word}' in '${c.word}::Frame'`, "no matching function for call to 'push_back'"], ['bits/stl_vector.h:1281:7'])),

  'dev2-msvc-msbuild': c => {
    const proj = `D:\\a\\${c.stem}\\build\\${c.word}.vcxproj`;
    const loc = l => c.variant % 2 ? `(${l})` : `(${l},${c.col})`;
    return out('msbuild', 'msbuild build\\all.sln /p:Configuration=Release', `${chatter(c)}
MSBuild version 17.11.9+a69bbaaf5 for .NET Framework
  ledger.cpp
  codec.cpp
D:\\a\\${c.stem}\\src\\ledger.cpp${loc(c.line)}: error C2065: '${c.word}_rate': undeclared identifier [${proj}]
D:\\a\\${c.stem}\\src\\ledger.cpp${loc(c.line2)}: error C2440: 'initializing': cannot convert from 'const char [6]' to 'int' [${proj}]
D:\\a\\${c.stem}\\src\\ledger.cpp${loc(c.line2)}: message : There is no context in which this conversion is possible [${proj}]
C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Tools\\MSVC\\14.41.34120\\include\\xmemory(1532,9): warning C4244: 'argument': conversion from 'double' to 'int', possible loss of data [${proj}]

Build FAILED.

    1 Warning(s)
    2 Error(s)

Time Elapsed 00:00:07.41`, gold([], [`ledger.cpp${loc(c.line)}`, `ledger.cpp${loc(c.line2)}`], ['C2065', `'${c.word}_rate': undeclared identifier`, 'C2440'], ['include\\xmemory(1532,9)']));
  },

  'dev2-catch2': c => out('catch2', `./build/${c.word}_tests`, `${chatter(c)}
Randomness seeded to: ${c.serial}

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
${c.word}_tests is a Catch2 v3.7.1 host application.
Run with -? for options

-------------------------------------------------------------------------------
${c.Word}Ledger posts entries ${c.serial}
  with a ${c.word} rate
-------------------------------------------------------------------------------
${c.abs('tests/ledger_test.cpp')}:${c.line}
...............................................................................

${c.abs('tests/ledger_test.cpp')}:${c.line + 6}: FAILED:
  REQUIRE( ledger.total() == ${c.n} )
with expansion:
  ${c.m} == ${c.n}

===============================================================================
test cases:  9 |  8 passed | 1 failed
assertions: 31 | 30 passed | 1 failed`, gold([`${c.Word}Ledger posts entries ${c.serial}`], [`ledger_test.cpp:${c.line + 6}`], [`REQUIRE( ledger.total() == ${c.n} )`, `${c.m} == ${c.n}`])),

  'dev2-asan': c => {
    const pid = 4000 + c.serial % 5000, addr = `0x50200000${c.hex.slice(0, 4)}`;
    return out('asan', `./build/${c.word}_test`, `${chatter(c)}
=================================================================
==${pid}==ERROR: AddressSanitizer: heap-buffer-overflow on address ${addr} at pc 0x55d4c2a1b2c3 bp 0x7ffd5e1a2b30 sp 0x7ffd5e1a2b28
READ of size 4 at ${addr} thread T0
    #0 0x55d4c2a1b2c3 in ${c.word}_sum ${c.abs(`src/${c.word}.c`)}:${c.line}:${c.col}
    #1 0x55d4c2a1b4f1 in main ${c.abs('src/main.c')}:${c.line2}:10
    #2 0x7f1b2c829d8f in __libc_start_call_main ../sysdeps/nptl/libc_start_call_main.h:58:16
    #3 0x7f1b2c829e3f in __libc_start_main csu/../csu/libc-start.c:392:3
    #4 0x55d4c2a1a0a4 in _start (${c.abs(`build/${c.word}_test`)}+0x1a0a4) (BuildId: 9a1f${c.hex})

${addr} is located 0 bytes after 16-byte region [0x502000000010,0x502000000020)
allocated by thread T0 here:
    #0 0x55d4c2adf6a8 in malloc (${c.abs(`build/${c.word}_test`)}+0xdf6a8) (BuildId: 9a1f${c.hex})
    #1 0x55d4c2a1b3a0 in ${c.word}_alloc ${c.abs(`src/${c.word}.c`)}:${c.line - 9}:22

SUMMARY: AddressSanitizer: heap-buffer-overflow ${c.abs(`src/${c.word}.c`)}:${c.line}:${c.col} in ${c.word}_sum
Shadow bytes around the buggy address:
  0x501ffffffd80: 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  0x501ffffffe00: 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
=>0x502000000000: fa fa 00 00[fa]fa fa fa fa fa fa fa fa fa fa fa
  0x502000000080: fa fa fa fa fa fa fa fa fa fa fa fa fa fa fa fa
Shadow byte legend (one shadow byte represents 8 application bytes):
  Addressable:           00
  Partially addressable: 01 02 03 04 05 06 07
  Heap left redzone:       fa
  Freed heap region:       fd
==${pid}==ABORTING`, gold([], [`${c.word}.c:${c.line}:${c.col}`], ['AddressSanitizer: heap-buffer-overflow', 'READ of size 4'], ['sysdeps/nptl/libc_start_call_main.h:58:16', 'csu/libc-start.c:392:3']));
  },

  // ---- Shell, infrastructure ----
  'dev2-shellcheck': c => out('shellcheck', 'shellcheck scripts/*.sh', `${chatter(c)}

In scripts/${c.word}-deploy.sh line ${c.line}:
rm -rf $${c.WORD}_DIR/build
       ^-----------^ SC2086 (info): Double quote to prevent globbing and word splitting.

Did you mean:
rm -rf "$${c.WORD}_DIR"/build


In scripts/${c.word}-deploy.sh line ${c.line2}:
cd $(dirname "$0")
   ^-------------^ SC2046 (warning): Quote this to prevent word splitting.


In scripts/${c.word}-sync.sh line ${c.line3}:
if [ $count == 0 ]; then
            ^-- SC3014 (warning): In POSIX sh, == in place of = is undefined.

For more information:
  https://www.shellcheck.net/wiki/SC2046 -- Quote this to prevent word splitt...
  https://www.shellcheck.net/wiki/SC3014 -- In POSIX sh, == in place of = is ...
  https://www.shellcheck.net/wiki/SC2086 -- Double quote to prevent globbing ...`,
  gold([], [`scripts/${c.word}-deploy.sh line ${c.line}`, `scripts/${c.word}-deploy.sh line ${c.line2}`, `scripts/${c.word}-sync.sh line ${c.line3}`], ['SC2086', 'SC2046', 'SC3014'])),

  'dev2-terraform-validate': c => out('terraform', 'terraform validate', `Initializing the backend...
Initializing provider plugins...
- Finding hashicorp/aws versions matching "~> 5.0"...
- Installing hashicorp/aws v5.72.1...
- Installed hashicorp/aws v5.72.1 (signed by HashiCorp)
${chatter(c)}
╷
│ Error: Unsupported argument
│
│   on modules/${c.word}/main.tf line ${c.line}, in resource "aws_s3_bucket" "${c.word}_logs":
│   ${c.line}:   acl_${c.word} = "private"
│
│ An argument named "acl_${c.word}" is not expected here.
╵
╷
│ Error: Reference to undeclared input variable
│
│   on modules/${c.word}/outputs.tf line ${c.line2}, in output "bucket":
│   ${c.line2}:   value = var.${c.word}_bucket_${c.serial}
│
│ An input variable with the name "${c.word}_bucket_${c.serial}" has not been declared. This variable can be declared with a variable "${c.word}_bucket_${c.serial}" {} block.
╵`, gold([], [`modules/${c.word}/main.tf line ${c.line}`, `modules/${c.word}/outputs.tf line ${c.line2}`], [`An argument named "acl_${c.word}" is not expected here.`, `An input variable with the name "${c.word}_bucket_${c.serial}" has not been declared`])),

  'dev2-bats': c => {
    const tap = c.variant % 2 === 1;
    const body = tap ? `1..9
ok 1 deploy prints usage
ok 2 deploy rejects unknown flags
not ok 3 deploy creates the ${c.word} archive ${c.serial}
# (in test file test/${c.word}_deploy.bats, line ${c.line})
#   \`[ "$status" -eq 0 ]' failed
# tar: ${c.word}-${c.serial}.tgz: Cannot open: No such file or directory
# tar: Error is not recoverable: exiting now
ok 4 deploy keeps previous release
ok 5 deploy prunes old releases
ok 6 rollback restores previous release
ok 7 rollback refuses without history
ok 8 status prints current release
ok 9 status exits zero when idle` : ` ✓ deploy prints usage
 ✓ deploy rejects unknown flags
 ✗ deploy creates the ${c.word} archive ${c.serial}
   (in test file test/${c.word}_deploy.bats, line ${c.line})
     \`[ "$status" -eq 0 ]' failed
   tar: ${c.word}-${c.serial}.tgz: Cannot open: No such file or directory
   tar: Error is not recoverable: exiting now
 ✓ deploy keeps previous release
 ✓ deploy prunes old releases
 ✓ rollback restores previous release
 ✓ rollback refuses without history
 ✓ status prints current release
 ✓ status exits zero when idle

9 tests, 1 failure`;
    return out('bats', tap ? 'bats --tap test' : 'bats test', `${chatter(c)}\n${body}`,
      gold([`deploy creates the ${c.word} archive ${c.serial}`], [`test/${c.word}_deploy.bats, line ${c.line}`], ['`[ "$status" -eq 0 ]\' failed', `${c.word}-${c.serial}.tgz: Cannot open`]));
  },

  // ---- Logs with many failures ----
  'dev2-pytest-many-tbline': c => {
    const k = 40 + c.serial % 12;
    const tb = Array.from({ length: k }, (_, i) => `${c.abs(`tests/test_batch_${c.serial}.py`)}:${c.line + i * 4}: AssertionError: assert '${c.got}-${i}' == '${c.want}-${i}'`).join('\n');
    const fails = Array.from({ length: k }, (_, i) => `FAILED tests/test_batch_${c.serial}.py::test_case_${i} - AssertionError: assert '${c.got}-${i}' == '${c.want}-${i}'`).join('\n');
    return out('pytest', 'pytest --tb=line', `${chatter(c)}
collected ${k + 12} items

tests/test_batch_${c.serial}.py ${'F'.repeat(k)}${'.'.repeat(12)}  [100%]

=================================== FAILURES ===================================
${tb}
=========================== short test summary info ============================
${fails}
${k} failed, 12 passed in 1.94s`, gold(['test_case_0'], [`test_batch_${c.serial}.py:${c.line}`], [`assert '${c.got}-0' == '${c.want}-0'`, `${k} failed, 12 passed`]));
  },

  'dev2-tsc-many-errors': c => {
    const k = 45 + c.serial % 10;
    const errs = Array.from({ length: k }, (_, i) => `src/${c.word}/gen/model_${i}.ts(${c.line + i},${c.col}): error TS2322: Type 'string' is not assignable to type '${c.Word}Id${i}'.`).join('\n');
    return out('tsc', 'npx tsc --noEmit --pretty false', `${chatter(c)}
${errs}`, gold([], [`src/${c.word}/gen/model_0.ts(${c.line},${c.col})`], [`Type 'string' is not assignable to type '${c.Word}Id0'`]), 2);
  },

  // ---- Large passing runs ----
  'dev2-pass-pytest-verbose': c => {
    const k = 70 + c.serial % 30;
    const rows = Array.from({ length: k }, (_, i) => `tests/test_${c.word}_${Math.floor(i / 10)}.py::test_${c.word}_case_${i} PASSED${' '.repeat(12)}[${String(Math.floor((i + 1) * 100 / (k + 2))).padStart(3)}%]`).join('\n');
    return out('pytest', 'pytest -v', `${chatter(c)}
collected ${k + 2} items

${rows}
tests/test_${c.word}_slow.py::test_${c.word}_remote SKIPPED (needs network)                [ 99%]
tests/test_${c.word}_slow.py::test_${c.word}_gpu SKIPPED (needs cuda)                      [100%]

=============================== warnings summary ===============================
src/${c.word}/compat.py:${c.line}
  ${c.abs(`src/${c.word}/compat.py`)}:${c.line}: DeprecationWarning: datetime.datetime.utcnow() is deprecated and scheduled for removal in a future version.
    stamp = datetime.utcnow()

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
================= ${k} passed, 2 skipped, 1 warning in 4.${c.serial % 90 + 10}s ==================`,
    gold([], [], [`${k} passed, 2 skipped, 1 warning in 4.${c.serial % 90 + 10}s`]), 0);
  },

  'dev2-pass-cargo': c => {
    const unit = 60 + c.serial % 40, integ = 8 + c.serial % 7, doc = 3 + c.serial % 4;
    const tests = (prefix, count) => Array.from({ length: count }, (_, i) => `test ${prefix}${i} ... ok`).join('\n');
    return out('cargo', 'cargo test', `${chatter(c)}
   Compiling ${c.word} v1.2.${c.serial % 10} (${c.abs('')})
    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 8.41s
     Running unittests src/lib.rs (target/debug/deps/${c.word}-${c.hex})

running ${unit} tests
${tests(`ledger::tests::case_`, unit)}

test result: ok. ${unit} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s

     Running tests/integration.rs (target/debug/deps/integration-${c.hex}a)

running ${integ} tests
${tests(`roundtrip_`, integ)}

test result: ok. ${integ} passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.21s

   Doc-tests ${c.word}

running ${doc} tests
${Array.from({ length: doc }, (_, i) => `test src/lib.rs - Ledger::post (line ${c.line + i * 20}) ... ok`).join('\n')}

test result: ok. ${doc} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.31s`,
    gold([], [], [`test result: ok. ${unit} passed; 0 failed`, `test result: ok. ${integ} passed; 0 failed; 1 ignored`]), 0);
  },

  'dev2-pass-mocha': c => {
    const k = 90 + c.serial % 40;
    const rows = Array.from({ length: k }, (_, i) => `    ✔ ${['looks up', 'books', 'cooks', 'hooks into', 'stores'][i % 5]} ${c.word} record ${i}${i % 9 === 0 ? ` (${i + 40}ms)` : ''}`).join('\n');
    return out('mocha', 'npx mocha', `${chatter(c)}

  ${c.Word}Store
${rows}
    - archives ${c.word} records (pending)


  ${k} passing (2s)
  1 pending`, gold([], [], [`${k} passing (2s)`, '1 pending']), 0);
  },

  'dev2-pass-dotnet': c => {
    const a = 150 + c.serial % 80, b = 20 + c.serial % 15;
    const warns = Array.from({ length: 18 }, (_, i) => `${c.abs(`src/${c.Word}.Core/Models/Model${i}.cs`)}(${c.line + i},${c.col}): warning CS8618: Non-nullable property 'Name' must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring the property as nullable. [${c.abs(`src/${c.Word}.Core/${c.Word}.Core.csproj`)}]`).join('\n');
    return out('dotnet', 'dotnet test', `${chatter(c)}
  Determining projects to restore...
  All projects are up-to-date for restore.
${warns}
  ${c.Word}.Core -> ${c.abs(`src/${c.Word}.Core/bin/Debug/net8.0/${c.Word}.Core.dll`)}
Test run for ${c.abs(`tests/${c.Word}.Tests/bin/Debug/net8.0/${c.Word}.Tests.dll`)} (.NETCoreApp,Version=v8.0)
Starting test execution, please wait...
A total of 1 test files matched the specified pattern.

Passed!  - Failed:     0, Passed:   ${a}, Skipped:     1, Total:   ${a + 1}, Duration: 1 s - ${c.Word}.Tests.dll (net8.0)
Test run for ${c.abs(`tests/${c.Word}.Api.Tests/bin/Debug/net8.0/${c.Word}.Api.Tests.dll`)} (.NETCoreApp,Version=v8.0)
Starting test execution, please wait...
A total of 1 test files matched the specified pattern.

Passed!  - Failed:     0, Passed:    ${b}, Skipped:     0, Total:    ${b}, Duration: 412 ms - ${c.Word}.Api.Tests.dll (net8.0)`,
    gold([], [], [`Passed:   ${a}, Skipped:     1, Total:   ${a + 1}`, `Passed:    ${b}, Skipped:     0, Total:    ${b}`]), 0);
  },

  'dev2-pass-maven': c => {
    const classes = 18 + c.serial % 10;
    let total = 0;
    const rows = Array.from({ length: classes }, (_, i) => {
      const k = 3 + (c.serial + i * 7) % 11; total += k;
      return `[INFO] Running com.example.${c.word}.Module${i}Test\n[INFO] Tests run: ${k}, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.${(i * 37) % 900 + 100} s -- in com.example.${c.word}.Module${i}Test`;
    }).join('\n');
    return out('maven', 'mvn verify', `${chatter(c)}
[INFO] -------------------------------------------------------
[INFO]  T E S T S
[INFO] -------------------------------------------------------
${rows}
[INFO]
[INFO] Results:
[INFO]
[INFO] Tests run: ${total}, Failures: 0, Errors: 0, Skipped: 0
[INFO]
[INFO] --- jar:3.4.1:jar (default-jar) @ ${c.word}-core ---
[INFO] Building jar: ${c.abs(`target/${c.word}-core-1.0.${c.serial % 10}.jar`)}
[INFO] ------------------------------------------------------------------------
[INFO] BUILD SUCCESS
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  21.304 s
[INFO] Finished at: 2026-10-16T09:20:11Z
[INFO] ------------------------------------------------------------------------`,
    gold([], [], [`Tests run: ${total}, Failures: 0, Errors: 0, Skipped: 0`, 'BUILD SUCCESS']), 0);
  },
};

// Variant-level wrappers that real CI adds: per-line timestamps, colour, CRLF.
function actionsStamp(c, text) {
  return text.split('\n').map((l, i) => `2026-10-16T09:${String(20 + Math.floor(i / 60) % 30).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.${String(c.serial * 7 + i).padStart(7, '0').slice(-7)}Z ${l}`).join('\n');
}
function colour(text) {
  return text.replace(/\b(FAIL(?:ED|URE)?|ERROR|PASS(?:ED)?|error|warning|ok)\b/g, (w) =>
    /^(?:PASS|PASSED|ok)$/.test(w) ? `\x1b[32m${w}\x1b[39m` : `\x1b[31;1m${w}\x1b[0m`);
}
function wrap(family, c, task) {
  const facts = [...task.gold.expectedTests, ...task.gold.expectedFiles, ...task.gold.expectedAssertions];
  const intact = raw => facts.every(f => raw.includes(f)) && task.gold.forbiddenStrings.every(f => raw.includes(f));
  let raw = task.rawOutput;
  if (c.variant % 5 === 4 && !OWN_WRAPPER.has(family)) raw = actionsStamp(c, raw);
  if (c.variant % 7 === 6 && intact(colour(raw))) raw = colour(raw);
  if (c.variant % 9 === 8) raw = raw.replaceAll('\n', '\r\n');
  return { ...task, rawOutput: raw };
}

const tasks = Object.entries(FAMILIES).flatMap(([family, render], ordinal) =>
  Array.from({ length: PER_FAMILY }, (_, variant) => {
    const c = context(ordinal, variant);
    return { id: `dev2-test-${family}-${variant + 1}`, family, ...wrap(family, c, render(c)) };
  }));

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
const directory = path.join(HERE, 'quality/dev2');
const content = JSON.stringify(tasks, null, 2) + '\n';
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'test.json'), content);
writeFileSync(path.join(directory, 'test-manifest.json'), JSON.stringify({ tasks: tasks.length, dataSha256: sha(content), split: 'dev2',
  families: Object.fromEntries(Object.keys(FAMILIES).map(family => [family, PER_FAMILY])),
  scope: 'Development only. Second Test development set; layouts written from tool output conventions by an author who did not read either Test holdout; serials 700000+. Not a holdout.',
  trainingInputsUsed: false, sealedInputsUsed: false, holdoutInputsUsed: false }, null, 2) + '\n');
console.log(JSON.stringify({ head: 'test', split: 'dev2', tasks: tasks.length, families: Object.keys(FAMILIES).length, sha256: sha(content) }));
