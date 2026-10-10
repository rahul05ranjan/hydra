#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.join(HERE, 'tasks.json');

const TASKS = [
  {
    id: 'vitest_jwt_failure',
    framework: 'vitest',
    command: 'npm test',
    exitCode: 1,
    rawOutput: `$ npm test
> myapp@1.0.0 test
> vitest run

 ✓ src/math.test.ts (12 tests) (45ms)
 ✓ src/utils/format.test.ts (8 tests) (22ms)
 ❯ src/auth/jwt.test.ts (2 tests | 1 failed)
   ✓ creates valid jwt token (12ms)
   × rejects expired token (28ms)
     → expected 401 to deeply equal 200

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/auth/jwt.test.ts > rejects expired token
AssertionError: expected 401 to deeply equal 200

- Expected:
200

+ Received:
401

 ❯ src/auth/jwt.test.ts:45:21
     43|     const res = await verifyToken(expiredToken);
     44|     expect(res.status).toEqual(200);
     45|   });
 ❯ node_modules/vitest/dist/vendor/index.js:123:45
 ❯ processTicksAndRejections node:internal/process/task_queues:95:5
 ❯ runTest file:///Users/rivansh/node_modules/vitest/dist/runner.js:891:12
 ❯ runSuite file:///Users/rivansh/node_modules/vitest/dist/runner.js:930:15
 ❯ runFiles file:///Users/rivansh/node_modules/vitest/dist/runner.js:980:12

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { code: 'ERR_ASSERTION' }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Test Files  1 failed | 2 passed (3)
     Tests  1 failed | 21 passed (22)
  Duration  812ms`,
    gold: {
      expectedTests: ['rejects expired token'],
      expectedFiles: ['src/auth/jwt.test.ts:45'],
      expectedAssertions: ['401', '200'],
      forbiddenStrings: ['node_modules/vitest'],
    },
  },
  {
    id: 'vitest_multiple_failures',
    framework: 'vitest',
    command: 'npm test',
    exitCode: 1,
    rawOutput: `$ npm test
> myapp@1.0.0 test
> vitest run

 ✓ src/health.test.ts (4 tests) (10ms)
 ✓ src/auth/session.test.ts (9 tests) (35ms)
 ✓ src/crypto.test.ts (6 tests) (18ms)

 FAIL  src/user.test.ts > createUser > should hash password
AssertionError: expected 'plain_secret' not to equal 'plain_secret'
 ❯ src/user.test.ts:32:19
 ❯ node_modules/vitest/dist/runner.js:410:11
 ❯ node_modules/vitest/dist/vendor.js:520:8

 FAIL  src/billing.test.ts > invoice > should calculate tax
AssertionError: expected 110 to equal 100
- Expected: 100
+ Received: 110
 ❯ src/billing.test.ts:58:14
 ❯ node_modules/vitest/dist/runner.js:410:11
 ❯ node_modules/vitest/dist/vendor.js:520:8

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Test Files  2 failed | 3 passed (5)
     Tests  2 failed | 19 passed (21)
  Duration  1.20s`,
    gold: {
      expectedTests: ['should hash password', 'should calculate tax'],
      expectedFiles: ['src/user.test.ts:32', 'src/billing.test.ts:58'],
      expectedAssertions: ['plain_secret', '110'],
      forbiddenStrings: ['node_modules/vitest'],
    },
  },
  {
    id: 'vitest_verbose_pass',
    framework: 'vitest',
    command: 'npm test',
    exitCode: 0,
    rawOutput: `$ npm test
> vitest run
` + Array.from({ length: 80 }, (_, i) => `[DEBUG] loaded fixture item_${i} from cache`).join('\n') + `
 ✓ src/math.test.ts (10 tests)
 ✓ src/string.test.ts (8 tests)

Test Files  2 passed (2)
     Tests  18 passed (18)
  Duration  450ms`,
    gold: {
      expectedTests: [],
      expectedFiles: [],
      expectedAssertions: ['passed'],
      forbiddenStrings: ['[DEBUG] loaded fixture'],
    },
  },
  {
    id: 'vitest_short_pass',
    framework: 'vitest',
    command: 'npm test',
    exitCode: 0,
    rawOutput: `$ npm test
PASS src/math.test.ts
Tests: 2 passed, 2 total`,
    gold: {
      expectedTests: [],
      expectedFiles: [],
      expectedAssertions: ['PASS'],
      forbiddenStrings: [],
    },
  },
  {
    id: 'jest_snapshot_mismatch',
    framework: 'jest',
    command: 'npx jest',
    exitCode: 1,
    rawOutput: `$ npx jest
 PASS  src/components/Footer.test.tsx
 PASS  src/components/Button.test.tsx
 PASS  src/components/Sidebar.test.tsx
 FAIL  src/components/Header.test.tsx
  ● Header component › should match snapshot

    expect(received).toMatchSnapshot()

    Snapshot name: \`Header component should match snapshot 1\`

    - Snapshot  - 1
    + Received  + 1

      <header>
    -   <h1>Welcome back</h1>
    +   <h1>Hello Guest</h1>
      </header>

      at Object.<anonymous> (src/components/Header.test.tsx:24:31)
      at Promise.then.completed (node_modules/jest-circus/build/utils.js:298:28)
      at new Promise (<anonymous>)
      at node_modules/jest-circus/build/run.js:120:15
      at node_modules/jest-runner/build/index.js:88:12

Test Suites: 1 failed, 3 passed, 4 total
Tests:       1 failed, 12 passed, 13 total
Snapshots:   1 failed, 1 total`,
    gold: {
      expectedTests: ['should match snapshot'],
      expectedFiles: ['src/components/Header.test.tsx:24'],
      expectedAssertions: ['Hello Guest', 'Welcome back'],
      forbiddenStrings: ['node_modules/jest-circus'],
    },
  },
  {
    id: 'jest_timeout_error',
    framework: 'jest',
    command: 'npx jest',
    exitCode: 1,
    rawOutput: `$ npx jest
 PASS  test/unit/crypto.test.js
 PASS  test/unit/cache.test.js
 FAIL  test/db.test.js
  ● Database › connects within timeout

    thrown: "Exceeded timeout of 5000 ms for a hook."
    Add a timeout value to this test to increase the timeout, if this is a long-running test.

      at test/db.test.js:33:5
      at node_modules/jest-jasmine2/build/queueRunner.js:45:12
      at processTicksAndRejections (node:internal/process/task_queues:95:5)
      at node_modules/jest-runner/build/runTest.js:105:10

Test Suites: 1 failed, 2 passed, 3 total
Tests:       1 failed, 14 passed, 15 total`,
    gold: {
      expectedTests: ['connects within timeout'],
      expectedFiles: ['test/db.test.js:33'],
      expectedAssertions: ['5000 ms'],
      forbiddenStrings: ['node_modules/jest-jasmine2'],
    },
  },
  {
    id: 'pytest_status_code_assertion',
    framework: 'pytest',
    command: 'pytest',
    exitCode: 1,
    rawOutput: `$ pytest
============================= test session starts ==============================
platform darwin -- Python 3.13.0, pytest-8.3.3, pluggy-1.5.0
rootdir: /Users/rivansh/code/myapp
collected 10 items

tests/test_health.py ....                                                [ 40%]
tests/test_models.py ...                                                 [ 70%]
tests/test_api.py F..                                                    [100%]

=================================== FAILURES ===================================
________________________________ test_get_user _________________________________

client = <TestClient>

    def test_get_user(client):
        response = client.get("/users/42")
>       assert response.status_code == 200
E       assert 404 == 200
E        +  where 404 = <Response [404]>.status_code

tests/test_api.py:18: AssertionError
----------------------------- Captured stderr call -----------------------------
[DEBUG] user 42 not found in database
=========================== short test summary info ============================
FAILED tests/test_api.py::test_get_user - assert 404 == 200
========================= 1 failed, 9 passed in 0.42s ==========================`,
    gold: {
      expectedTests: ['test_get_user'],
      expectedFiles: ['tests/test_api.py:18'],
      expectedAssertions: ['404 == 200'],
      forbiddenStrings: ['pluggy-1.5.0'],
    },
  },
  {
    id: 'pytest_multiple_failures',
    framework: 'pytest',
    command: 'pytest',
    exitCode: 1,
    rawOutput: `$ pytest
============================= test session starts ==============================
platform darwin -- Python 3.13.0, pytest-8.3.3
rootdir: /Users/rivansh/code/myapp
collected 12 items

tests/test_auth.py F...                                                  [ 33%]
tests/test_user.py F...                                                  [ 66%]
tests/test_cart.py ....                                                  [100%]

=================================== FAILURES ===================================
________________________________ test_login ____________________________________
>       assert auth.check("secret") is True
E       AssertionError: assert False is True
tests/test_auth.py:22: AssertionError
________________________________ test_signup ___________________________________
>       assert user.email == "a@b.com"
E       AssertionError: assert 'bad' == 'a@b.com'
tests/test_user.py:44: AssertionError
=========================== short test summary info ============================
FAILED tests/test_auth.py::test_login - AssertionError: assert False is True
FAILED tests/test_user.py::test_signup - AssertionError: assert 'bad' == 'a@b.com'
========================= 2 failed, 10 passed in 0.58s =========================`,
    gold: {
      expectedTests: ['test_login', 'test_signup'],
      expectedFiles: ['tests/test_auth.py:22', 'tests/test_user.py:44'],
      expectedAssertions: ['False is True', 'a@b.com'],
      forbiddenStrings: [],
    },
  },
  {
    id: 'pytest_exception_trace',
    framework: 'pytest',
    command: 'pytest',
    exitCode: 1,
    rawOutput: `$ pytest tests/test_models.py
============================= test session starts ==============================
platform darwin -- Python 3.13.0, pytest-8.3.3
rootdir: /Users/rivansh/code/myapp
collected 6 items

tests/test_models.py ....F.                                              [100%]

=================================== FAILURES ===================================
________________________________ test_parse_uuid _______________________________

    def test_parse_uuid():
>       u = User.from_raw({"uuid": "not-a-valid-uuid"})

app/models/user.py:58: 
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 

    def from_raw(data):
>       return UUID(data["uuid"])
E       ValueError: badly formed hexadecimal UUID string

/usr/local/lib/python3.13/uuid.py:142: ValueError
=========================== short test summary info ============================
FAILED tests/test_models.py::test_parse_uuid - ValueError: badly formed hexadecimal UUID string
========================= 1 failed, 5 passed in 0.28s ==========================`,
    gold: {
      expectedTests: ['test_parse_uuid'],
      expectedFiles: ['app/models/user.py:58'],
      expectedAssertions: ['ValueError'],
      forbiddenStrings: ['/usr/local/lib/python3.13/uuid.py'],
    },
  },
  {
    id: 'pytest_verbose_pass',
    framework: 'pytest',
    command: 'pytest',
    exitCode: 0,
    rawOutput: `$ pytest
` + Array.from({ length: 60 }, (_, i) => `INFO:sqlalchemy.engine.Engine:SELECT * FROM users WHERE id = ${i};`).join('\n') + `
============================== 25 passed in 1.12s ==============================`,
    gold: {
      expectedTests: [],
      expectedFiles: [],
      expectedAssertions: ['passed'],
      forbiddenStrings: ['SELECT * FROM users'],
    },
  },
  {
    id: 'cargo_test_panic',
    framework: 'cargo',
    command: 'cargo test',
    exitCode: 1,
    rawOutput: `$ cargo test
   Compiling myapp v0.1.0 (/Users/rivansh/code/myapp)
    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 1.42s
     Running unittests src/lib.rs (target/debug/deps/myapp-84821a)

running 8 tests
test math::test_add ... ok
test math::test_sub ... ok
test auth::test_login ... ok
test auth::test_token_expiry ... FAILED
test auth::test_refresh ... ok
test auth::test_logout ... ok
test db::test_pool ... ok
test db::test_query ... ok

failures:

---- auth::test_token_expiry stdout ----
thread 'auth::test_token_expiry' panicked at src/auth.rs:112:9:
assertion \`left == right\` failed
  left: 3600
 right: 0
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace

failures:
    auth::test_token_expiry

test result: FAILED. 7 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s`,
    gold: {
      expectedTests: ['auth::test_token_expiry'],
      expectedFiles: ['src/auth.rs:112'],
      expectedAssertions: ['3600', '0'],
      forbiddenStrings: ['RUST_BACKTRACE=1'],
    },
  },
  {
    id: 'cargo_test_multiple',
    framework: 'cargo',
    command: 'cargo test',
    exitCode: 1,
    rawOutput: `$ cargo test
   Compiling myapp v0.1.0 (/Users/rivansh/code/myapp)
    Finished \`test\` profile in 1.2s
     Running unittests src/lib.rs

running 12 tests
test db::test_conn ... ok
test db::test_ping ... ok
test config::test_env ... FAILED
test parser::test_json ... FAILED
test parser::test_xml ... ok

failures:

---- config::test_env stdout ----
thread 'config::test_env' panicked at src/config.rs:45:5:
missing required port env var

---- parser::test_json stdout ----
thread 'parser::test_json' panicked at src/parser.rs:88:13:
assertion failed: !parsed.is_empty()

failures:
    config::test_env
    parser::test_json

test result: FAILED. 10 passed; 2 failed; 0 ignored; finished in 0.22s`,
    gold: {
      expectedTests: ['config::test_env', 'parser::test_json'],
      expectedFiles: ['src/config.rs:45', 'src/parser.rs:88'],
      expectedAssertions: ['missing required port', 'assertion failed'],
      forbiddenStrings: [],
    },
  },
  {
    id: 'cargo_compile_error',
    framework: 'cargo',
    command: 'cargo build',
    exitCode: 1,
    rawOutput: `$ cargo build
   Compiling libc v0.2.155
   Compiling serde v1.0.203
   Compiling myapp v0.1.0 (/Users/rivansh/code/myapp)
error[E0308]: mismatched types
  --> src/main.rs:24:18
   |
24 |     let port: u16 = "8080";
   |               ---   ^^^^^^ expected \`u16\`, found \`&str\`
   |               |
   |               expected due to this

For more information about this error, try \`rustc --explain E0308\`.
error: could not compile \`myapp\` (bin "myapp") due to 1 previous error`,
    gold: {
      expectedTests: [],
      expectedFiles: ['src/main.rs:24'],
      expectedAssertions: ['E0308', 'expected `u16`, found `&str`'],
      forbiddenStrings: ['rustc --explain'],
    },
  },
  {
    id: 'tsc_type_errors',
    framework: 'tsc',
    command: 'tsc --noEmit',
    exitCode: 1,
    rawOutput: `$ tsc --noEmit
src/components/UserCard.tsx:14:7 - error TS2741: Property 'email' is missing in type '{ name: string; }' but required in type 'UserProps'.

14       <UserProps name="Alice" />
         ~~~~~~~~~~

  src/types.ts:4:3
    4   email: string;
        ~~~~~
    'email' is declared here.

src/utils/format.ts:25:12 - error TS2339: Property 'toUpperCase' does not exist on type 'number'.

25   return val.toUpperCase();
                ~~~~~~~~~~~

Found 2 errors in 2 files.`,
    gold: {
      expectedTests: [],
      expectedFiles: ['src/components/UserCard.tsx:14', 'src/utils/format.ts:25'],
      expectedAssertions: ['TS2741', 'TS2339', 'email', 'toUpperCase'],
      forbiddenStrings: [],
    },
  },
  {
    id: 'tsc_missing_import',
    framework: 'tsc',
    command: 'tsc --noEmit',
    exitCode: 1,
    rawOutput: `$ tsc --noEmit
src/index.ts:3:22 - error TS2307: Cannot find module './api' or its corresponding type declarations.

3 import { getClient } from './api';
                       ~~~~~~~

Found 1 error in 1 file.`,
    gold: {
      expectedTests: [],
      expectedFiles: ['src/index.ts:3'],
      expectedAssertions: ['TS2307', "Cannot find module './api'"],
      forbiddenStrings: [],
    },
  },
  {
    id: 'go_test_failure',
    framework: 'go',
    command: 'go test ./...',
    exitCode: 1,
    rawOutput: `$ go test ./...
=== RUN   TestHealthCheck
--- PASS: TestHealthCheck (0.00s)
=== RUN   TestValidateEmail
--- FAIL: TestValidateEmail (0.01s)
    email_test.go:28: ValidateEmail("bad_email") = true, want false
FAIL
FAIL    github.com/org/myapp/pkg/auth   0.024s
FAIL`,
    gold: {
      expectedTests: ['TestValidateEmail'],
      expectedFiles: ['email_test.go:28'],
      expectedAssertions: ['want false'],
      forbiddenStrings: [],
    },
  },
  {
    id: 'go_test_panic',
    framework: 'go',
    command: 'go test ./...',
    exitCode: 1,
    rawOutput: `$ go test ./...
=== RUN   TestStartServer
--- FAIL: TestStartServer (0.02s)
panic: runtime error: invalid memory address or nil pointer dereference [recovered]
	panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x2 addr=0x0 pc=0x10f4388]

goroutine 6 [running]:
github.com/org/myapp/server.Start(0x0)
	/Users/rivansh/code/myapp/server.go:84 +0x48
github.com/org/myapp.TestStartServer(0x14000114000)
	/Users/rivansh/code/myapp/server_test.go:19 +0x28
testing.tRunner(0x14000114000, 0x10fa958)
	/usr/local/go/src/testing/testing.go:1689 +0xf4
FAIL	github.com/org/myapp	0.035s`,
    gold: {
      expectedTests: ['TestStartServer'],
      expectedFiles: ['server.go:84'],
      expectedAssertions: ['nil pointer dereference'],
      forbiddenStrings: ['/usr/local/go/src/testing/testing.go'],
    },
  },
  {
    id: 'node_test_runner',
    framework: 'node:test',
    command: 'node --test',
    exitCode: 1,
    rawOutput: `$ node --test
✔ math > addition works (0.5ms)
✔ math > subtraction works (0.3ms)
✔ calc > multiplication works (0.4ms)
✖ calc > division by zero throws (1.8ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 0
  - Infinity
      at TestContext.<anonymous> (file:///Users/rivansh/code/test/calc.test.mjs:15:10)
      at Test.run (node:internal/test_runner/test:892:25)
      at async Suite.run (node:internal/test_runner/test:1255:7)
      at node:internal/main/test_runner:14:5

ℹ tests 4
ℹ suites 0
ℹ pass 3
ℹ fail 1`,
    gold: {
      expectedTests: ['division by zero throws'],
      expectedFiles: ['test/calc.test.mjs:15'],
      expectedAssertions: ['ERR_ASSERTION', 'Infinity'],
      forbiddenStrings: ['node:internal/test_runner/test'],
    },
  },
  {
    id: 'python_syntax_error',
    framework: 'python',
    command: 'python -m pytest',
    exitCode: 1,
    rawOutput: `$ python -m pytest
ImportError while loading conftest '/Users/rivansh/code/tests/conftest.py'.
tests/conftest.py:12: in <module>
    from app.server import app
app/server.py:14: in <module>
    def setup(
E     SyntaxError: invalid syntax (server.py, line 14)
=========================== no tests ran in 0.02s ============================`,
    gold: {
      expectedTests: [],
      expectedFiles: ['app/server.py:14', 'tests/conftest.py:12'],
      expectedAssertions: ['SyntaxError'],
      forbiddenStrings: [],
    },
  },
  {
    id: 'mocha_failure',
    framework: 'mocha',
    command: 'npx mocha',
    exitCode: 1,
    rawOutput: `$ npx mocha
  Integration Tests
    ✓ responds to health check (40ms)
    ✓ loads user profile (35ms)
    1) authenticates bearer token

  2 passing (120ms)
  1 failing

  1) Integration Tests
       authenticates bearer token:
     AssertionError: expected false to be true
      at Context.<anonymous> (test/integration.js:64:14)
      at processImmediate (node:internal/timers:478:21)
      at node_modules/mocha/lib/runnable.js:368:7
      at node_modules/mocha/lib/runner.js:450:12`,
    gold: {
      expectedTests: ['authenticates bearer token'],
      expectedFiles: ['test/integration.js:64'],
      expectedAssertions: ['expected false to be true'],
      forbiddenStrings: ['node_modules/mocha'],
    },
  },
];

writeFileSync(DEST, JSON.stringify(TASKS, null, 2) + '\n');
console.log(`Wrote ${TASKS.length} test log tasks to ${DEST}`);
