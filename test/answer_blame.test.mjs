import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answer } from '../skills/hydra/scripts/lib/answer.mjs';

test('blame retains the exact named line even beyond the normal output slice', async () => {
  const target = 'a1b2c3 (Mira Shah 2026-06-12 137) const invoiceTotal = calculateTotal();';
  const out = Array.from({ length: 150 }, (_, i) => i === 136 ? target : `${i} ${'ordinary source '.repeat(8)}`).join('\n');
  const result = await answer('Who wrote the line containing invoiceTotal in billing.js?',
    [{ probe: 'blame', cmd: 'git blame -- billing.js', out }], () => { throw new Error('Named evidence should need no model call'); });
  assert.equal(result.text, `$ git blame -- billing.js\n${target}`);
  assert.equal(result.rawChars, out.length);
});

test('ambiguous blame anchors retain the bounded model selection path', async () => {
  const out = Array.from({ length: 100 }, (_, i) => `${i} const invoiceTotal = ${i};`).join('\n');
  let calls = 0;
  const result = await answer('Who wrote the line containing invoiceTotal?',
    [{ probe: 'blame', cmd: 'git blame -- billing.js', out }], async () => { calls++; return { lines: [10] }; });
  assert.equal(calls, 1);
  assert.ok(result.text.length < out.length);
});

test('numeric blame requests do not mistake filename tokens for source identifiers', async () => {
  const target = 'abcd123 (Mira Shah 2026-06-12 40) requested source';
  const out = Array.from({ length: 50 }, (_, i) => i === 39 ? target :
    `abcd123 (Other 2026-06-12 ${i + 1}) ${i === 9 ? 'const version2 = 1;' : 'ordinary source '.repeat(4)}`).join('\n');
  let calls = 0;
  const result = await answer('Who wrote line 40 in version2.js?',
    [{ probe: 'blame', cmd: 'git blame -- version2.js', out }], async () => { calls++; return { lines: [40] }; });
  assert.equal(calls, 1);
  assert.ok(result.text.includes(target));
});

test('diffstat file inventory remains visible when a model cites only one patch line', async () => {
  const stats = Array.from({ length: 6 }, (_, i) => ` src/module${i}.js | 2 +-`);
  const out = [...stats, ' 6 files changed, 6 insertions(+), 6 deletions(-)', '',
    'diff --git a/src/module0.js b/src/module0.js', ...Array.from({ length: 40 }, () => '+source content '.repeat(4))].join('\n');
  const result = await answer('Which files changed in this branch comparison?',
    [{ probe: 'diff', cmd: 'git diff trunk...HEAD', out }], async () => ({ lines: [12] }));
  for (const line of stats) assert.ok(result.text.includes(line), line);
});
