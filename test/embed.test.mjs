import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chunk, chunkMarkdown, buildIndex, search, noteDate, preferNewer } from '../skills/hydra/scripts/lib/embed.mjs';

test('noteDate reads only a date that opens the note', () => {
  assert.equal(noteDate('- 2026-11-24: v4 done'), '2026-11-24');
  assert.equal(noteDate('- **2026-11-20. Read head fixed.** body'), '2026-11-20');
  assert.equal(noteDate('Rescored on 2026-11-22 after fixes'), null);
  assert.equal(noteDate('| a | b |'), null);
});

test('preferNewer lifts a newer note only past older ones about as relevant', () => {
  const date = ['2026-10-01', '2026-11-20', null, '2026-11-22'];
  // 3 is newer than 0 and within 0.03 of it: it moves above 0. 1 is newer but far less relevant: stays.
  assert.deepEqual(preferNewer([0, 1, 2, 3], [0.80, 0.60, 0.70, 0.78], date, { delta: 0.03 }), [3, 0, 1, 2]);
  // Undated notes never move and are never jumped for being older.
  assert.deepEqual(preferNewer([2, 0], [0.80, 0.80, 0.81], date, { delta: 0.03 }), [2, 0]);
  // A newer note already above stays put.
  assert.deepEqual(preferNewer([3, 0], [0.80, 0.60, 0.70, 0.78], date), [3, 0]);
});

// Stand-in embedding server: a text's vector counts three marker words, so ranking is predictable.
function server() {
  const seen = [];
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const { input } = JSON.parse(body);
      seen.push(...input);
      const vec = (t) => ['alpha', 'beta', 'gamma'].map((w) => (t.match(new RegExp(w, 'g')) ?? []).length + 0.01);
      res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: vec(t) })) }));
    });
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({ s, seen, url: `http://127.0.0.1:${s.address().port}` })));
}

test('chunk makes overlapping line windows with 1-based line numbers', () => {
  const text = Array.from({ length: 75 }, (_, i) => `line ${i + 1}`).join('\n');
  const cs = chunk('a.js', text);
  assert.deepEqual(cs.map((c) => [c.start, c.end]), [[1, 40], [31, 70], [61, 75]]);
  assert.match(cs[1].text, /^line 31\n/);
  assert.deepEqual(chunk('empty.js', '\n\n'), []);
});

test('chunkMarkdown makes one chunk per list item or paragraph, with its heading path and lines', () => {
  const md = ['# Tracker', '', 'Intro line one', 'intro line two', '', '## Log', '- 2026-11-01: first entry', '  continues here',
    '- 2026-11-02: second entry', '', '```', '# not a heading', '- not an item', '```', '### Deep', '| a | b |', '| 1 | 2 |'].join('\n');
  const cs = chunkMarkdown('T.md', md);
  assert.deepEqual(cs.map((c) => [c.start, c.end, c.title]), [
    [3, 4, 'Tracker'], [7, 8, 'Tracker > Log'], [9, 9, 'Tracker > Log'], [11, 14, 'Tracker > Log'], [16, 17, 'Tracker > Log > Deep']]);
  assert.match(cs[1].text, /continues here$/);
  const long = chunkMarkdown('L.md', '- ' + 'Sentence number one is here. '.repeat(300), { max: 1000 });
  assert.ok(long.length > 1 && long.every((c) => c.text.length <= 1001 && c.start === 1));
});

test('search ranks by meaning vector, and re-indexing embeds only changed files', async (t) => {
  const { s, seen, url } = await server();
  t.after(() => s.close());
  const root = mkdtempSync(path.join(os.tmpdir(), 'hydra-embed-'));
  const dir = path.join(root, '.index');
  writeFileSync(path.join(root, 'a.txt'), 'alpha alpha alpha');
  writeFileSync(path.join(root, 'b.txt'), 'beta beta beta');
  let index = await buildIndex(root, ['a.txt', 'b.txt', 'missing.txt'], { url, dir });
  assert.equal(index.embedded, 2);
  assert.match(seen[0], /^title: a\.txt \| text: alpha/);
  const [top] = await search('beta', index, { url, k: 1 });
  assert.equal(top.file, 'b.txt');
  assert.match(seen.at(-1), /^task: code retrieval \| query: beta$/);

  writeFileSync(path.join(root, 'b.txt'), 'gamma gamma');
  seen.length = 0;
  index = await buildIndex(root, ['a.txt', 'b.txt'], { url, dir });
  assert.equal(index.embedded, 1);
  assert.deepEqual(seen.map((x) => x.split(' | text: ')[0]), ['title: b.txt']);
  assert.equal((await search('alpha', index, { url, k: 1 }))[0].file, 'a.txt');
  assert.equal((await search('gamma', index, { url, k: 1 }))[0].file, 'b.txt');
});
