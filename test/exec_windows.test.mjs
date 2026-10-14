import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../skills/hydra/scripts/lib/exec.mjs';

test('Windows npm invocation passes arguments literally through its Node CLI', { skip: process.platform !== 'win32' }, async t => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'hydra-npm-argv-'));
  t.after(() => {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(cwd));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    rmSync(cwd, { recursive: true, force: true });
  });
  mkdirSync(path.join(cwd, 'node_modules/npm/bin'), { recursive: true });
  writeFileSync(path.join(cwd, 'npm.cmd'), '@echo shim\n');
  writeFileSync(path.join(cwd, 'node_modules/npm/bin/npm-cli.js'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');
  const args = ['test', 'a&b', 'quoted "text"', 'literal $() and %VALUE%'];
  const result = await run('npm', args, cwd, { PATH: cwd });
  assert.equal(result.exitCode, 0, result.err);
  assert.deepEqual(JSON.parse(result.out), args);
});

test('missing executables return a useful launch failure', async () => {
  const result = await run('hydra_nonexistent_program_73491', [], process.cwd());
  assert.equal(result.exitCode, 1);
  assert.equal(result.ok, false);
  assert.match(result.err, /ENOENT|not found|cannot find/i);
});
