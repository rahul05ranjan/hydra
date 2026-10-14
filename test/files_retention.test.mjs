import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../skills/hydra/scripts/lib/files.mjs';
import { run } from '../skills/hydra/scripts/lib/exec.mjs';

const haveRg = (await run('rg', ['--version'], process.cwd())).ok;
const backends = haveRg ? [false, true] : [false];

async function workspace(t, files) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'hydra-files-retention-'));
  t.after(async () => {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(cwd));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe cleanup target');
    await rm(cwd, { recursive: true, force: true });
  });
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(cwd, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return cwd;
}

test('Files retains a late declaration before per-file and per-term display caps', async t => {
  const references = Array.from({ length: 4000 }, (_, i) => `retainTarget(${i})`);
  const definition = 'def retainTarget(value):';
  const files = { 'src/z-target.py': [...references, definition, '    return value', ''].join('\n') };
  for (let i = 0; i < 16; i++) files[`app/caller-${String(i).padStart(2, '0')}.py`] = references.join('\n') + '\n';
  files['app/import.py'] = 'from module import retainTarget\n';
  files['docs/navigation.md'] = 'retainTarget is mentioned in documentation.\n';
  files['evals/results/archived.py'] = 'def retainTarget(value): return "archived"\n';
  files['assets/generated.min.js'] = 'function retainTarget(){return "noise";}\n';
  const cwd = await workspace(t, files);
  const results = [];
  for (const useRg of backends) {
    const hits = (await scan(cwd, ['retainTarget'], useRg)).hits.get('retainTarget');
    assert.equal(hits[0], `src/z-target.py:${references.length + 1}:${definition}`);
    assert.equal(hits.length, 40);
    const perFile = new Map();
    for (const hit of hits) {
      const file = hit.slice(0, hit.indexOf(':'));
      perFile.set(file, (perFile.get(file) || 0) + 1);
    }
    assert.ok([...perFile.values()].every(count => count <= 3));
    assert.ok(hits.every(hit => !hit.startsWith('assets/generated.min.js:')));
    results.push(hits);
  }
  if (results.length === 2) assert.deepEqual(results[0], results[1]);
});

test('Files keeps fixed-string terms literal in both scanners', async t => {
  const term = 'retain[.+]';
  const cwd = await workspace(t, {
    'src/literal.js': `const marker = "${term}";\n`,
    'src/near-miss.js': 'const marker = "retainX";\n',
  });
  const results = [];
  for (const useRg of backends) {
    const hits = (await scan(cwd, [term], useRg)).hits.get(term);
    assert.deepEqual(hits, [`src/literal.js:1:const marker = "${term}";`]);
    results.push(hits);
  }
  if (results.length === 2) assert.deepEqual(results[0], results[1]);
});
