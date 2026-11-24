import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles } from '../skills/hydra/scripts/lib/recall.mjs';

const CLI = fileURLToPath(new URL('../skills/hydra/scripts/hydra.mjs', import.meta.url));

// Stand-in embedding server: a text's vector counts topic words, so ranking is predictable.
function server() {
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const { input } = JSON.parse(body);
      const vec = (t) => ['release', 'holdout', 'kaggle', 'parser'].map((w) => (t.toLowerCase().match(new RegExp(w, 'g')) ?? []).length + 0.01);
      res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: vec(t) })) }));
    });
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` })));
}

function cli(args, env, cwd) {
  return new Promise((resolve) => execFile(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env } },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
}

function project() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hydra-recall-'));
  writeFileSync(path.join(dir, 'NOTES.md'), [
    '# Notes', '', '## Log',
    '- 2026-10-01: holdout scored on kaggle, 94%.',
    '- 2026-11-22: holdout rescored on kaggle, 97%.',
    '- 2026-11-23: release 0.3.7 published.', '',
  ].join('\n'));
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, 'src/parse.js'), 'export function parse(x) {\n  // parser for input\n  return x;\n}\n');
  writeFileSync(path.join(dir, 'src/other.txt'), 'not code, not notes');
  return dir;
}

test('listFiles picks markdown for notes and source for code', async () => {
  const dir = project();
  assert.deepEqual(await listFiles(dir, 'notes'), ['NOTES.md']);
  assert.deepEqual(await listFiles(dir, 'code'), ['src/parse.js']);
});

test('hydra recall returns verbatim note lines with file:line, newer note first when as relevant', async (t) => {
  const { s, url } = await server();
  t.after(() => s.close());
  const dir = project();
  const env = { HYDRA_EMBED_URL: url, HYDRA_HOME: mkdtempSync(path.join(os.tmpdir(), 'hydra-home-')), HYDRA_TELEMETRY: '0' };
  const { code, stdout } = await cli(['recall', 'holdout score on kaggle', '-k', '2'], env, dir);
  assert.equal(code, 0);
  const blocks = stdout.split('\n\n');
  assert.match(blocks[0], /^Best matches in 1 note file/);
  assert.equal(blocks[1], 'NOTES.md:5  (Notes > Log)\n- 2026-11-22: holdout rescored on kaggle, 97%.');
  assert.match(blocks[2], /^NOTES\.md:4 {2}\(Notes > Log\)\n- 2026-10-01: holdout scored on kaggle, 94%\./);

  const meaning = await cli(['search', '--meaning', 'where is the parser', '-k', '1'], env, dir);
  assert.equal(meaning.code, 0);
  assert.match(meaning.stdout, /src\/parse\.js:1-5\nexport function parse\(x\) \{/);

  assert.equal((await cli(['recall', 'x', '-k', '0'], env, dir)).code, 1);
});

test('hydra recall without the embedding model says how to install it and exits 2', async () => {
  const dir = project();
  const home = mkdtempSync(path.join(os.tmpdir(), 'hydra-home-'));
  const { code, stderr } = await cli(['recall', 'anything'], { HYDRA_EMBED_URL: '', HYDRA_HOME: home, HYDRA_TELEMETRY: '0' }, dir);
  assert.equal(code, 2);
  assert.match(stderr, /hydra embed install/);
  const status = await cli(['embed', 'status'], { HYDRA_HOME: home, HYDRA_TELEMETRY: '0' }, dir);
  assert.match(status.stdout, /model {3}not installed/);
});
