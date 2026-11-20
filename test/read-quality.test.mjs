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

test('a Go outline lists funcs, methods and every type spec, and no var or const', () => {
  const content = [
    'package queue', '', 'import "fmt"', '',
    'var registry = map[string]struct {', '\tname string', '}{}', '',
    'const limit = 3', '',
    'type Mode int', '',
    'type Handler func(job string) error', '',
    'type Alias = Mode', '',
    'type List[T any] struct {', '\titems []T', '}', '',
    'type (', '\t// Grouped specs belong to the outline too.', '\tState uint8', '\tEntry struct {', '\t\tkey string', '\t}', ')', '',
    'func Map[T, U any](in []T, f func(T) U) []U {', '\treturn nil', '}', '',
    'func (l *List[T]) Push(item T) {', '\tl.items = append(l.items, item)', '}', '',
    'func main() { fmt.Println(limit) }',
  ].join('\n');
  assert.deepEqual(outline(content, 'queue.go').map(item => `${item.line} ${item.name}`),
    ['11 Mode', '13 Handler', '15 Alias', '17 List', '23 State', '24 Entry', '29 Map', '33 Push', '37 main']);
});

test('a generic Go function is found by name as a definition, not a call site', () => {
  const content = ['package fp', '', 'func use() { _ = Map[int, int](nil, nil) }', '', 'func Map[T, U any](in []T, f func(T) U) []U {', '\tout := make([]U, 0, len(in))', '\treturn out', '}', ''].join('\n');
  const res = sliceSymbol(content, 'Map');
  assert.equal(res.start, 5);
});

test('outlines keep to each language: generators, unsafe traits, and no matches inside strings', () => {
  const js = ['function* walk(node) {', '  yield node;', '}', 'async function* tick(ms) {', '  yield ms;', '}'].join('\n');
  assert.deepEqual(outline(js, 'gen.js').map(item => item.line), [1, 4]);
  const rs = ['pub(super) unsafe trait CopySpec: Clone {}', 'unsafe trait Radix: Sized {}', 'pub fn run() {}'].join('\n');
  assert.deepEqual(outline(rs, 'lib.rs').map(item => item.line), [1, 2, 3]);
  const py = ['"""Scheduler.', '', 'function is allowed to modify the queue.', 'class Inside:', '"""', '', 'SOURCE = """', 'class AlsoInside:', '    pass', '"""', '', 'class Real:', '    pass', '', 'def run():', '    pass'].join('\n');
  assert.deepEqual(outline(py, 'sched.py').map(item => item.line), [12, 15]);
  const go = ['package gen', '', 'const tmpl = `', 'func (e *{{ .Element }}) One() *{{ .Element }} {', '}', '`', '', 'func Render() string { return tmpl }'].join('\n');
  assert.deepEqual(outline(go, 'generate.go').map(item => item.line), [8]);
});

test('symbol lookups match case first, keep to the language and end where the definition ends', () => {
  const go = ['package s', '', '// Insert adds obj.', 'func (s *Scope) Insert(obj int) {', '\ts.insert(obj)', '}', '', 'func (s *Scope) insert(obj int) {', '\t_ = obj', '}', '',
    'func castagnoli(', '\tcrcA, crcB uint32,', '\tb []byte,', ')', '', 'func next() {}'].join('\n');
  assert.deepEqual([sliceSymbol(go, 'insert', 40, 's.go').start, sliceSymbol(go, 'insert', 40, 's.go').end], [8, 10]);
  assert.deepEqual([sliceSymbol(go, 'castagnoli', 40, 's.go').start, sliceSymbol(go, 'castagnoli', 40, 's.go').end], [12, 15]);
  const rs = ['impl S {', '    pub fn push(&mut self) {', '        let len = self.len();', '    }', '}', 'trait Spec {', '    fn spec(self) -> u8;', '}', 'impl Spec for S {',
    '    default fn spec(self) -> u8 {', '        0', '    }', '}', 'impl S {', '    pub fn len(&self) -> usize {', '        0', '    }', '}'].join('\n');
  assert.equal(sliceSymbol(rs, 'len', 40, 'lib.rs').start, 15);
  assert.equal(sliceSymbol(rs, 'spec', 40, 'lib.rs').start, 10);
  const py = ['SAMPLE = """', 'def run():', '    pass', '"""', '', 'def set_content(msg):', '    def body(lines): return b"".join(lines)', '    if msg:', '        msg.send()', '        # retry later', '', 'def run():', '    return 1'].join('\n');
  assert.deepEqual([sliceSymbol(py, 'body', 40, 'cm.py').start, sliceSymbol(py, 'body', 40, 'cm.py').end], [7, 7]);
  assert.deepEqual([sliceSymbol(py, 'set_content', 40, 'cm.py').start, sliceSymbol(py, 'set_content', 40, 'cm.py').end], [6, 9]);
  assert.equal(sliceSymbol(py, 'run', 40, 'cm.py').start, 12);
  const js = ['function toFile(url) {', "  if (url && url.startsWith('file://')) {", '    return url.slice(7);', '  }', '  return url;', '}', '', 'function other() {}'].join('\n');
  assert.deepEqual([sliceSymbol(js, 'toFile', 40, 'h.js').start, sliceSymbol(js, 'toFile', 40, 'h.js').end], [1, 6]);
});
