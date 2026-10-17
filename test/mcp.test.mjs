import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { argvOf } from '../skills/hydra/scripts/mcp.mjs';

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
