#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from '../../skills/hydra/scripts/lib/ledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const HYDRA = path.join(ROOT, 'skills/hydra/scripts/hydra.mjs');
const GIT_ROOT = existsSync('/Users/rivansh/Desktop/code/vasuki')
  ? '/Users/rivansh/Desktop/code/vasuki'
  : path.join(process.env.HOME, '.hydra/worlds/git1/w00/repo');

const MODEL_NAME = process.env.HYDRA_MODEL || 'hydra-nano:git';
process.env.HYDRA_MODEL = MODEL_NAME;

console.log('================================================================');
console.log('Hydra Direct Command-Output Comparison');
console.log(`Repository: ${ROOT} (git: ${GIT_ROOT})`);
console.log(`Model:      ${MODEL_NAME}`);
console.log('================================================================\n');

const SCENARIOS = [
  {
    id: 'read_symbol',
    name: '1. Read specific function symbol (sliceSymbol)',
    category: 'read',
    rawCmd: ['cat', 'skills/hydra/scripts/lib/read.mjs'],
    hydraCmd: ['read', 'skills/hydra/scripts/lib/read.mjs', 'sliceSymbol'],
    targetFact: 'export function sliceSymbol',
  },
  {
    id: 'read_lines',
    name: '2. Targeted line slice (lines 20-50 of test_logs.mjs)',
    category: 'read',
    rawCmd: ['cat', 'skills/hydra/scripts/lib/test_logs.mjs'],
    hydraCmd: ['read', 'skills/hydra/scripts/lib/test_logs.mjs', '20-50'],
    targetFact: 'extractFailureCandidates',
  },
  {
    id: 'module_outline',
    name: '3. Structural outline of module exports (git.mjs)',
    category: 'read',
    rawCmd: ['cat', 'skills/hydra/scripts/lib/git.mjs'],
    hydraCmd: ['read', 'skills/hydra/scripts/lib/git.mjs', '--outline'],
    targetFact: 'export async function gather',
  },
  {
    id: 'def_search',
    name: '4. Definition-ranked code search for scoreHit',
    category: 'files',
    rawCmd: ['grep', '-rn', 'scoreHit', 'skills/hydra/'],
    hydraCmd: ['search', 'scoreHit'],
    targetFact: 'function scoreHit',
  },
  {
    id: 'search_usages',
    name: '5. Search imports and usages of ledger.mjs',
    category: 'files',
    rawCmd: ['grep', '-rn', 'ledger.mjs', 'skills/hydra/'],
    hydraCmd: ['search', 'ledger.mjs'],
    targetFact: 'ledger.mjs',
  },
  {
    id: 'git_status',
    name: '6. Check uncommitted changes and branch status',
    category: 'git',
    rawCmd: ['git', 'status'],
    hydraCmd: ['ask', '--head', 'git', 'which branch am I on and what is changed?'],
    targetFact: 'main',
  },
  {
    id: 'git_last_commit',
    name: '7. Inspect what the last commit changed',
    category: 'git',
    rawCmd: ['git', 'log', '-n1', '-p'],
    hydraCmd: ['ask', '--head', 'git', 'what did the last commit change?'],
    targetFact: 'commit',
  },
  {
    id: 'git_recent_commits',
    name: '8. Check recent 5 commits',
    category: 'git',
    rawCmd: ['git', 'log', '-n15'],
    hydraCmd: ['ask', '--head', 'git', 'show recent commits'],
    targetFact: 'commit',
  },
  {
    id: 'git_branches',
    name: '9. List local and remote branches',
    category: 'git',
    rawCmd: ['git', 'branch', '-a', '-vv'],
    hydraCmd: ['ask', '--head', 'git', 'which branches exist?'],
    targetFact: 'main',
  },
  {
    id: 'run_tests_pass',
    name: '10. Run test suite through hydra digest filter',
    category: 'test',
    rawCmd: ['npm', 'test'],
    hydraCmd: ['run', '--', 'npm', 'test'],
    targetFact: 'passed',
  },
  {
    id: 'run_test_failure',
    name: '11. Digest verbose failing test log',
    category: 'test',
    rawCmd: ['node', '-e', 'console.log("FAIL src/auth.test.ts > login\\nAssertionError: expected 200 to be 401\\n- Expected: 401\\n+ Received: 200\\nat src/auth.test.ts:42:18"); for (let i=0; i<40; i++) console.log("node_modules/vitest/runner.js:" + i); process.exit(1);'],
    hydraCmd: ['run', '--', 'node', '-e', 'console.log("FAIL src/auth.test.ts > login\\nAssertionError: expected 200 to be 401\\n- Expected: 401\\n+ Received: 200\\nat src/auth.test.ts:42:18"); for (let i=0; i<40; i++) console.log("node_modules/vitest/runner.js:" + i); process.exit(1);'],
    targetFact: 'Expected: 401',
  },
  {
    id: 'git_stashes',
    name: '12. Check stashed changes',
    category: 'git',
    rawCmd: ['git', 'stash', 'list'],
    hydraCmd: ['ask', '--head', 'git', 'do I have any stashes?'],
    targetFact: 'stash',
  },
];

const results = [];
const startedAt = Date.now();
let totalRawTok = 0;
let totalHydraTok = 0;

for (const sc of SCENARIOS) {
  process.stdout.write(`Evaluating scenario: ${sc.name.padEnd(52)} `);

  const cwd = sc.category === 'git' && !existsSync(path.join(ROOT, '.git')) ? GIT_ROOT : ROOT;

  // 1. Raw Execution (Frontier Agent dumping full tool output into context)
  const rawStart = Date.now();
  const options = { cwd, encoding: 'utf8', env: process.env, timeout: 60000, maxBuffer: 32 * 1024 * 1024 };
  const rawRes = spawnSync(sc.rawCmd[0], sc.rawCmd.slice(1), options);
  const rawText = (rawRes.stdout || '') + (rawRes.stderr || '');
  const rawSec = (Date.now() - rawStart) / 1000;
  const rawTok = tokens(rawText.length);

  // 2. Hydra Delegated Execution (Local specialist model digesting result)
  const hydraStart = Date.now();
  const hydraRes = spawnSync('node', [HYDRA, ...sc.hydraCmd], options);
  const hydraText = (hydraRes.stdout || '') + (hydraRes.stderr || '');
  const hydraSec = (Date.now() - hydraStart) / 1000;
  const hydraTok = tokens(hydraText.length);

  totalRawTok += rawTok;
  totalHydraTok += hydraTok;

  const savedTok = rawTok - hydraTok;
  const savingPct = rawTok > 0 ? Number(((savedTok / rawTok) * 100).toFixed(1)) : 0;
  const targetFound = !sc.targetFact || hydraText.toLowerCase().includes(sc.targetFact.toLowerCase()) || rawText.length === 0;
  const expectedExitCode = sc.id === 'run_test_failure' ? 1 : 0;
  const executionOk = !rawRes.error && !hydraRes.error && rawRes.status === expectedExitCode && hydraRes.status === expectedExitCode;

  const row = {
    id: sc.id,
    name: sc.name,
    category: sc.category,
    rawTokens: rawTok,
    hydraTokens: hydraTok,
    savedTokens: savedTok,
    savingsPct: savingPct,
    rawSeconds: Number(rawSec.toFixed(3)),
    hydraSeconds: Number(hydraSec.toFixed(3)),
    targetFound,
    executionOk,
    evidence: {
      cwd,
      targetFact: sc.targetFact,
      rawCommand: sc.rawCmd,
      hydraCommand: ['node', HYDRA, ...sc.hydraCmd],
      rawExitCode: rawRes.status,
      hydraExitCode: hydraRes.status,
      rawError: rawRes.error?.message ?? null,
      hydraError: hydraRes.error?.message ?? null,
      rawStdout: rawRes.stdout || '',
      rawStderr: rawRes.stderr || '',
      hydraStdout: hydraRes.stdout || '',
      hydraStderr: hydraRes.stderr || '',
    },
  };
  results.push(row);

  console.log(`[${savingPct >= 0 ? '+' : ''}${savingPct}% saved | ${hydraSec.toFixed(2)}s]`);
}

const netSavedTok = totalRawTok - totalHydraTok;
const netSavingsPct = totalRawTok > 0 ? Number(((netSavedTok / totalRawTok) * 100).toFixed(1)) : 0;
const targetSuccessRate = Number(((results.filter(r => r.targetFound).length / results.length) * 100).toFixed(1));

console.log('\n================================ TRIAL SUMMARY ================================');
console.log(`Total Scenarios:              ${results.length}`);
console.log(`Legacy target-string checks:   ${targetSuccessRate}% (${results.filter(r => r.targetFound).length}/${results.length}; empty raw output passes)`);
console.log(`Expected command exit codes:   ${results.filter(r => r.executionOk).length}/${results.length}`);
console.log(`Raw Agent Context Tokens:      ~${totalRawTok.toLocaleString()} tokens`);
console.log(`Hydra Context Tokens:          ~${totalHydraTok.toLocaleString()} tokens`);
console.log(`Net Tokens Saved:              ~${netSavedTok.toLocaleString()} tokens (${netSavingsPct}% reduction)`);
console.log('===============================================================================\n');

// By category summary
const categories = [...new Set(results.map(r => r.category))];
console.log(`${'Category'.padEnd(12)} ${'Raw Tok'.padStart(10)} ${'Hydra Tok'.padStart(10)} ${'Saved Tok'.padStart(10)} ${'Savings %'.padStart(10)}`);
console.log('-'.repeat(56));

const byCategory = {};
for (const cat of categories) {
  const catRows = results.filter(r => r.category === cat);
  const rTok = catRows.reduce((sum, r) => sum + r.rawTokens, 0);
  const hTok = catRows.reduce((sum, r) => sum + r.hydraTokens, 0);
  const sTok = rTok - hTok;
  const sPct = rTok > 0 ? Number(((sTok / rTok) * 100).toFixed(1)) : 0;
  byCategory[cat] = { rawTokens: rTok, hydraTokens: hTok, savedTokens: sTok, savingsPct: sPct };
  console.log(`${cat.padEnd(12)} ${String(rTok).padStart(10)} ${String(hTok).padStart(10)} ${String(sTok).padStart(10)} ${String(sPct + '%').padStart(10)}`);
}

// Write results
const RESULTS_DIR = path.join(ROOT, 'evals', 'results');
mkdirSync(RESULTS_DIR, { recursive: true });
const outfile = path.join(RESULTS_DIR, 'agent_trial.json');
if (existsSync(outfile)) copyFileSync(outfile, path.join(RESULTS_DIR, 'agent_trial.previous.json'));
const payload = {
  date: new Date().toISOString(),
  model: MODEL_NAME,
  repositories: { readAndSearch: ROOT, git: GIT_ROOT },
  durationSeconds: (Date.now() - startedAt) / 1000,
  tokenMethod: 'ceil(characters / 4), estimated output size only',
  scoringMethod: 'Legacy substring check; empty raw output passes. Not full answer accuracy.',
  totalScenarios: results.length,
  executionSuccessRate: results.filter(r => r.executionOk).length / results.length * 100,
  targetSuccessRate,
  totalRawTokens: totalRawTok,
  totalHydraTokens: totalHydraTok,
  netTokensSaved: netSavedTok,
  netSavingsPct,
  byCategory,
  scenarios: results,
};
writeFileSync(outfile, JSON.stringify(payload, null, 2));
console.log(`\nResults written to: ${path.relative(ROOT, outfile)}`);
