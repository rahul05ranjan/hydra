import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gather, outline, sliceSymbol } from '../skills/hydra/scripts/lib/read.mjs';

async function gatherFixture(question, content) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'hydra-read-regression-'));
  try {
    mkdirSync(path.join(cwd, 'source files'));
    writeFileSync(path.join(cwd, 'source files/example.js'), content);
    return (await gather(question, cwd, () => { throw new Error('Unexpected model call'); }))[0].out;
  } finally {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(cwd));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.ok(path.basename(cwd).startsWith('hydra-read-regression-'));
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('read gather preserves explicitly requested Read/read and short identifiers', async () => {
  for (const [name, question] of [
    ['read', 'show read in "source files/example.js"'],
    ['Read', 'read "source files/example.js" at function Read'],
    ['xy', 'show xy in "source files/example.js"'],
  ]) {
    const content = `function ${name}(value) {\n  return value;\n}\n\nfunction outside() {\n  return 0;\n}\n`;
    const output = await gatherFixture(question, content);
    assert.ok(output.includes(`function ${name}(value)`));
    assert.ok(!output.includes('function outside'), question);
  }
});

test('Rust const/unsafe/extern functions prefer the declaration over earlier calls', () => {
  for (const modifiers of ['const', 'unsafe', 'pub const', 'pub(crate) unsafe extern "C"', 'pub const unsafe']) {
    const content = `fn caller() { selected(); }\n\n${modifiers} fn selected() -> u32 {\n    1\n}\n\nfn outside() {}\n`;
    const result = sliceSymbol(content, 'selected');
    assert.equal(result.start, 3, modifiers);
    assert.equal(result.end, 5, modifiers);
    assert.ok(!result.text.includes('caller'), modifiers);
    assert.ok(!result.text.includes('outside'), modifiers);
  }
});

test('bodyless Go function declarations end before unrelated code', () => {
  const content = 'package fixture\n\nfunc trampoline() // body is provided externally\n\nfunc outside() {\n  println("unrelated")\n}\n';
  const result = sliceSymbol(content, 'trampoline');
  assert.equal(result.start, 3);
  assert.equal(result.end, 3);
  assert.equal(result.text, '3: func trampoline() // body is provided externally');
});

test('JavaScript outlines retain destructured and uninitialized top-level bindings', () => {
  const content = 'const {\n  one, two: renamed,\n} = require("example");\nlet error;\nconst [first, second] = values;\nfunction outside() {}\n';
  assert.deepEqual(outline(content).map(item => item.line), [1, 4, 5, 6]);
});

test('outline binding recognition does not promote comments, nested code or Rust typed constants', () => {
  const content = '// const { imaginary } = value;\n  let nested;\nconst RUST_ITEM: u32 = 3;\n"let text;";\nfunction real() {}\n';
  assert.deepEqual(outline(content).map(item => item.line), [5]);
});

test('existing brace and string boundary handling survives declaration recognition', () => {
  const content = 'function selected() {\n  const text = "{ }";\n  const regex = /[{}]/;\n  // { deliberately unbalanced comment\n  return text;\n}\nfunction outside() {}\n';
  const result = sliceSymbol(content, 'selected');
  assert.equal(result.start, 1);
  assert.equal(result.end, 6);
  assert.ok(!result.text.includes('function outside'));
});
