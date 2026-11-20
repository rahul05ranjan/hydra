import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compare, currentVersion, decide, latest, readInstalled, recordInstall, replayArgs, shadowingCopies } from '../skills/hydra/scripts/lib/self_update.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/hydra/scripts/hydra.mjs');

test('versions compare by number, and a prerelease sorts before its release', () => {
  assert.ok(compare('0.3.4', '0.3.10') < 0);
  assert.ok(compare('1.0.0', '0.9.9') > 0);
  assert.equal(compare('0.3.4', '0.3.4'), 0);
  assert.ok(compare('0.4.0-beta.1', '0.4.0') < 0);
  assert.throws(() => compare('latest', '0.3.4'), /not a version/);
  assert.equal(decide('0.3.4', '0.3.5'), 'update');
  assert.equal(decide('0.3.5', '0.3.5'), 'current');
  assert.equal(decide('0.4.0', '0.3.5'), 'ahead');
  assert.equal(decide(undefined, '0.3.5'), 'unknown');
});

test('only the installer options that matter are replayed, and only valid agent IDs', () => {
  assert.deepEqual(replayArgs(['--agent', 'codex', '--no-hooks', '--verbose', '--agent', 'rm -rf /', '--no-hooks', '--runtime-only']),
    ['--agent', 'codex', '--no-hooks', '--runtime-only']);
  assert.deepEqual(replayArgs([]), []);
});

test('the install record round-trips and ignores anything without a valid version', () => {
  const prior = process.env.HYDRA_HOME;
  process.env.HYDRA_HOME = mkdtempSync(path.join(os.tmpdir(), 'hydra-update-'));
  try {
    assert.equal(readInstalled(), null);
    recordInstall('0.3.4', ['--agent', 'claude-code', '--no-hooks']);
    const record = readInstalled();
    assert.equal(record.version, '0.3.4');
    assert.deepEqual(record.args, ['--agent', 'claude-code', '--no-hooks']);
    recordInstall('not-a-version', []);
    assert.equal(readInstalled().version, '0.3.4');
  } finally {
    if (prior === undefined) delete process.env.HYDRA_HOME; else process.env.HYDRA_HOME = prior;
  }
});

test('the latest version comes from the registry and a bad answer is refused', async () => {
  const reply = body => async url => ({ ok: true, json: async () => body, url });
  assert.equal(await latest(reply({ version: '0.3.5' })), '0.3.5');
  await assert.rejects(latest(reply({ version: '<script>' })), /no valid version/);
  await assert.rejects(latest(async () => ({ ok: false, status: 503 })), /HTTP 503/);
});

/** Run `hydra self-update` against a local stand-in for the npm registry. */
async function cli(t, { installed, published, args = ['--check'] }) {
  const server = createServer((req, res) => {
    if (published && req.url === '/hydra-nano/latest') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version: published })); }
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const home = mkdtempSync(path.join(os.tmpdir(), 'hydra-update-cli-'));
  if (installed) writeFileSync(path.join(home, 'installed.json'), JSON.stringify({ version: installed, args: ['--no-hooks'] }));
  const child = spawn(process.execPath, [CLI, 'self-update', ...args], {
    env: { ...process.env, HYDRA_HOME: home, HYDRA_TELEMETRY: '0', HYDRA_REGISTRY: `http://127.0.0.1:${server.address().port}` },
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise(resolve => child.on('close', resolve));
  return { code, output };
}

test('self-update --check reports an available update, the current version, or an older unrecorded install', async t => {
  let run = await cli(t, { installed: '0.3.4', published: '0.3.5' });
  assert.equal(run.code, 0);
  assert.match(run.output, /Hydra 0\.3\.5 is available; installed: 0\.3\.4\. Run: hydra self-update/);
  run = await cli(t, { installed: '0.3.5', published: '0.3.5' });
  assert.match(run.output, /Hydra 0\.3\.5 is the latest version\./);
  run = await cli(t, { published: '0.3.5' });
  assert.match(run.output, /installed: an unrecorded version/);
  run = await cli(t, { installed: '0.4.0', published: '0.3.5', args: [] });
  assert.match(run.output, /newer than the latest npm release/);
});

test('self-update fails clearly when the registry cannot be read, and rejects unknown options', async t => {
  let run = await cli(t, { installed: '0.3.4' });
  assert.equal(run.code, 2);
  assert.match(run.output, /could not read the latest version from the npm registry \(registry answered HTTP 404\)/);
  run = await cli(t, { installed: '0.3.4', published: '0.3.5', args: ['--yes'] });
  assert.equal(run.code, 1);
  assert.match(run.output, /usage: hydra self-update/);
});

test('the running version comes from package.json, else from what the installer recorded', () => {
  const prior = process.env.HYDRA_HOME;
  process.env.HYDRA_HOME = mkdtempSync(path.join(os.tmpdir(), 'hydra-version-'));
  try {
    const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    assert.equal(currentVersion(), own);
    const missing = path.join(process.env.HYDRA_HOME, 'no-package.json');
    assert.equal(currentVersion(missing), null);
    recordInstall('0.3.4', []);
    assert.equal(currentVersion(missing), '0.3.4');
    const other = path.join(process.env.HYDRA_HOME, 'other.json');
    writeFileSync(other, JSON.stringify({ name: 'something-else', version: '9.9.9' }));
    assert.equal(currentVersion(other), '0.3.4');
  } finally {
    if (prior === undefined) delete process.env.HYDRA_HOME; else process.env.HYDRA_HOME = prior;
  }
});

test('hydra version and the MCP server report the version', async () => {
  const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const run = spawn(process.execPath, [CLI, 'version'], { env: { ...process.env, HYDRA_TELEMETRY: '0' } });
  let out = '';
  run.stdout.on('data', chunk => { out += chunk; });
  await new Promise(resolve => run.on('close', resolve));
  assert.equal(out.trim(), `hydra ${own}`);
  const server = spawn(process.execPath, [path.join(path.dirname(CLI), 'mcp.mjs')], { env: { ...process.env, HYDRA_TELEMETRY: '0' } });
  const reply = new Promise(resolve => server.stdout.once('data', chunk => resolve(JSON.parse(String(chunk).split('\n')[0]))));
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'version-check' } } })}\n`);
  assert.equal((await reply).result.serverInfo.version, own);
  server.kill();
});

test('older hydra-nano copies above the current folder or home are found; newer ones are not', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hydra-shadow-'));
  const home = path.join(root, 'home'), project = path.join(home, 'code', 'app'), other = path.join(root, 'other');
  const put = (dir, version) => { mkdirSync(path.join(dir, 'node_modules', 'hydra-nano'), { recursive: true }); writeFileSync(path.join(dir, 'node_modules', 'hydra-nano', 'package.json'), JSON.stringify({ name: 'hydra-nano', version })); };
  mkdirSync(project, { recursive: true }); mkdirSync(other, { recursive: true });
  put(home, '0.2.0');
  put(project, '0.4.0');
  assert.deepEqual(shadowingCopies(project, '0.3.5', home), [{ dir: home, version: '0.2.0' }]);
  assert.deepEqual(shadowingCopies(other, '0.3.5', home), [{ dir: home, version: '0.2.0' }], 'home is checked from anywhere');
  assert.deepEqual(shadowingCopies(other, '0.3.5', other), []);
});
