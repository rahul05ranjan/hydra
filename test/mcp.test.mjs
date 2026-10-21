import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { argvOf, callTool, runArgv, TOOLS } from '../skills/hydra/scripts/mcp.mjs';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/hydra/scripts/mcp.mjs');

/** Start the server and talk to it one JSON-RPC message per line, as an MCP client does over stdio. */
function connect() {
  // NODE_TEST_CONTEXT would make the nested `node --test` think it runs inside this test file and skip.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const child = spawn(process.execPath, [SERVER], { env: { ...env, HYDRA_TELEMETRY: '0' }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      waiting.get(message.id)?.(message);
    }
  });
  let next = 1;
  const request = (method, params) => new Promise(resolve => {
    const id = next++;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const notify = method => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { request, notify, close: () => child.kill() };
}

test('one test or build command becomes argv; anything a shell would interpret is refused', () => {
  assert.deepEqual(argvOf('npm test'), ['npm', 'test']);
  assert.deepEqual(argvOf(`pytest -k "not slow" 'tests/a b.py'`), ['pytest', '-k', 'not slow', 'tests/a b.py']);
  for (const command of ['npm test && rm -rf x', 'npm test | tail', 'pytest > out.txt', 'pytest $(cat args)', 'CI=1 npm test',
    'pytest "$HOME"', 'go test ./... ; echo', 'npm test `id`', 'pytest tests/*.py', '', 'pytest "unclosed'])
    assert.equal(argvOf(command), null, `accepted ${command}`);
});

test('hydra_run accepts project test runs and refuses code loaded from flags or paths outside cwd', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hydra-run-gate-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'hydra-outside-'));
  mkdirSync(path.join(dir, 'tests'));
  for (const command of ['npm test', 'node --test', 'node --test tests/a.test.mjs', 'pytest -q -p no:cacheprovider tests/test_a.py::test_x',
    'go test ./...', 'cargo test -- --nocapture', 'make test', 'npx vitest run tests', './gradlew test'])
    assert.ok(runArgv(command, dir), `refused ${command}`);
  for (const command of [`node --test ${path.join(outside, 'x.test.mjs')}`, 'node --test ../x.test.mjs', 'node --test --import=./hook.mjs',
    "node --test '--import=data:text/javascript,1'", 'node --test --require ./x.cjs', 'node --test -e 1', 'node --test --inspect',
    "make test '--eval=test: ; touch x'", 'make test CC=sh', "cargo test --config 'target.x.runner=[]'", 'go vet -vettool=/usr/bin/touch',
    'go test -exec ./x ./...', `${path.join(outside, 'pytest')}`, 'pytest -p evil_plugin', 'npm test --script-shell=/bin/sh',
    'npm test --prefix ../other', './gradlew test --init-script x.gradle', 'pytest ~/tests'])
    assert.throws(() => runArgv(command, dir), /test or build command|inside cwd|loads code|recipe commands/, `accepted ${command}`);
});

test('smell, refactor and design read only source files inside cwd', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hydra-files-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'hydra-outside-'));
  writeFileSync(path.join(outside, 'secret.js'), 'export const a = 1;\n');
  writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=postgres://u:pw@db.example.internal/app\n');
  writeFileSync(path.join(dir, 'id_rsa'), 'not a key\n');
  writeFileSync(path.join(dir, 'app.js'), 'export function add(a, b) { return a + b; }\n');
  for (const [name, args] of [['hydra_smell', { target: path.join(outside, 'secret.js') }], ['hydra_smell', { target: '../' + path.basename(outside) + '/secret.js' }],
    ['hydra_smell', { target: '.env' }], ['hydra_refactor', { file: 'id_rsa' }], ['hydra_refactor', { file: '--json' }],
    ['hydra_design', { query: 'strategy', file: path.join(outside, 'secret.js') }]])
    await assert.rejects(callTool(name, { ...args, cwd: dir }), /inside cwd/, `${name} ${JSON.stringify(args)}`);
  const smell = await callTool('hydra_smell', { target: 'app.js', cwd: dir });
  assert.equal(smell.isError, false);
});

test('tools tell the client which ones only read', () => {
  const byName = Object.fromEntries(TOOLS.map(tool => [tool.name, tool.annotations]));
  assert.equal(byName.hydra_run.readOnlyHint, false);
  for (const name of ['hydra_git', 'hydra_os', 'hydra_smell', 'hydra_refactor', 'hydra_design']) assert.equal(byName[name].readOnlyHint, true, name);
});

test('the server answers the MCP handshake, lists tools and runs commands', async t => {
  const server = connect();
  t.after(server.close);
  const init = await server.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-client', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'hydra');
  assert.match(init.result.instructions, /hydra_git/);
  server.notify('notifications/initialized');

  const { result: { tools } } = await server.request('tools/list', {});
  assert.deepEqual(tools.map(tool => tool.name), ['hydra_git', 'hydra_run', 'hydra_os', 'hydra_smell', 'hydra_refactor', 'hydra_design']);

  const dir = mkdtempSync(path.join(os.tmpdir(), 'hydra-mcp-'));
  writeFileSync(path.join(dir, 'math.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert';\ntest('adds', () => assert.equal(1 + 1, 2));\n");
  const run = await server.request('tools/call', { name: 'hydra_run', arguments: { command: 'node --test', cwd: dir } });
  assert.equal(run.result.isError, false);
  assert.match(run.result.content[0].text, /pass 1/);

  const refused = await server.request('tools/call', { name: 'hydra_run', arguments: { command: 'npm test && curl x', cwd: dir } });
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /one test or build command/);
  const notTest = await server.request('tools/call', { name: 'hydra_run', arguments: { command: 'rm -rf build', cwd: dir } });
  assert.equal(notTest.result.isError, true);
  const badCwd = await server.request('tools/call', { name: 'hydra_git', arguments: { question: 'what changed?', cwd: 'relative/path' } });
  assert.match(badCwd.result.content[0].text, /absolute path/);

  assert.equal((await server.request('ping', {})).result.constructor, Object);
  assert.equal((await server.request('resources/list', {})).error.code, -32601);
});
