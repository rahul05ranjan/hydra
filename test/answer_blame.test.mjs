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
