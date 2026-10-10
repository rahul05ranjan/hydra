import assert from 'node:assert/strict';

// Check complete sets, ordered records and exact source lines. Command labels and footers cannot satisfy a fact.
export function score(spec, run, hydra = false) {
  const failures = [];
  const check = (label, fn) => { try { fn(); } catch { failures.push(label); } };
  check('expected exit code', () => assert.equal(run.exitCode, spec.expectedExitCode ?? 0));
  check('no execution error', () => assert.equal(run.error, null));
  if (hydra) check('no unverified model prose', () => assert.doesNotMatch(run.stdout, /Local model says:/));
  const lines = run.stdout.trimEnd().split('\n').filter(l => !/^\$ |^\[hydra |^File: |^Selected evidence:|^The local model/.test(l));
  const gold = spec.gold;
  const equals = (label, got, expected, sorted = false) => check(label, () =>
    assert.deepEqual(sorted ? [...got].sort() : got, sorted ? [...expected].sort() : expected));
  switch (gold.kind) {
    case 'source': {
      const got = hydra ? lines.filter(l => /^\d+:/.test(l)).map(l => l.replace(/^\d+: /, '')) : lines;
      equals('entire source slice', got, gold.lines);
      if (hydra) equals('source line numbers', lines.filter(l => /^\d+:/.test(l)).map(l => Number(l.split(':')[0])), gold.lines.map((_, i) => gold.start + i));
      break;
    }
    case 'definitions': {
      const got = lines.flatMap(l => [...l.matchAll(/\bexport (?:function|const) (\w+)/g)].map(m => m[1]));
      equals('all definitions', got, gold.names);
      break;
    }
    case 'hits': {
      const got = lines.map(l => l.trim().replace(/^\.\//, '')).filter(l => /^[\w./-]+:\d+:/.test(l));
      equals('all search hits in the same scope', got, gold.hits, true);
      if (hydra && gold.definition) check('definition ranked first', () => assert.ok(got[0]?.startsWith(gold.definition)));
      break;
    }
    case 'status':
      check('branch', () => assert.ok(lines.some(l => l.startsWith(`## ${gold.branch}`))));
      equals('all changed/untracked files and statuses', lines.filter(l => /^[ MADRCU?!]{2} /.test(l)), gold.entries, true);
      break;
    case 'changes':
      equals('exact changed-file set', lines.flatMap(l => { const m = l.match(/^\s*(.+?)\s+\|\s+\d+/); return m ? [m[1]] : []; }), gold.files, true);
      check('commit subject', () => assert.ok(lines.some(l => l.includes(gold.subject))));
      break;
    case 'commits':
      equals('all five complete commits in order', lines.filter(l => /^[a-f0-9]{7,40} \d{4}-\d{2}-\d{2} /.test(l)), gold.records);
      break;
    case 'branches':
      equals('all branch names', lines.flatMap(l => { const m = l.match(/^[* ]\s+(\S+)\s+[a-f0-9]{7,40}\s/); return m ? [m[1]] : []; }), gold.names, true);
      break;
    case 'log':
      equals('all failure or pass facts', lines.filter(l => /^(Tests:|Failures:|FAIL |AssertionError:|- Expected:|\+ Received:|at src\/)/.test(l)), gold.lines);
      check('no framework stack noise', () => assert.ok(!lines.some(l => /^node_modules\//.test(l))));
      break;
    case 'stash':
      equals('complete stash list', lines.filter(l => /^stash@\{\d+\}:/.test(l)), gold.records);
      if (!gold.records.length) check('explicit empty result', () => assert.ok(!hydra || lines.includes('(no output)')));
      break;
    default: failures.push('unknown scoring rule');
  }
  return { passed: failures.length === 0, failures };
}
