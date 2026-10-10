#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from '../../skills/hydra/scripts/lib/ledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const HYDRA = path.join(ROOT, 'skills/hydra/scripts/hydra.mjs');

console.log('======================================================');
console.log('🔬 Hydra Real-Repo Token Savings Benchmark');
console.log(`Repository: ${ROOT}`);
console.log('======================================================\n');

const SCENARIOS = [
  {
    name: '1. Read function definition in a large file',
    head: 'read',
    rawCmd: ['cat', 'skills/hydra/scripts/lib/read.mjs'],
    hydraCmd: [HYDRA, 'read', 'skills/hydra/scripts/lib/read.mjs', 'sliceSymbol'],
  },
  {
    name: '2. Structural outline of multi-function module',
    head: 'read',
    rawCmd: ['cat', 'skills/hydra/scripts/lib/test_logs.mjs'],
    hydraCmd: [HYDRA, 'read', 'skills/hydra/scripts/lib/test_logs.mjs', '--outline'],
  },
  {
    name: '3. Search for symbol definition across repo',
    head: 'files',
    rawCmd: ['grep', '-rn', 'scoreHit', 'skills/hydra/'],
    hydraCmd: [HYDRA, 'search', 'scoreHit'],
  },
  {
    name: '4. Run test suite through hydra',
    head: 'test',
    rawCmd: ['npm', 'test'],
    hydraCmd: [HYDRA, 'run', '--', 'npm', 'test'],
  },
  {
    name: '5. Ask git repo questions',
    head: 'git',
    rawCmd: ['git', 'log', '-n15'],
    hydraCmd: [HYDRA, 'ask', '--head', 'git', 'what was the last commit?'],
  },
];

let totalRawTokens = 0;
let totalHydraTokens = 0;

for (const sc of SCENARIOS) {
  process.stdout.write(`Evaluating: ${sc.name}... `);

  // Raw execution
  const rawRes = spawnSync(sc.rawCmd[0], sc.rawCmd.slice(1), { cwd: ROOT, encoding: 'utf8' });
  const rawText = (rawRes.stdout || '') + (rawRes.stderr || '');
  const rawTok = tokens(rawText.length);

  // Hydra execution
  const start = Date.now();
  const hydraRes = spawnSync('node', sc.hydraCmd, { cwd: ROOT, encoding: 'utf8' });
  const duration = ((Date.now() - start) / 1000).toFixed(2);
  const hydraText = (hydraRes.stdout || '') + (hydraRes.stderr || '');
  const hydraTok = tokens(hydraText.length);

  totalRawTokens += rawTok;
  totalHydraTokens += hydraTok;

  const savedTok = Math.max(0, rawTok - hydraTok);
  const savingPct = rawTok > 0 ? ((savedTok / rawTok) * 100).toFixed(1) : 0;

  console.log('DONE');
  console.log(`  Raw tool output:   ~${rawTok} tokens`);
  console.log(`  Hydra output:      ~${hydraTok} tokens`);
  console.log(`  Context savings:   ~${savedTok} tokens (${savingPct}%) in ${duration}s\n`);
}

const netSaved = Math.max(0, totalRawTokens - totalHydraTokens);
const netSavedPct = totalRawTokens > 0 ? ((netSaved / totalRawTokens) * 100).toFixed(1) : 0;

console.log('================== TOTAL RESULTS ==================');
console.log(`Raw Context Load:    ~${totalRawTokens} tokens`);
console.log(`Hydra Context Load:  ~${totalHydraTokens} tokens`);
console.log(`Net Tokens Saved:    ~${netSaved} tokens (${netSavedPct}% reduction)`);
console.log('===================================================');
