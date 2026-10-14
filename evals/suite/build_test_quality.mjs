// Development and frozen holdout logs. No benchmark failures or model replies feed generation.
// Run foreground: node evals/suite/build_test_quality.mjs [--qa-only] [--dev-reachability]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.join(HERE, 'quality');
const sha = value => createHash('sha256').update(value).digest('hex');
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const gold = (tests = [], files = [], assertions = [], forbidden = []) => ({
  expectedTests: tests, expectedFiles: files, expectedAssertions: assertions, forbiddenStrings: forbidden,
});

// Vocabulary and scenario numbers are authored here; they do not import Git benchmark material.
const VOCAB = {
  development: ['voucher', 'harbor', 'tally', 'parcel', 'dispatch', 'ledger', 'receipt', 'booking'],
  holdout: ['capsule', 'orchard', 'quartz', 'prism', 'ribbon', 'cobalt', 'pollen', 'tundra'],
};
function context(split, ordinal, variant) {
  const words = VOCAB[split];
  const serial = (split === 'development' ? 120000 : 220000) + ordinal * 100 + variant;
  const word = words[(ordinal + variant) % words.length];
  const stem = `${word}_${serial}`;
  const root = variant % 2 ? `C:\\Quality Lab\\${split}\\${stem}` : `/work/quality/${split}/${stem}`;
  return {
    split, ordinal, variant, serial, word, stem, root,
    title: `${word} preserves record ${serial}`,
    want: `wanted-${word}-${serial + 37}`, got: `observed-${word}-${serial + 11}`,
    number: serial % 97 + 10, line: 17 + (variant * 13 + ordinal) % 161,
    file: (ext, dir = 'tests') => `${dir}/${stem}.${ext}`,
    absolute: (ext, dir = 'tests') => variant % 2 ? `${root}\\${dir}\\${stem}.${ext}` : `${root}/${dir}/${stem}.${ext}`,
  };
}
function noise(c, count = 18) {
  return Array.from({ length: count + c.variant % 9 }, (_, i) =>
    `[worker ${1 + i % 4}] ${c.stem}: scanned shard ${i + 1}; checksum ${c.serial + 71 * i}; cache ready (${7 + i % 5}ms)`).join('\n');
}
function stack(c) {
  return `    at evaluate (${c.root}/node_modules/runner-runtime/dispatch.js:83:6)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)`;
}
const dirtyStack = ['node_modules/runner-runtime/dispatch.js:83:6', 'node:internal/process/task_queues:105:5'];
function spec(framework, command, body, g, exitCode = 1) {
  return { framework, command, exitCode, rawOutput: body.trimEnd(), gold: g };
}
function d(framework, command, f) { return { framework, command, generate: f }; }

// Every development renderer is independent of the holdout renderers below.
const DEVELOPMENT = {
  'dev-vitest-scalar': d('vitest', 'npx vitest run', c => spec('vitest', 'npx vitest run',
    ` RUN v3.2.0 ${c.root}\n${noise(c)}\n FAIL ${c.file('ts')} > ${c.title}\nAssertionError: equality check rejected record\nExpected: "${c.want}"\nReceived: "${c.got}"\n ❯ ${c.file('ts')}:${c.line}:9\n${stack(c)}\n Test Files  1 failed (1)\n Tests  1 failed | 19 passed (20)`,
    gold([c.title], [`${c.file('ts')}:${c.line}`], [c.want, c.got], dirtyStack))),
  'dev-jest-structure': d('jest', 'npx jest --runInBand', c => spec('jest', 'npx jest --runInBand',
    `${noise(c)}\nFAIL ${c.file('test.js')}\n  ● ${c.title}\n    expect(received).toEqual(expected)\n    - Expected  - 1\n    + Received  + 1\n    -   "receipt": "${c.want}"\n    +   "receipt": "${c.got}"\n      at Object.<anonymous> (${c.absolute('test.js')}:${c.line}:12)\n${stack(c)}\nTest Suites: 1 failed, 3 passed, 4 total\nTests: 1 failed, 31 passed, 32 total`,
    gold([c.title], [`${c.stem}.test.js:${c.line}`], [c.want, c.got], dirtyStack))),
  'dev-pytest-comparison': d('pytest', 'python -m pytest -q', c => spec('pytest', 'python -m pytest -q',
    `${noise(c)}\n________________ ${c.stem}_roundtrip _________________\n    def test_${c.stem}_roundtrip():\n>       assert receipt == '${c.want}'\nE       AssertionError: assert '${c.got}' == '${c.want}'\n${c.file('py')}:${c.line}: AssertionError\n=================== short test summary info ===================\nFAILED ${c.file('py')}::test_${c.stem}_roundtrip - AssertionError\n1 failed, 12 passed in 0.43s`,
    gold([`test_${c.stem}_roundtrip`], [`${c.file('py')}:${c.line}`], [c.want, c.got]))),
  'dev-cargo-panic': d('cargo', 'cargo test --lib', c => spec('cargo', 'cargo test --lib',
    `${noise(c)}\nrunning 14 tests\ntest ${c.stem}::roundtrip ... FAILED\nfailures:\n---- ${c.stem}::roundtrip stdout ----\nthread '${c.stem}::roundtrip' panicked at ${c.file('rs', 'src')}:${c.line}:5:\nassertion \`left == right\` failed\n  left: "${c.got}"\n right: "${c.want}"\nnote: run with RUST_BACKTRACE=1 environment variable to display a backtrace\nfailures:\n    ${c.stem}::roundtrip\ntest result: FAILED. 13 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s`,
    gold([`${c.stem}::roundtrip`], [`${c.file('rs', 'src')}:${c.line}`], [c.want, c.got]))),
  'dev-go-table': d('go', 'go test ./...', c => spec('go', 'go test ./...',
    `${noise(c)}\n--- FAIL: Test${c.stem} (0.00s)\n    --- FAIL: Test${c.stem}/roundtrip (0.00s)\n        ${c.file('go')}:${c.line}: want ${c.want}, got ${c.got}\nFAIL\nFAIL example.org/${c.stem} 0.017s\n? example.org/${c.stem}/cmd [no test files]`,
    gold([`Test${c.stem}/roundtrip`], [`${c.file('go')}:${c.line}`], [c.want, c.got]))),
  'dev-tsc-assignment': d('tsc', 'npx tsc --noEmit', c => spec('tsc', 'npx tsc --noEmit',
    `${noise(c)}\n${c.file('ts', 'src')}(${c.line},7): error TS2322: Type '"${c.got}"' is not assignable to type '"${c.want}"'.\nFound 1 error.`,
    gold([], [`${c.file('ts', 'src')}(${c.line},7)`], ['TS2322', c.want, c.got]))),
  'dev-mocha-assertion': d('mocha', 'npx mocha tests', c => spec('mocha', 'npx mocha tests',
    `${noise(c)}\n  ${c.word} service\n    1) ${c.title}\n\n  7 passing (44ms)\n  1 failing\n\n  1) ${c.word} service\n       ${c.title}:\n     AssertionError: expected '${c.got}' to equal '${c.want}'\n      + expected - actual\n      -${c.got}\n      +${c.want}\n      at Context.<anonymous> (${c.absolute('js')}:${c.line}:8)\n${stack(c)}`,
    gold([c.title], [`${c.stem}.js:${c.line}`], [c.want, c.got], dirtyStack))),
  'dev-node-tap': d('node:test', 'node --test --test-reporter=tap', c => spec('node:test', 'node --test --test-reporter=tap',
    `${noise(c)}\n# Subtest: ${c.title}\nnot ok 7 - ${c.title}\n  ---\n  duration_ms: 2.731\n  location: '${c.absolute('mjs')}:${c.line}:1'\n  failureType: 'testCodeFailure'\n  error: '${c.got} was produced; ${c.want} was required'\n  code: 'ERR_ASSERTION'\n  expected: '${c.want}'\n  actual: '${c.got}'\n  operator: 'strictEqual'\n  stack: |-\n    TestContext.<anonymous> (${c.absolute('mjs')}:${c.line + 2}:10)\n  ...\n# tests 7\n# pass 6\n# fail 1`,
    gold([c.title], [`${c.stem}.mjs:${c.line + 2}`], [c.want, c.got]))),
  'dev-vitest-two-failures': d('vitest', 'npx vitest run --reporter=verbose', c => {
    const tests = [c.title, `${c.word} rejects duplicate ${c.serial}`];
    const files = [`${c.file('ts')}:${c.line}`, `${c.file('ts')}:${c.line + 4}`];
    const facts = [c.want, c.got, `duplicate-${c.serial}`, `accepted-${c.serial}`];
    return spec('vitest', 'npx vitest run --reporter=verbose', `${noise(c)}\n FAIL ${c.file('ts')} > ${tests[0]}\nAssertionError: values differ\nExpected: ${facts[0]}\nReceived: ${facts[1]}\n ❯ ${files[0]}:3\n FAIL ${c.file('ts')} > ${tests[1]}\nAssertionError: duplicate policy differs\nExpected: ${facts[2]}\nReceived: ${facts[3]}\n ❯ ${files[1]}:3\nTests 2 failed | 14 passed (16)`, gold(tests, files, facts));
  }),
  'dev-jest-inline-snapshot': d('jest', 'npx jest -u=false', c => spec('jest', 'npx jest -u=false',
    `${noise(c)}\nFAIL ${c.file('tsx')}\n  ● ${c.title}\n    expect(received).toMatchInlineSnapshot()\n    - Snapshot  - 1\n    + Received  + 1\n    - <label>${c.want}</label>\n    + <label>${c.got}</label>\n      at Object.<anonymous> (${c.absolute('tsx')}:${c.line}:16)\n${stack(c)}\nSnapshots: 1 failed, 4 passed, 5 total`,
    gold([c.title], [`${c.stem}.tsx:${c.line}`], [c.want, c.got], dirtyStack))),
  'dev-pytest-fixture-error': d('pytest', 'python -m pytest -vv', c => spec('pytest', 'python -m pytest -vv',
    `${noise(c)}\n_______________ ERROR at setup of test_${c.stem} _______________\n@pytest.fixture\ndef ${c.word}_fixture():\n>   raise RuntimeError('missing ${c.want}')\nE   RuntimeError: missing ${c.want}\n${c.file('py', 'conftest')} : ${c.line}\n${c.file('py', 'conftest')}:${c.line}: RuntimeError\nERROR ${c.file('py')}::test_${c.stem} - RuntimeError: missing ${c.want}\n1 error in 0.10s`,
    gold([`test_${c.stem}`], [`${c.file('py', 'conftest')}:${c.line}`], [`missing ${c.want}`]))),
  'dev-rust-e0308': d('rustc', 'cargo check', c => spec('rustc', 'cargo check',
    `${noise(c)}\nerror[E0308]: mismatched types\n --> ${c.file('rs', 'src')}:${c.line}:22\n  |\n${c.line} | let ${c.word}: u32 = "${c.got}";\n  |                      ^^^^^^^^^ expected \`u32\`, found \`&str\`\nerror: could not compile \`${c.stem}\` (lib) due to 1 previous error`,
    gold([], [`${c.file('rs', 'src')}:${c.line}`], ['E0308', 'expected `u32`, found `&str`', c.got]))),
  'dev-go-build': d('go', 'go test ./...', c => spec('go', 'go test ./...',
    `${noise(c)}\n# example.org/${c.stem}\n${c.file('go', 'internal')}:${c.line}:9: undefined: ${c.word}Validator${c.serial}\nFAIL example.org/${c.stem} [build failed]\nFAIL`,
    gold([], [`${c.file('go', 'internal')}:${c.line}`], [`undefined: ${c.word}Validator${c.serial}`]))),
  'dev-unittest-exception': d('unittest', 'python -m unittest -v', c => spec('unittest', 'python -m unittest -v',
    `${noise(c)}\ntest_${c.stem} (${c.word}.ReceiptTests.test_${c.stem}) ... ERROR\n======================================================================\nERROR: test_${c.stem} (${c.word}.ReceiptTests.test_${c.stem})\n----------------------------------------------------------------------\nTraceback (most recent call last):\n  File "${c.absolute('py')}", line ${c.line}, in test_${c.stem}\n    decode_record()\n  File "${c.absolute('py', 'src')}", line ${c.line + 3}, in decode_record\n    raise KeyError('${c.want}')\nKeyError: '${c.want}'\n----------------------------------------------------------------------\nRan 18 tests in 0.009s\nFAILED (errors=1)`,
    gold([`test_${c.stem}`], [`${c.stem}.py`, `line ${c.line + 3}`], [`KeyError: '${c.want}'`]))),
  'dev-java-junit': d('junit', 'mvn test', c => spec('junit', 'mvn test',
    `${noise(c)}\n[ERROR] ${c.word}ReceiptTest.${c.stem} -- Time elapsed: 0.021 s <<< FAILURE!\norg.opentest4j.AssertionFailedError: expected: <${c.want}> but was: <${c.got}>\n    at lab.${c.word}ReceiptTest.${c.stem}(${c.word}ReceiptTest.java:${c.line})\n[ERROR] Tests run: 8, Failures: 1, Errors: 0, Skipped: 0`,
    gold([`${c.word}ReceiptTest.${c.stem}`], [`${c.word}ReceiptTest.java:${c.line}`], [c.want, c.got]))),
  'dev-dotnet-xunit': d('xunit', 'dotnet test --no-restore', c => spec('xunit', 'dotnet test --no-restore',
    `${noise(c)}\n[xUnit.net 00:00:00.17] Lab.${c.word}Tests.${c.stem} [FAIL]\n  Failed Lab.${c.word}Tests.${c.stem} [8 ms]\n  Error Message:\n   Assert.Equal() Failure: Strings differ\nExpected: "${c.want}"\nActual:   "${c.got}"\n  Stack Trace:\n     at Lab.${c.word}Tests.${c.stem}() in ${c.absolute('cs')}:line ${c.line}\nFailed! - Failed: 1, Passed: 9, Skipped: 0, Total: 10`,
    gold([`Lab.${c.word}Tests.${c.stem}`], [`${c.stem}.cs`, `line ${c.line}`], [c.want, c.got]))),
  'dev-ruby-minitest': d('minitest', 'ruby test_receipts.rb', c => spec('minitest', 'ruby test_receipts.rb',
    `${noise(c)}\nRun options: --seed ${c.serial}\n# Running:\n....F.\nFinished in 0.011 seconds.\n  1) Failure:\n${c.word}Test#test_${c.stem} [${c.file('rb')}:${c.line}]:\nExpected: "${c.want}"\n  Actual: "${c.got}"\n6 runs, 11 assertions, 1 failures, 0 errors, 0 skips`,
    gold([`test_${c.stem}`], [`${c.file('rb')}:${c.line}`], [c.want, c.got]))),
  'dev-ansi-colored-failure': d('vitest', 'npx vitest run --color', c => spec('vitest', 'npx vitest run --color',
    `${noise(c)}\n\x1b[31m FAIL \x1b[0m${c.file('ts')} > ${c.title}\n\x1b[31mAssertionError: record mismatch\x1b[0m\n\x1b[32mExpected: ${c.want}\x1b[0m\n\x1b[31mReceived: ${c.got}\x1b[0m\n ❯ ${c.absolute('ts')}:${c.line}:5\n\x1b[31mTests 1 failed | 3 passed (4)\x1b[0m`,
    gold([c.title], [`${c.stem}.ts:${c.line}`], [c.want, c.got]))),
  'dev-late-diagnostic': d('jest', 'npx jest --verbose', c => spec('jest', 'npx jest --verbose',
    `${noise(c)}\n${Array.from({ length: 67 }, (_, j) => `TRACE warmed cache at support/${c.stem}_${j}.ts:${j + 10}:2; no exception`).join('\n')}\nFAIL ${c.file('ts')}\n  ● ${c.title}\nExpected: ${c.want}\nReceived: ${c.got}\n    at Object.<anonymous> (${c.absolute('ts')}:${c.line}:4)\nTest Suites: 1 failed, 7 passed, 8 total`,
    gold([c.title], [`${c.stem}.ts:${c.line}`], [c.want, c.got]))),
  'dev-passing-node-summary': d('node:test', 'node --test --test-reporter=tap', c => spec('node:test', 'node --test --test-reporter=tap',
    `${noise(c, 25)}\n${Array.from({ length: 5 + c.variant % 4 }, (_, j) => `ok ${j + 1} - ${c.stem} healthy partition ${j + 1}`).join('\n')}\n1..${5 + c.variant % 4}\n# tests ${5 + c.variant % 4}\n# suites 0\n# pass ${5 + c.variant % 4}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 12.82`,
    gold([], [], [`# tests ${5 + c.variant % 4}`, `# pass ${5 + c.variant % 4}`, '# fail 0']), 0)),
  'dev-passing-pytest-summary': d('pytest', 'python -m pytest -q', c => spec('pytest', 'python -m pytest -q',
    `${noise(c, 25)}\n........................................ [100%]\n${25 + c.variant} passed, ${c.variant % 3} skipped in 0.48s`,
    gold([], [], [`${25 + c.variant} passed`, `${c.variant % 3} skipped`]), 0)),
  'dev-launch-npm-missing-script': d('npm', 'npm test', c => spec('npm', 'npm test',
    `${noise(c)}\nnpm error Missing script: "test:${c.stem}"\nnpm error\nnpm error To see a list of scripts, run:\nnpm error   npm run\nnpm error A complete log of this run can be found in: ${c.root}/npm-cache/_logs/2026-10-14-debug-0.log`,
    gold([], [], [`Missing script: "test:${c.stem}"`], ['All tests passed.']))),
  'dev-launch-not-found': d('shell', 'missing-test-runner --run', c => spec('shell', `missing-${c.stem} --run`,
    `${noise(c)}\n${c.variant % 2 ? `missing-${c.stem} : The term 'missing-${c.stem}' is not recognized as the name of a cmdlet, function, script file, or operable program.` : `/bin/sh: 1: missing-${c.stem}: not found`}\nRunner was never started.`,
    gold([], [], [`missing-${c.stem}`, c.variant % 2 ? 'is not recognized' : ': not found'], ['All tests passed.']), 127)),
  'dev-empty-output': d('empty', 'node silent-dev-check.mjs', () => spec('empty', 'node silent-dev-check.mjs', '',
    gold([], [], [], ['All tests passed.']), 0)),
};

// Holdout templates use different failure/layout families, titles, paths and numeric namespace.
// They are authored from framework conventions, not cloned from evals/test_logs or development.
const HOLDOUT = {
  'hold-vitest-set-membership': d('vitest', 'npx vitest run --reporter=dot', c => spec('vitest', 'npx vitest run --reporter=dot',
    `${noise(c, 27)}\n⎯⎯⎯ Failed Tests 1 ⎯⎯⎯\n FAIL ${c.file('spec.ts')} > membership/${c.stem}\nAssertionError: expected Set to contain '${c.want}'\nExpected: Set { '${c.want}', 'stable-${c.serial}' }\nReceived: Set { '${c.got}', 'stable-${c.serial}' }\n ❯ ${c.absolute('spec.ts')}:${c.line}:17\n Test Files  1 failed | 8 passed (9)`,
    gold([`membership/${c.stem}`], [`${c.stem}.spec.ts:${c.line}`], [c.want, c.got]))),
  'hold-vitest-promised-error': d('vitest', 'npx vitest run async', c => spec('vitest', 'npx vitest run async',
    `${noise(c)}\n FAIL ${c.file('js')} > async transport ${c.serial}\nAssertionError: promise resolved "${c.got}" instead of rejecting\nExpected: rejection message "${c.want}"\nReceived: resolved value "${c.got}"\n ❯ ${c.file('js')}:${c.line}:6\n${stack(c)}\nTests 1 failed | 5 passed (6)`,
    gold([`async transport ${c.serial}`], [`${c.file('js')}:${c.line}`], [c.want, c.got], dirtyStack))),
  'hold-vitest-three-independent': d('vitest', 'npx vitest run --maxWorkers=1', c => {
    const tests = ['balance', 'expiry', 'origin'].map(s => `${c.stem} ${s}`);
    const files = tests.map((_, j) => `${c.file('ts')}:${c.line + 9 * j}`);
    const facts = tests.map((_, j) => `expected ${c.serial + j + 4}; received ${c.serial - j - 8}`);
    return spec('vitest', 'npx vitest run --maxWorkers=1', `${noise(c, 30)}\n${tests.map((t, j) => ` FAIL ${c.file('ts')} > ${t}\nAssertionError: ${facts[j]}\n ❯ ${files[j]}:7`).join('\n\n')}\nTests 3 failed | 11 passed (14)`, gold(tests, files, facts));
  }),
  'hold-jest-external-snapshot': d('jest', 'npx jest --ci', c => spec('jest', 'npx jest --ci',
    `${noise(c)}\nFAIL ${c.file('js')} (6.902 s)\n  ● rendered receipt ${c.serial} › snapshot serialization\n    expect(received).toMatchSnapshot(hint)\n    Snapshot name: \`rendered receipt ${c.serial} snapshot serialization 1\`\n    - Snapshot  - 1\n    + Received  + 1\n    - <output data-code="${c.want}" />\n    + <output data-code="${c.got}" />\n      at Object.toMatchSnapshot (${c.absolute('js')}:${c.line}:14)\n${stack(c)}\nSnapshots: 1 failed, 21 passed, 22 total`,
    gold([`rendered receipt ${c.serial} › snapshot serialization`], [`${c.stem}.js:${c.line}`], [c.want, c.got], dirtyStack))),
  'hold-jest-fake-clock': d('jest', 'npx jest clock --runInBand', c => spec('jest', 'npx jest clock --runInBand',
    `${noise(c)}\nFAIL ${c.file('ts')}\n  ● timer queue ${c.serial} › fires once after deadline\n    expect(jest.fn()).toHaveBeenCalledTimes(expected)\n    Expected number of calls: ${c.number}\n    Received number of calls: ${c.number + 3}\n      at Object.<anonymous> (${c.absolute('ts')}:${c.line}:23)\n${stack(c)}\nTests: 1 failed, 9 passed, 10 total`,
    gold([`timer queue ${c.serial} › fires once after deadline`], [`${c.stem}.ts:${c.line}`], [`Expected number of calls: ${c.number}`, `Received number of calls: ${c.number + 3}`], dirtyStack))),
  'hold-jest-buffer-diff': d('jest', 'npx jest packet', c => spec('jest', 'npx jest packet',
    `${noise(c)}\nFAIL ${c.file('js')}\n  ● packet checksum ${c.serial}\n    expect(received).toStrictEqual(expected)\n    - Expected  - 2\n    + Received  + 2\n      Object {\n        "type": "Buffer",\n    -   "data": [${c.number}, 2, 9],\n    +   "data": [${c.number + 1}, 2, 9],\n      }\n      at Object.<anonymous> (${c.file('js')}:${c.line}:8)\nTests: 1 failed, 2 passed, 3 total`,
    gold([`packet checksum ${c.serial}`], [`${c.file('js')}:${c.line}`], [`"data": [${c.number}, 2, 9]`, `"data": [${c.number + 1}, 2, 9]`]))),
  'hold-pytest-collection-syntax': d('pytest', 'python -m pytest --collect-only', c => spec('pytest', 'python -m pytest --collect-only',
    `${noise(c)}\n____________ ERROR collecting ${c.file('py')} ____________\nE     File "${c.absolute('py')}", line ${c.line}\nE       def ${c.stem}(\nE                     ^\nE   SyntaxError: '(' was never closed\n======================= short test summary info =======================\nERROR ${c.file('py')}\n!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!`,
    gold([], [c.file('py'), `line ${c.line}`], [`def ${c.stem}(`, "SyntaxError: '(' was never closed"]), 2)),
  'hold-pytest-parametrized-nan': d('pytest', 'python -m pytest --tb=short', c => spec('pytest', 'python -m pytest --tb=short',
    `${noise(c)}\n____________ test_measurement[${c.stem}-nan] ____________\n${c.file('py')}:${c.line}: in test_measurement\n    assert measurement == expected\nE   assert nan == ${c.number}.0\n======================= short test summary info =======================\nFAILED ${c.file('py')}::test_measurement[${c.stem}-nan] - assert nan == ${c.number}.0\n1 failed, 44 passed in 1.02s`,
    gold([`test_measurement[${c.stem}-nan]`], [`${c.file('py')}:${c.line}`], [`assert nan == ${c.number}.0`]))),
  'hold-pytest-exception-group': d('pytest', 'python -m pytest task_group', c => spec('pytest', 'python -m pytest task_group',
    `${noise(c)}\n____________ test_group_${c.stem} ____________\n  | ExceptionGroup: unhandled errors in a TaskGroup (2 sub-exceptions)\n  +-+---------------- 1 ----------------\n    | File "${c.absolute('py')}", line ${c.line}, in send\n    | ValueError: invalid capsule ${c.want}\n    +---------------- 2 ----------------\n    | File "${c.absolute('py')}", line ${c.line + 8}, in acknowledge\n    | TimeoutError: acknowledgment ${c.got} expired\n    +------------------------------------\nFAILED ${c.file('py')}::test_group_${c.stem} - ExceptionGroup\n1 failed, 4 passed in 0.88s`,
    gold([`test_group_${c.stem}`], [c.file('py'), `line ${c.line}`, `line ${c.line + 8}`], [`ValueError: invalid capsule ${c.want}`, `TimeoutError: acknowledgment ${c.got} expired`]))),
  'hold-pytest-warning-as-error': d('pytest', 'python -m pytest -W error', c => spec('pytest', 'python -m pytest -W error',
    `${noise(c)}\n____________ test_migration_${c.stem} ____________\n${c.file('py')}:${c.line}: in test_migration\n    read_legacy_packet()\n${c.file('py', 'src')}:${c.line + 2}: in read_legacy_packet\n>   warnings.warn('${c.want} is deprecated', DeprecationWarning)\nE   DeprecationWarning: ${c.want} is deprecated\nFAILED ${c.file('py')}::test_migration_${c.stem} - DeprecationWarning\n1 failed, 7 passed in 0.22s`,
    gold([`test_migration_${c.stem}`], [`${c.file('py', 'src')}:${c.line + 2}`], [`DeprecationWarning: ${c.want} is deprecated`]))),
  'hold-rust-borrow-conflict': d('rustc', 'cargo test --no-run', c => spec('rustc', 'cargo test --no-run',
    `${noise(c)}\nerror[E0502]: cannot borrow \`${c.word}\` as mutable because it is also borrowed as immutable\n  --> ${c.file('rs', 'src')}:${c.line}:5\n   |\n${c.line - 2} | let first = &${c.word}[0];\n   |              ------ immutable borrow occurs here\n${c.line} | ${c.word}.push(${c.number});\n   | ^^^^^^^^^^^^^^^^^^^^^ mutable borrow occurs here\n${c.line + 1} | println!("{first}");\n   |            ----- immutable borrow later used here\nerror: could not compile \`${c.stem}\` (lib test) due to 1 previous error`,
    gold([], [`${c.file('rs', 'src')}:${c.line}`], ['E0502', `cannot borrow \`${c.word}\` as mutable`, `${c.word}.push(${c.number})`]))),
  'hold-rust-unresolved-import': d('rustc', 'cargo check --all-targets', c => spec('rustc', 'cargo check --all-targets',
    `${noise(c)}\nerror[E0432]: unresolved import \`crate::${c.stem}::Decoder\`\n --> ${c.file('rs', 'src')}:${c.line}:5\n  |\n${c.line} | use crate::${c.stem}::Decoder;\n  |     ^^^^^^^^^^^^^^^^^^^^^^^^^ no \`Decoder\` in \`${c.stem}\`\nerror: could not compile \`capsule-core\` (lib) due to 1 previous error`,
    gold([], [`${c.file('rs', 'src')}:${c.line}`], ['E0432', `crate::${c.stem}::Decoder`, `no \`Decoder\` in \`${c.stem}\``]))),
  'hold-rust-should-panic': d('cargo', 'cargo test expected_panic', c => spec('cargo', 'cargo test expected_panic',
    `${noise(c)}\nrunning 1 test\ntest ${c.stem}::rejects_empty - should panic ... FAILED\nfailures:\n---- ${c.stem}::rejects_empty stdout ----\nnote: test did not panic as expected at ${c.file('rs')}:${c.line}:4\nfailures:\n    ${c.stem}::rejects_empty\ntest result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 9 filtered out; finished in 0.02s`,
    gold([`${c.stem}::rejects_empty`], [`${c.file('rs')}:${c.line}`], ['test did not panic as expected']))),
  'hold-go-race-detector': d('go', 'go test -race ./...', c => spec('go', 'go test -race ./...',
    `${noise(c)}\n==================\nWARNING: DATA RACE\nWrite at 0x00c00010a8 by goroutine 8:\n  example.org/${c.stem}.(*Queue).Push()\n      ${c.absolute('go', 'queue')}:${c.line} +0x84\nPrevious read at 0x00c00010a8 by goroutine 9:\n  example.org/${c.stem}.(*Queue).Len()\n      ${c.absolute('go', 'queue')}:${c.line + 11} +0x42\n==================\n--- FAIL: TestConcurrent${c.serial} (0.01s)\n    testing.go:1617: race detected during execution of test\nFAIL example.org/${c.stem} 0.049s`,
    gold([`TestConcurrent${c.serial}`], [`${c.stem}.go:${c.line}`, `${c.stem}.go:${c.line + 11}`], ['WARNING: DATA RACE', 'race detected during execution of test']))),
  'hold-go-fuzz-regression': d('go', 'go test -run FuzzDecode ./...', c => spec('go', 'go test -run FuzzDecode ./...',
    `${noise(c)}\n--- FAIL: FuzzDecode${c.serial} (0.00s)\n    --- FAIL: FuzzDecode${c.serial}/${c.stem} (0.00s)\n        ${c.file('go')}:${c.line}: round trip mismatch: got "${c.got}" want "${c.want}"\n    Failing input written to testdata/fuzz/FuzzDecode${c.serial}/${c.stem}\n    To re-run:\n    go test -run=FuzzDecode${c.serial}/${c.stem}\nFAIL example.org/fuzzpack 0.032s`,
    gold([`FuzzDecode${c.serial}/${c.stem}`], [`${c.file('go')}:${c.line}`], [c.want, c.got]))),
  'hold-go-recovered-panic': d('go', 'go test -v ./internal', c => spec('go', 'go test -v ./internal',
    `${noise(c)}\n=== RUN   TestBoundary${c.serial}\n--- FAIL: TestBoundary${c.serial} (0.00s)\npanic: runtime error: index out of range [${c.number}] with length ${c.number - 1} [recovered]\npanic: runtime error: index out of range [${c.number}] with length ${c.number - 1}\nexample.org/${c.stem}.Decode(...)\n    ${c.absolute('go', 'internal')}:${c.line}\nexample.org/${c.stem}.TestBoundary${c.serial}(0xc000150000)\n    ${c.absolute('go')}:${c.line + 5} +0x91\nFAIL example.org/${c.stem} 0.009s`,
    gold([`TestBoundary${c.serial}`], [`${c.stem}.go:${c.line}`], [`index out of range [${c.number}] with length ${c.number - 1}`]))),
  'hold-tsc-union-property': d('tsc', 'npx tsc -p tsconfig.build.json', c => spec('tsc', 'npx tsc -p tsconfig.build.json',
    `${noise(c)}\n${c.file('ts', 'src')}:${c.line}:18 - error TS2339: Property '${c.word}Code${c.serial}' does not exist on type 'Result'.\n  Property '${c.word}Code${c.serial}' does not exist on type '{ ok: false; reason: string; }'.\n\n${c.line}   return result.${c.word}Code${c.serial};\n                   ~~~~~~~~~~~~~~~~~\nFound 1 error in ${c.file('ts', 'src')}:${c.line}`, 
    gold([], [`${c.file('ts', 'src')}:${c.line}`], ['TS2339', `Property '${c.word}Code${c.serial}' does not exist on type 'Result'`]))),
  'hold-tsc-generic-constraint': d('tsc', 'npx tsc --pretty false --noEmit', c => spec('tsc', 'npx tsc --pretty false --noEmit',
    `${noise(c)}\n${c.file('ts', 'lib')}(${c.line},31): error TS2344: Type '${c.word}Value${c.serial}' does not satisfy the constraint '{ id: string; }'.\n  Types of property 'id' are incompatible.\n    Type 'number' is not assignable to type 'string'.\nFound 1 error.`,
    gold([], [`${c.file('ts', 'lib')}(${c.line},31)`], ['TS2344', `Type '${c.word}Value${c.serial}'`, "Type 'number' is not assignable to type 'string'"]))),
  'hold-tsc-module-resolution': d('tsc', 'npx tsc --module nodenext', c => spec('tsc', 'npx tsc --module nodenext',
    `${noise(c)}\n${c.file('ts', 'src')}(${c.line},24): error TS2307: Cannot find module './${c.stem}-codec.js' or its corresponding type declarations.\nFound 1 error.`,
    gold([], [`${c.file('ts', 'src')}(${c.line},24)`], ['TS2307', `Cannot find module './${c.stem}-codec.js'`]))),
  'hold-mocha-before-hook': d('mocha', 'npx mocha --reporter spec', c => spec('mocha', 'npx mocha --reporter spec',
    `${noise(c)}\n  ${c.stem} persistence\n    1) "before each" hook for "commits valid capsule"\n\n  0 passing (19ms)\n  1 failing\n\n  1) ${c.stem} persistence\n       "before each" hook for "commits valid capsule":\n     Error: fixture database ${c.want} unavailable\n      at Context.<anonymous> (${c.absolute('js')}:${c.line}:11)\n${stack(c)}`,
    gold([`${c.stem} persistence`, '"before each" hook for "commits valid capsule"'], [`${c.stem}.js:${c.line}`], [`fixture database ${c.want} unavailable`], dirtyStack))),
  'hold-mocha-timeout': d('mocha', 'npx mocha --timeout 250', c => spec('mocha', 'npx mocha --timeout 250',
    `${noise(c)}\n  1 passing (14ms)\n  1 failing\n\n  1) delivery ${c.serial}\n       waits for acknowledgment ${c.stem}:\n     Error: Timeout of 250ms exceeded. For async tests and hooks, ensure "done()" is called; if returning a Promise, ensure it resolves. (${c.absolute('js')})\n      at listOnTimeout (node:internal/timers:588:17)\n      at process.processTimers (node:internal/timers:523:7)`,
    gold([`delivery ${c.serial}`, `waits for acknowledgment ${c.stem}`], [`${c.stem}.js`], ['Timeout of 250ms exceeded']))),
  'hold-node-cancelled-parent': d('node:test', 'node --test --test-reporter=spec', c => spec('node:test', 'node --test --test-reporter=spec',
    `${noise(c)}\n✖ ${c.stem} owns child lifetime (5.01ms)\n  'Promise resolution is still pending but the event loop has already resolved'\nℹ tests 3\nℹ pass 2\nℹ fail 0\nℹ cancelled 1\n✖ failing tests:\ntest at ${c.file('mjs')}:${c.line}:1\n✖ ${c.stem} owns child lifetime (5.01ms)\n  Error [ERR_TEST_FAILURE]: Promise resolution is still pending but the event loop has already resolved\n    at TestContext.<anonymous> (${c.absolute('mjs')}:${c.line + 2}:4)\n  failureType: 'cancelledByParent'`,
    gold([`${c.stem} owns child lifetime`], [`${c.stem}.mjs:${c.line + 2}`], ['Promise resolution is still pending', "failureType: 'cancelledByParent'"]))),
  'hold-unittest-subtests': d('unittest', 'python -m unittest discover -v', c => spec('unittest', 'python -m unittest discover -v',
    `${noise(c)}\ntest_rows (${c.stem}.TableTests.test_rows) ...\n  test_rows (${c.stem}.TableTests.test_rows) (row='${c.word}') ... FAIL\n======================================================================\nFAIL: test_rows (${c.stem}.TableTests.test_rows) (row='${c.word}')\n----------------------------------------------------------------------\nTraceback (most recent call last):\n  File "${c.absolute('py')}", line ${c.line}, in test_rows\n    self.assertEqual(actual, expected)\nAssertionError: '${c.got}' != '${c.want}'\n- ${c.got}\n+ ${c.want}\n----------------------------------------------------------------------\nRan 5 tests in 0.003s\nFAILED (failures=1)`,
    gold([`${c.stem}.TableTests.test_rows`, `row='${c.word}'`], [`${c.stem}.py`, `line ${c.line}`], [c.want, c.got]))),
  'hold-junit-parameterized': d('junit', 'mvn -q test', c => spec('junit', 'mvn -q test',
    `${noise(c)}\n[ERROR] Tests run: 25, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.48 s <<< FAILURE! -- in lab.CapsuleTests\n[ERROR] lab.CapsuleTests.decode(String)[${c.variant + 1}] -- Time elapsed: 0.01 s <<< FAILURE!\norg.opentest4j.AssertionFailedError: ${c.stem} payload length ==> expected: <${c.number}> but was: <${c.number + 6}>\n    at lab.CapsuleTests.decode(CapsuleTests.java:${c.line})\n[ERROR]   CapsuleTests.decode:${c.line} ${c.stem} payload length`,
    gold([`lab.CapsuleTests.decode(String)[${c.variant + 1}]`], [`CapsuleTests.java:${c.line}`], [`${c.stem} payload length`, `expected: <${c.number}> but was: <${c.number + 6}>`]))),
  'hold-nunit-tolerance': d('nunit', 'dotnet test --logger console', c => spec('nunit', 'dotnet test --logger console',
    `${noise(c)}\n  Failed ${c.stem}_FloatingThreshold [12 ms]\n  Error Message:\n     Expected: ${c.number}.5d +/- 0.01d\n  But was:  ${c.number}.8d\n  Off by:   0.3d\n  Stack Trace:\n     at Lab.ThresholdTests.${c.stem}_FloatingThreshold() in ${c.absolute('cs')}:line ${c.line}\nFailed! - Failed: 1, Passed: 16, Skipped: 1, Total: 18`,
    gold([`${c.stem}_FloatingThreshold`], [`${c.stem}.cs`, `line ${c.line}`], [`Expected: ${c.number}.5d +/- 0.01d`, `But was:  ${c.number}.8d`]))),
  'hold-rspec-array-order': d('rspec', 'bundle exec rspec --format documentation', c => spec('rspec', 'bundle exec rspec --format documentation',
    `${noise(c)}\nFailures:\n  1) ${c.stem} ordered dispatch keeps priority\n     Failure/Error: expect(queue).to eq(["${c.want}", "tail"])\n       expected: ["${c.want}", "tail"]\n            got: ["tail", "${c.got}"]\n       (compared using ==)\n     # ${c.file('rb', 'spec')}:${c.line}:in \`block (2 levels) in <top (required)>\`\nFinished in 0.04 seconds\n21 examples, 1 failure`,
    gold([`${c.stem} ordered dispatch keeps priority`], [`${c.file('rb', 'spec')}:${c.line}`], [c.want, c.got]))),
  'hold-phpunit-provider': d('phpunit', 'vendor/bin/phpunit', c => spec('phpunit', 'vendor/bin/phpunit',
    `${noise(c)}\nThere was 1 failure:\n1) CapsuleTest::testDecode with data set "${c.stem}" ('${c.got}', '${c.want}')\nFailed asserting that two strings are identical.\n--- Expected\n+++ Actual\n@@ @@\n-'${c.want}'\n+'${c.got}'\n${c.absolute('php')}:${c.line}\nFAILURES!\nTests: 17, Assertions: 24, Failures: 1.`,
    gold([`CapsuleTest::testDecode with data set "${c.stem}"`], [`${c.stem}.php:${c.line}`], [c.want, c.got]))),
  'hold-swift-xctest': d('xctest', 'swift test', c => spec('xctest', 'swift test',
    `${noise(c)}\nTest Case '-[CapsuleTests.${c.stem}Tests testDecode]' started.\n${c.absolute('swift')}:${c.line}: error: -[CapsuleTests.${c.stem}Tests testDecode] : XCTAssertEqual failed: ("${c.got}") is not equal to ("${c.want}")\nTest Case '-[CapsuleTests.${c.stem}Tests testDecode]' failed (0.006 seconds).\nTest Suite 'All tests' failed\nExecuted 31 tests, with 1 failure (0 unexpected) in 0.019 seconds`,
    gold([`${c.stem}Tests testDecode`], [`${c.stem}.swift:${c.line}`], [c.want, c.got]))),
  'hold-gtest-predicate': d('gtest', './build/capsule_tests', c => spec('gtest', './build/capsule_tests',
    `${noise(c)}\n[ RUN      ] Capsule.${c.stem}\n${c.file('cpp')}:${c.line}: Failure\nValue of: packet.IsValid()\n  Actual: false\nExpected: true\npacket ${c.want} rejected by verifier\n[  FAILED  ] Capsule.${c.stem} (0 ms)\n[==========] 13 tests from 2 test suites ran. (4 ms total)\n[  PASSED  ] 12 tests.\n[  FAILED  ] 1 test, listed below:\n[  FAILED  ] Capsule.${c.stem}`, 
    gold([`Capsule.${c.stem}`], [`${c.file('cpp')}:${c.line}`], ['Actual: false', 'Expected: true', `packet ${c.want} rejected`]))),
  'hold-clang-undeclared': d('clang', 'clang++ -fsyntax-only src/capsule.cpp', c => spec('clang', 'clang++ -fsyntax-only src/capsule.cpp',
    `${noise(c)}\n${c.file('cpp', 'src')}:${c.line}:14: error: use of undeclared identifier '${c.word}Encoder${c.serial}'\n${c.line} |   auto bytes = ${c.word}Encoder${c.serial}(packet);\n   |                ^\n1 error generated.`,
    gold([], [`${c.file('cpp', 'src')}:${c.line}`], [`use of undeclared identifier '${c.word}Encoder${c.serial}'`]))),
  'hold-linker-symbol': d('linker', 'cmake --build build', c => spec('linker', 'cmake --build build',
    `${noise(c)}\n[ 92%] Linking CXX executable capsule_tests\n/usr/bin/ld: CMakeFiles/capsule.dir/${c.stem}.cpp.o: in function \`verify_${c.stem}()\`:\n${c.file('cpp', 'src')}:${c.line}: undefined reference to \`decode_${c.stem}(char const*)\`\ncollect2: error: ld returned 1 exit status\ngmake[2]: *** [CMakeFiles/capsule.dir/build.make:91: capsule_tests] Error 1`,
    gold([], [`${c.file('cpp', 'src')}:${c.line}`], [`undefined reference to \`decode_${c.stem}(char const*)\``]))),
  'hold-playwright-timeout': d('playwright', 'npx playwright test', c => spec('playwright', 'npx playwright test',
    `${noise(c)}\n  1) [chromium] › ${c.file('ts')}:${c.line}:1 › ${c.stem} checkout › confirms capsule\n    Error: expect(locator).toHaveText(expected) failed\n    Locator: getByTestId('receipt-${c.serial}')\n    Expected string: "${c.want}"\n    Received string: "${c.got}"\n    Timeout: 5000ms\n    Call log:\n      - Expect "toHaveText" with timeout 5000ms\n      - waiting for getByTestId('receipt-${c.serial}')\n      at ${c.file('ts')}:${c.line + 7}:20\n  1 failed\n  4 passed (8.2s)`,
    gold([`${c.stem} checkout › confirms capsule`], [`${c.file('ts')}:${c.line + 7}`], [c.want, c.got, 'Timeout: 5000ms']))),
  'hold-cucumber-step': d('cucumber', 'npx cucumber-js', c => spec('cucumber', 'npx cucumber-js',
    `${noise(c)}\nFailures:\n1) Scenario: restore ${c.stem} # features/${c.stem}.feature:${c.line}\n   ✔ Given a capsule exists\n   ✖ Then its label is "${c.want}" # steps/${c.stem}.js:${c.line + 1}\n       AssertionError: expected '${c.got}' to equal '${c.want}'\n           at World.<anonymous> (steps/${c.stem}.js:${c.line + 3}:11)\n7 scenarios (1 failed, 6 passed)\n21 steps (1 failed, 20 passed)\n0m00.144s`,
    gold([`Scenario: restore ${c.stem}`], [`steps/${c.stem}.js:${c.line + 3}`], [c.want, c.got]))),
  'hold-bats-status': d('bats', 'bats test/', c => spec('bats', 'bats test/',
    `${noise(c)}\n1..7\nnot ok 4 ${c.stem} rejects corrupt capsule\n# (in test file tests/${c.stem}.bats, line ${c.line})\n#   \`[ "$status" -eq ${c.number} ]' failed\n# expected exit status ${c.number}, got ${c.number + 2}\n# output: corrupt capsule ${c.got}\nok 5 healthy capsule returns zero\n7 tests, 1 failure`,
    gold([`${c.stem} rejects corrupt capsule`], [`tests/${c.stem}.bats`, `line ${c.line}`], [`expected exit status ${c.number}, got ${c.number + 2}`, `corrupt capsule ${c.got}`]))),
  'hold-late-interleaved-failure': d('pytest', 'python -m pytest --capture=tee-sys', c => spec('pytest', 'python -m pytest --capture=tee-sys',
    `${noise(c, 35)}\n${Array.from({ length: 74 }, (_, j) => `[trace/${c.stem}] observed source support/trace_${c.serial}_${j}.py:${j + 4}:8 during healthy warmup`).join('\n')}\n________________ test_final_${c.stem} _________________\n${c.file('py')}:${c.line}: in test_final\n>   assert decoded == '${c.want}'\nE   AssertionError: assert '${c.got}' == '${c.want}'\nFAILED ${c.file('py')}::test_final_${c.stem}\n1 failed, 70 passed in 2.18s`,
    gold([`test_final_${c.stem}`], [`${c.file('py')}:${c.line}`], [c.want, c.got]))),
  'hold-ansi-nested-diff': d('jest', 'npx jest --colors', c => spec('jest', 'npx jest --colors',
    `${noise(c, 28)}\n\x1b[31mFAIL\x1b[0m ${c.file('jsx')}\n  \x1b[31m●\x1b[0m nested component ${c.stem}\n    expect(received).toEqual(expected)\n    \x1b[32m- Expected  - 1\x1b[0m\n    \x1b[31m+ Received  + 1\x1b[0m\n    \x1b[32m-    "aria-label": "${c.want}",\x1b[0m\n    \x1b[31m+    "aria-label": "${c.got}",\x1b[0m\n      at renderTree (${c.absolute('jsx')}:${c.line}:9)\n${stack(c)}\n\x1b[31mTests: 1 failed\x1b[0m`,
    gold([`nested component ${c.stem}`], [`${c.stem}.jsx:${c.line}`], [c.want, c.got], dirtyStack))),
  'hold-passing-ctest': d('ctest', 'ctest --test-dir build --output-on-failure', c => spec('ctest', 'ctest --test-dir build --output-on-failure',
    `${noise(c, 33)}\nTest project ${c.root}/build\n${Array.from({ length: 4 + c.variant % 4 }, (_, j) => `${j + 1}/${4 + c.variant % 4} Test #${j + 1}: ${c.stem}_${j} ........... Passed 0.01 sec`).join('\n')}\n100% tests passed, 0 tests failed out of ${4 + c.variant % 4}\nTotal Test time (real) = 0.04 sec`,
    gold([], [], [`100% tests passed, 0 tests failed out of ${4 + c.variant % 4}`]), 0)),
  'hold-passing-unittest-count': d('unittest', 'python -m unittest discover', c => spec('unittest', 'python -m unittest discover',
    `${noise(c, 29)}\n.....................................\n----------------------------------------------------------------------\nRan ${33 + c.variant} tests in 0.054s\n\nOK (skipped=${c.variant % 4})`,
    gold([], [], [`Ran ${33 + c.variant} tests`, `OK (skipped=${c.variant % 4})`]), 0)),
  'hold-launch-python-module': d('python', 'python -m capsule_tests', c => spec('python', `python -m ${c.stem}_tests`,
    `${noise(c, 28)}\n${c.variant % 2 ? 'C:\\Python313\\python.exe' : '/usr/bin/python3'}: No module named ${c.stem}_tests`,
    gold([], [], [`No module named ${c.stem}_tests`], ['All tests passed.']))),
  'hold-launch-go-invalid-module': d('go', 'go test ./...', c => spec('go', 'go test ./...',
    `${noise(c, 22)}\ngo: errors parsing go.mod:\ngo.mod:${c.line}: invalid go version '${c.serial}.banana': must match format 1.23.0\nNo packages were tested.`,
    gold([], [`go.mod:${c.line}`], [`invalid go version '${c.serial}.banana'`], ['All tests passed.']))),
  'hold-empty-no-suite': d('empty', 'node silent-holdout-check.mjs', () => spec('empty', 'node silent-holdout-check.mjs', '',
    gold([], [], [], ['All tests passed.']), 0)),
};

function authored(split, renderers, target) {
  const entries = Object.entries(renderers);
  assert.equal(entries.length, split === 'development' ? 24 : 41);
  const repetitions = Math.floor((target - 1) / (entries.length - 1));
  let remaining = target - entries.reduce((sum, [family]) => sum + (family.includes('empty') ? 1 : repetitions), 0);
  return entries.flatMap(([family, renderer], ordinal) => {
    const extra = remaining > 0 && !family.includes('empty') ? 1 : 0;
    remaining -= extra;
    const n = family.includes('empty') ? 1 : repetitions + extra;
    return Array.from({ length: n }, (_, variant) => ({
      id: `${split}-test-${family}-${variant + 1}`, family,
      ...renderer.generate(context(split, ordinal, variant)),
    }));
  });
}

const NODE_HOLD = [
  ['regex', (n, msg) => `assert.match('capsule-${n}', /^orchard-/, ${JSON.stringify(msg)});`],
  ['negative-regex', (n, msg) => `assert.doesNotMatch('quartz-${n}', /quartz/, ${JSON.stringify(msg)});`],
  ['missing-throw', (n, msg) => `assert.throws(() => 'prism-${n}', TypeError, ${JSON.stringify(msg)});`],
  ['wrong-error-class', (n, msg) => `assert.throws(() => { throw new RangeError('ribbon-${n}'); }, TypeError, ${JSON.stringify(msg)});`],
  ['rejection-pattern', (n, msg) => `await assert.rejects(Promise.reject(new Error('cobalt-${n}')), /pollen/, ${JSON.stringify(msg)});`],
  ['unexpected-rejection', (n, msg) => `await assert.doesNotReject(Promise.reject(new Error('tundra-${n}')), ${JSON.stringify(msg)});`],
  ['map-deep-equality', (n, msg) => `assert.deepStrictEqual(new Map([['capsule', ${n}]]), new Map([['capsule', ${n + 7}]]), ${JSON.stringify(msg)});`],
  ['set-deep-equality', (n, msg) => `assert.deepStrictEqual(new Set(['orchard-${n}']), new Set(['quartz-${n}']), ${JSON.stringify(msg)});`],
  ['typed-buffer-equality', (n, msg) => `assert.deepStrictEqual(new Uint8Array([${n % 128}, 4]), new Uint8Array([${n % 128 + 1}, 4]), ${JSON.stringify(msg)});`],
  ['nested-error-cause', (n, msg) => `assert.deepStrictEqual({ metadata: { code: 'prism-${n}', retries: 2 } }, { metadata: { code: 'ribbon-${n}', retries: 3 } }, ${JSON.stringify(msg)});`],
];
const PY_HOLD = [
  ['regex-mismatch', (n, msg) => `self.assertRegex('capsule-${n}', r'^orchard-', msg=${JSON.stringify(msg)})`],
  ['negative-regex', (n, msg) => `self.assertNotRegex('quartz-${n}', r'quartz', msg=${JSON.stringify(msg)})`],
  ['multiplicity', (n, msg) => `self.assertCountEqual(['prism', 'prism', ${n}], ['prism', ${n}], msg=${JSON.stringify(msg)})`],
  ['numeric-tolerance', (n, msg) => `self.assertAlmostEqual(${n}.12, ${n}.29, places=2, msg=${JSON.stringify(msg)})`],
  ['identity', (n, msg) => `self.assertIs(['ribbon-${n}'], ['ribbon-${n}'], msg=${JSON.stringify(msg)})`],
  ['subset-membership', (n, msg) => `self.assertIn('cobalt-${n}', {'pollen-${n}': 7}, msg=${JSON.stringify(msg)})`],
  ['ordering', (n, msg) => `self.assertLess(${n + 8}, ${n}, msg=${JSON.stringify(msg)})`],
  ['dictionary-diff', (n, msg) => `self.assertDictEqual({'capsule': ${n}, 'nested': {'x': 'orchard'}}, {'capsule': ${n + 9}, 'nested': {'x': 'quartz'}}, msg=${JSON.stringify(msg)})`],
  ['tuple-diff', (n, msg) => `self.assertTupleEqual(('prism-${n}', 4), ('ribbon-${n}', 7), msg=${JSON.stringify(msg)})`],
  ['unexpected-equality', (n, msg) => `self.assertNotEqual('tundra-${n}', 'tundra-${n}', msg=${JSON.stringify(msg)})`],
];

function captureFact(split, framework, scenario, n) {
  if (split === 'development') {
    return framework === 'node' ? [
      `strict equality required ${n + 7}; actual ${n}`,
      `sequence required ['harbor', ${n + 7}]; actual ['voucher', ${n}]`,
      'truthiness required true; actual false',
      `successful equality ${n} equals ${n}`,
    ][scenario] : [
      `string required harbor-${n}; actual voucher-${n}`,
      `list required [${n + 7}, 'parcel']; actual [${n}, 'tally']`,
      `instance required str; actual integer ${n}`,
      `successful equality ${n} equals ${n}`,
    ][scenario];
  }
  return framework === 'node' ? [
    `regex required /^orchard-/; actual capsule-${n}`,
    `regex /quartz/ forbidden; actual quartz-${n} matched`,
    `TypeError required; actual callback returned prism-${n}`,
    `TypeError required; actual RangeError ribbon-${n}`,
    `rejection matching /pollen/ required; actual Error cobalt-${n}`,
    `resolved promise required; actual rejected Error tundra-${n}`,
    `Map capsule required ${n + 7}; actual ${n}`,
    `Set required quartz-${n}; actual orchard-${n}`,
    `Uint8Array required [${n % 128 + 1},4]; actual [${n % 128},4]`,
    `metadata required ribbon-${n} retries 3; actual prism-${n} retries 2`,
  ][scenario] : [
    `regex required ^orchard-; actual capsule-${n}`,
    `regex quartz forbidden; actual quartz-${n} matched`,
    `one prism required; actual two prism values with ${n}`,
    `two-place equality required ${n}.29; actual ${n}.12`,
    `same object required; actual distinct lists containing ribbon-${n}`,
    `cobalt-${n} membership required; actual sole key pollen-${n}`,
    `value less than ${n} required; actual ${n + 8}`,
    `dict required capsule ${n + 9} nested quartz; actual capsule ${n} nested orchard`,
    `tuple required ribbon-${n} and 7; actual prism-${n} and 4`,
    `distinct strings required; actual both strings tundra-${n}`,
  ][scenario];
}

function captureSource(split, framework, scenario, repetition) {
  const n = (split === 'development' ? 310000 : 410000) + scenario * 100 + repetition;
  const basename = `${split}_${framework}_${scenario}_${repetition}.${framework === 'node' ? 'mjs' : 'py'}`;
  const name = `${split}_${framework}_case_${n}`;
  const msg = `case ${n}: ${captureFact(split, framework, scenario, n)}`;
  let lines;
  let expectedTests = [name];
  let expectedAssertions = [msg];
  let failureLine;
  if (framework === 'node') {
    lines = ["import test from 'node:test';", "import assert from 'node:assert/strict';", '',
      `test(${JSON.stringify(name)}, async () => {`,
      `  for (let i = 0; i < ${19 + repetition * 4}; i++) console.log('capture ${n} shard', i, 'verified; checksum', ${n} + i);`];
    if (split === 'development') {
      const checks = [
        `assert.strictEqual(${n}, ${n + 7}, ${JSON.stringify(msg)});`,
        `assert.deepStrictEqual(['voucher', ${n}], ['harbor', ${n + 7}], ${JSON.stringify(msg)});`,
        `assert.ok(false, ${JSON.stringify(msg)});`,
        `assert.strictEqual(${n}, ${n});`,
      ];
      failureLine = lines.length + 1;
      lines.push(`  ${checks[scenario]}`, '});');
      if (scenario === 3) { expectedTests = []; expectedAssertions = ['# tests 1', '# pass 1', '# fail 0']; }
    } else {
      failureLine = lines.length + 1;
      lines.push(`  ${NODE_HOLD[scenario][1](n, msg)}`, '});');
    }
  } else {
    lines = ['import unittest', '', 'class CapturedQuality(unittest.TestCase):',
      `    def test_${name}(self):`,
      `        for shard in range(${19 + repetition * 4}):`,
      `            print('capture ${n} shard', shard, 'verified; checksum', ${n} + shard)`];
    if (split === 'development') {
      const checks = [
        `self.assertEqual('voucher-${n}', 'harbor-${n}', msg=${JSON.stringify(msg)})`,
        `self.assertListEqual([${n}, 'tally'], [${n + 7}, 'parcel'], msg=${JSON.stringify(msg)})`,
        `self.assertIsInstance(${n}, str, msg=${JSON.stringify(msg)})`,
        `self.assertEqual(${n}, ${n})`,
      ];
      failureLine = lines.length + 1;
      lines.push(`        ${checks[scenario]}`);
      if (scenario === 3) { expectedTests = []; expectedAssertions = ['Ran 1 test', 'OK']; }
    } else {
      failureLine = lines.length + 1;
      lines.push(`        ${PY_HOLD[scenario][1](n, msg)}`);
    }
    lines.push('', "if __name__ == '__main__':", `    unittest.main(verbosity=${split === 'development' ? 1 : 2})`);
    if (expectedTests.length) expectedTests = [`test_${name}`];
  }
  return {
    basename, source: `${lines.join('\n')}\n`, name,
    family: `${split === 'development' ? 'dev' : 'hold'}-captured-${framework}-${split === 'development' ? ['scalar', 'sequence', 'predicate', 'passing'][scenario] : (framework === 'node' ? NODE_HOLD : PY_HOLD)[scenario][0]}`,
    framework: framework === 'node' ? 'node:test' : 'unittest',
    args: framework === 'node' ? ['--test', `--test-reporter=${split === 'development' ? 'tap' : 'spec'}`, basename] : [basename],
    expectedExit: split === 'development' && scenario === 3 ? 0 : 1,
    gold: gold(expectedTests, expectedTests.length ? [framework === 'node' ? `${basename}:${failureLine}` : basename, ...(framework === 'python' ? [`line ${failureLine}`] : [])] : [], expectedAssertions,
      ['node:internal/test_runner', 'site-packages/']),
  };
}

function childEnvironment() {
  const env = { PYTHONIOENCODING: 'utf-8', PYTHONHASHSEED: '0', NO_COLOR: '1', NODE_DISABLE_COLORS: '1' };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  return env;
}

// Only source created by captureSource is executable. No task.command is ever executed.
function capture(split) {
  const cacheFile = path.join(DEST, split, 'test-real-captures.json');
  if (existsSync(cacheFile)) {
    const cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
    for (const p of cache.provenance) {
      const expected = captureSource(split, p.sourceKind, p.scenario, p.repetition);
      assert.equal(p.sourceSha256, sha(expected.source), 'Changed capture source requires a new independently versioned corpus');
      assert.equal(p.outputSha256, sha(cache.tasks.find(t => t.id === p.taskId).rawOutput));
    }
    return cache;
  }
  const started = Date.now();
  const tempBase = realpathSync(os.tmpdir());
  const tempRoot = mkdtempSync(path.join(tempBase, 'hydra-quality-capture-'));
  const relative = path.relative(tempBase, realpathSync(tempRoot));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  const tasks = [], provenance = [];
  try {
    const version = spawnSync('python', ['--version'], { encoding: 'utf8', timeout: 6000, env: childEnvironment() });
    assert.equal(version.status, 0, 'Python is required for authentic unittest capture');
    for (const sourceKind of ['node', 'python']) {
      const scenarios = split === 'development' ? 4 : 10;
      const repetitions = split === 'development' ? 1 : 2;
      for (let scenario = 0; scenario < scenarios; scenario++) for (let repetition = 0; repetition < repetitions; repetition++) {
        assert(Date.now() - started < 120000, 'Capture exceeded 120-second total foreground bound');
        const fixture = captureSource(split, sourceKind, scenario, repetition);
        const cwd = path.join(tempRoot, `${sourceKind}-${scenario}-${repetition}`);
        mkdirSync(cwd);
        writeFileSync(path.join(cwd, fixture.basename), fixture.source);
        const begin = Date.now();
        const executable = sourceKind === 'node' ? process.execPath : 'python';
        const result = spawnSync(executable, fixture.args, {
          cwd, encoding: 'utf8', timeout: 6000, maxBuffer: 512 * 1024, shell: false, env: childEnvironment(),
        });
        assert(!result.error, `Capture launch/timeout failed: ${fixture.basename}`);
        assert.equal(result.status, fixture.expectedExit, `Unexpected capture exit: ${fixture.basename}`);
        const replaceRoot = value => value.split(cwd).join(`/captured/${split}/${sourceKind}-${scenario}-${repetition}`)
          .split(cwd.replaceAll('\\', '/')).join(`/captured/${split}/${sourceKind}-${scenario}-${repetition}`);
        const rawOutput = replaceRoot((result.stdout + (result.stderr ? `\n${result.stderr}` : '')).trimEnd());
        const id = `${split}-test-${fixture.family}-${repetition + 1}`;
        tasks.push({ id, family: fixture.family, framework: fixture.framework,
          command: `${sourceKind === 'node' ? 'node' : 'python'} ${fixture.args.join(' ')}`,
          exitCode: result.status, rawOutput, gold: fixture.gold });
        provenance.push({ taskId: id, sourceKind, scenario, repetition, basename: fixture.basename,
          source: fixture.source, sourceSha256: sha(fixture.source), outputSha256: sha(rawOutput),
          executable: sourceKind === 'node' ? 'node' : 'python', argv: fixture.args,
          runtimeVersion: sourceKind === 'node' ? process.version : (version.stdout + version.stderr).trim(),
          exitCode: result.status, timeoutMs: 6000, elapsedMs: Date.now() - begin,
          normalizedPaths: 'Only the verified capture directory is replaced by /captured/<split>/<fixture>; no failure text is rewritten.',
        });
      }
    }
  } finally {
    // Resolve the exact directory and check containment immediately before recursive cleanup.
    const resolved = realpathSync(tempRoot);
    const within = path.relative(tempBase, resolved);
    assert(within && !within.startsWith('..') && !path.isAbsolute(within) && path.basename(resolved).startsWith('hydra-quality-capture-'));
    rmSync(resolved, { recursive: true });
  }
  const cache = { version: 1, split, bound: { subprocessMs: 6000, totalMs: 120000 }, tasks, provenance };
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, stable(cache));
  return cache;
}

function qa(split, tasks) {
  assert.equal(tasks.length, split === 'development' ? 200 : 1000);
  const ids = new Set(), outputs = new Set();
  for (const t of tasks) {
    assert(!ids.has(t.id), `Duplicate task id ${t.id}`); ids.add(t.id);
    if (t.rawOutput) { assert(!outputs.has(t.rawOutput), `Duplicate raw log ${t.id}`); outputs.add(t.rawOutput); }
    assert(t.family.startsWith(split === 'development' ? 'dev-' : 'hold-'));
    assert.equal(typeof t.command, 'string'); assert(Number.isInteger(t.exitCode));
    assert.equal(typeof t.rawOutput, 'string');
    const required = [...t.gold.expectedTests, ...t.gold.expectedFiles, ...t.gold.expectedAssertions];
    assert(required.length <= 12, `Gold exceeds twelve independently useful facts: ${t.id}`);
    for (const fact of required) {
      assert(fact && t.rawOutput.includes(fact), `Gold not present in independently created raw source/log: ${t.id}: ${fact}`);
    }
    for (const forbidden of t.gold.forbiddenStrings) assert(forbidden && !required.some(f => f.includes(forbidden)));
    if (t.exitCode !== 0) assert(required.length, `Failure has no substantive gold: ${t.id}`);
  }
  const failing = tasks.filter(t => t.exitCode !== 0);
  const longFailing = failing.filter(t => t.rawOutput.length > 800);
  assert(longFailing.length / failing.length > .9, 'Failing-log coverage must primarily exceed pass-through threshold');
  return { tasks: tasks.length, uniqueNonemptyLogs: outputs.size, failing: failing.length,
    failingOver800Chars: longFailing.length, shortOrEmpty: tasks.filter(t => t.rawOutput.length <= 800).length,
    empty: tasks.filter(t => !t.rawOutput).length,
    windowsPaths: tasks.filter(t => /[A-Z]:\\/.test(t.rawOutput)).length,
    unixPaths: tasks.filter(t => /\/work\/|\/captured\//.test(t.rawOutput)).length,
    ansiLogs: tasks.filter(t => /\x1b\[/.test(t.rawOutput)).length,
    familyCounts: Object.fromEntries([...new Set(tasks.map(t => t.family))].sort().map(f => [f, tasks.filter(t => t.family === f).length])),
    frameworkCounts: Object.fromEntries([...new Set(tasks.map(t => t.framework))].sort().map(f => [f, tasks.filter(t => t.framework === f).length])),
  };
}

async function developmentReachability(tasks) {
  const { digest, extractFailureCandidates } = await import('../../skills/hydra/scripts/lib/test_logs.mjs');
  const rows = [];
  for (const task of tasks) {
    const facts = [...task.gold.expectedTests, ...task.gold.expectedFiles, ...task.gold.expectedAssertions];
    const candidates = extractFailureCandidates(task.rawOutput);
    let calls = 0;
    const result = await digest({ cmd: task.command, out: task.rawOutput, exitCode: task.exitCode }, async () => {
      calls++;
      // Development only: a fixed oracle selects known evidence, without any model/backend call.
      return { lines: candidates.filter(c => facts.some(f => c.text.includes(f))).map(c => c.id).slice(0, 12) };
    });
    rows.push({ id: task.id, family: task.family, calls,
      missingFacts: facts.filter(f => !result.text.includes(f)),
      leakedStrings: task.rawOutput.length <= 800 ? [] : task.gold.forbiddenStrings.filter(f => result.text.includes(f)),
      exitMatches: task.exitCode === result.exitCode,
    });
  }
  const failingRows = rows.filter(r => r.missingFacts.length || r.leakedStrings.length || !r.exitMatches);
  const report = { description: 'Development-only fixed oracle reachability check; no model accuracy claim; holdout is never digested.',
    tasks: rows.length, reachable: rows.length - failingRows.length,
    oracleCalls: rows.reduce((sum, r) => sum + r.calls, 0), failures: failingRows };
  writeFileSync(path.join(DEST, 'development', 'test-reachability.json'), stable(report));
  return { tasks: report.tasks, reachable: report.reachable, oracleCalls: report.oracleCalls,
    failuresByFamily: Object.fromEntries([...new Set(failingRows.map(r => r.family))].map(f => [f, failingRows.filter(r => r.family === f).length])) };
}

async function main() {
  const qaOnly = process.argv.includes('--qa-only');
  const summaries = {};
  const splitTasks = {};
  for (const split of ['development', 'holdout']) {
    const dir = path.join(DEST, split);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'test.json');
    let tasks, captures, pendingBytes;
    if (qaOnly) {
      tasks = JSON.parse(readFileSync(file, 'utf8'));
      captures = JSON.parse(readFileSync(path.join(dir, 'test-real-captures.json'), 'utf8'));
    } else {
      captures = capture(split);
      tasks = [...authored(split, split === 'development' ? DEVELOPMENT : HOLDOUT, split === 'development' ? 192 : 960), ...captures.tasks];
      pendingBytes = stable(tasks);
      // Once frozen, the holdout cannot be replaced by a renderer/capture change in place.
      if (split === 'holdout' && existsSync(path.join(dir, 'test-manifest.json'))) assert.equal(sha(readFileSync(file)), sha(pendingBytes), 'Frozen holdout changed; create a new version rather than overwrite');
    }
    const summary = qa(split, tasks);
    if (pendingBytes) writeFileSync(file, pendingBytes);
    const manifest = {
      version: 1, head: 'test', split, frozen: split === 'holdout', ...summary,
      testSha256: sha(readFileSync(file)), realCapturesSha256: sha(readFileSync(path.join(dir, 'test-real-captures.json'))),
      realCapturedTasks: captures.tasks.length,
      provenance: {
        authored: 'New human-reviewed framework-shaped renderers in build_test_quality.mjs; unique facts/paths/data per scenario. Independently present gold is defined before extraction.',
        splitRule: 'Disjoint dev-/hold- renderer and authentic assertion/layout families; separate source vocabulary and scenario namespaces. No evals/test_logs fixture is reused.',
        authentic: 'Generated known local Node built-in test and Python unittest source, executed by fixed argv with 6s timeout and no shell. Full source, source/output hashes, command, versions and exit receipts in test-real-captures.json.',
        limitations: 'Other framework logs are independently authored layouts, not captured installations. No model or release-accuracy score is produced here. Holdout QA checks source/gold/hash/count invariants only.',
        excluded: ['evals/git1/**', 'evals/test_logs/tasks.json', 'training corpora', 'model replies/failures', '.env'],
      },
    };
    if (qaOnly) {
      const frozen = JSON.parse(readFileSync(path.join(dir, 'test-manifest.json'), 'utf8'));
      assert.equal(frozen.testSha256, manifest.testSha256);
      assert.equal(frozen.realCapturesSha256, manifest.realCapturesSha256);
    } else writeFileSync(path.join(dir, 'test-manifest.json'), stable(manifest));
    summaries[split] = { ...summary, realCapturedTasks: captures.tasks.length, testSha256: manifest.testSha256 };
    splitTasks[split] = tasks;
  }
  const devFamilies = new Set(splitTasks.development.map(t => t.family));
  assert(!splitTasks.holdout.some(t => devFamilies.has(t.family)));
  const devOutputHashes = new Set(splitTasks.development.filter(t => t.rawOutput).map(t => sha(t.rawOutput)));
  assert(!splitTasks.holdout.some(t => t.rawOutput && devOutputHashes.has(sha(t.rawOutput))));
  if (process.argv.includes('--dev-reachability')) summaries.developmentReachability = await developmentReachability(splitTasks.development);
  console.log(JSON.stringify(summaries, null, 2));
}

await main();
