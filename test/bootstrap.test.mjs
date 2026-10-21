import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { platformArtifact, download, findNpx } from '../skills/hydra/scripts/lib/bootstrap.mjs';
import { localConfig } from '../skills/hydra/scripts/lib/local.mjs';

test('runtime artifacts cover six supported platform/architecture pairs', () => {
  for (const platform of ['win32', 'darwin', 'linux']) for (const arch of ['x64', 'arm64']) assert.ok(platformArtifact(platform, arch).includes(arch));
  assert.throws(() => platformArtifact('linux', 'ia32'), /Unsupported platform/);
});

test('npm discovery supports Windows, Homebrew and Debian layouts', () => {
  for (const relative of ['node_modules/npm/bin/npx-cli.js', '../lib/node_modules/npm/bin/npx-cli.js', '../share/nodejs/npm/bin/npx-cli.js']) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'hydra-npm-'));
    const bin = path.join(root, 'bin'); const file = path.resolve(bin, relative);
    mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, '// fixture');
    // findNpx resolves symlinks (npx is often one); on macOS the temp dir itself is /var -> /private/var.
    assert.equal(findNpx([bin]), realpathSync(file));
  }
});

test('artifact downloads verify hashes, retain good installs and reuse verified files', async () => {
  const body = Buffer.from('verified fixture'); let calls = 0;
  const server = createServer((req, res) => { calls++; res.end(body); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hydra-bootstrap-')); const target = path.join(dir, 'model.gguf');
  const artifact = { url: `http://127.0.0.1:${server.address().port}/model`, size: body.length, sha256: createHash('sha256').update(body).digest('hex') };
  try {
    await download(artifact, target); assert.deepEqual(readFileSync(target), body);
    await download(artifact, target); assert.equal(calls, 1);
    await assert.rejects(download({ ...artifact, sha256: '0'.repeat(64) }, target), /SHA-256 mismatch/);
    assert.deepEqual(readFileSync(target), body);
    assert.ok(existsSync(target + '.part'));
    await assert.rejects(download({ ...artifact, size: body.length + 1 }, target), /mismatch/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('managed installation config is versioned and isolated by HYDRA_HOME', () => {
  const prior = process.env.HYDRA_HOME;
  process.env.HYDRA_HOME = mkdtempSync(path.join(os.tmpdir(), 'hydra-config-'));
  try {
    assert.deepEqual(localConfig(), {});
    writeFileSync(path.join(process.env.HYDRA_HOME, 'config.json'), '{"version":1,"model":"local-alias"}');
    assert.equal(localConfig().model, 'local-alias');
    writeFileSync(path.join(process.env.HYDRA_HOME, 'config.json'), '{"version":99}');
    assert.throws(localConfig, /Unsupported Hydra config/);
  } finally { if (prior === undefined) delete process.env.HYDRA_HOME; else process.env.HYDRA_HOME = prior; }
});

test('a listener counts as the managed server only when server.pid names this user\'s llama-server', { skip: process.platform === 'win32' }, async () => {
  const prior = process.env.HYDRA_HOME;
  process.env.HYDRA_HOME = mkdtempSync(path.join(os.tmpdir(), 'hydra-own-'));
  try {
    const { ownServer } = await import('../skills/hydra/scripts/lib/local.mjs');
    const pidFile = path.join(process.env.HYDRA_HOME, 'server.pid');
    assert.equal(ownServer({ server: process.execPath }), false, 'no pid file');
    writeFileSync(pidFile, String(process.pid));
    assert.equal(ownServer({ server: process.execPath }), true, 'this process runs node');
    assert.equal(ownServer({ server: '/nonexistent/llama-server' }), false, 'another executable');
    writeFileSync(pidFile, '1');
    assert.equal(ownServer({ server: process.execPath }), false, 'pid 1 belongs to another user');
  } finally {
    if (prior === undefined) delete process.env.HYDRA_HOME; else process.env.HYDRA_HOME = prior;
  }
});
