#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tokens } from '../../skills/hydra/scripts/lib/ledger.mjs';
import * as files from '../../skills/hydra/scripts/lib/files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const TASKS_FILE = path.join(HERE, 'tasks.json');
const RESULTS_FILE = path.join(ROOT, 'evals', 'results', 'files.json');

const tasks = JSON.parse(readFileSync(TASKS_FILE, 'utf8'));

console.log('================================================================');
console.log(`🔎 Hydra Files / Search Head Benchmark (${tasks.length} tasks)`);
console.log('================================================================\n');

const started = Date.now();
const results = [];
let totalRawTokens = 0;
let totalHydraTokens = 0;

for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i];
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'hydra-eval-files-'));

  // Scaffold files
  for (const [relPath, content] of Object.entries(task.files)) {
    const fullPath = path.join(tmpDir, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }

  // 1. Raw grep
  const rawStart = Date.now();
  const rawRes = spawnSync('grep', ['-rn', '-i', task.query, '.'], { cwd: tmpDir, encoding: 'utf8' });
  const rawText = (rawRes.stdout || '') + (rawRes.stderr || '');
  const rawSec = (Date.now() - rawStart) / 1000;
  const rawTok = tokens(rawText.length);

  // 2. Hydra files scan with definition-first ranking
  const hydraStart = Date.now();
  const scanRes = await files.scan(tmpDir, [task.query]);
  const hits = scanRes.hits.get(task.query) || [];
  const hydraSec = (Date.now() - hydraStart) / 1000;

  // Render hits text
  const renderedText = hits.join('\n');
  const hydraTok = tokens(renderedText.length);

  totalRawTokens += rawTok;
  totalHydraTokens += hydraTok;

  const gold = task.gold;

  // Metric 1: Definition Recall
  const defHitIndex = hits.findIndex(h => h.includes(gold.targetDefLine));
  const defFound = defHitIndex !== -1;

  // Metric 2: Top-1 Accuracy (Is the definition ranked first?)
  const top1Match = defHitIndex === 0;

  // Metric 3: Import Ordering (Is definition ranked before import lines?)
  let rankedBeforeImports = true;
  if (defFound && gold.importLines?.length) {
    for (const imp of gold.importLines) {
      const impIndex = hits.findIndex(h => h.includes(imp));
      if (impIndex !== -1 && impIndex < defHitIndex) {
        rankedBeforeImports = false;
        break;
      }
    }
  }

  // Metric 4: Noise Cleanliness (No forbidden files present)
  let noiseClean = true;
  if (gold.forbiddenFiles?.length) {
    for (const fb of gold.forbiddenFiles) {
      if (hits.some(h => h.includes(fb))) {
        noiseClean = false;
        break;
      }
    }
  }

  const solved = defFound && rankedBeforeImports && noiseClean;
  const mrr = defFound ? 1 / (defHitIndex + 1) : 0;

  results.push({
    id: task.id,
    name: task.name,
    query: task.query,
    hitsCount: hits.length,
    defFound,
    defRank: defHitIndex !== -1 ? defHitIndex + 1 : null,
    top1Match,
    rankedBeforeImports,
    noiseClean,
    solved,
    mrr: Number(mrr.toFixed(3)),
    rawTokens: rawTok,
    hydraTokens: hydraTok,
    hydraSeconds: Number(hydraSec.toFixed(3)),
  });

  const statusStr = solved ? '✔ SOLVED' : '✘ FAIL';
  const rankStr = defFound ? `rank #${defHitIndex + 1}` : 'not found';
  console.log(`[${String(i + 1).padStart(2)}/${tasks.length}] ${statusStr.padEnd(9)} | ${task.name.padEnd(52)} | ${rankStr.padEnd(9)} | ${(hydraSec * 1000).toFixed(0)}ms`);
}

const totalTimeSec = Number(((Date.now() - started) / 1000).toFixed(2));
const solvedCount = results.filter(r => r.solved).length;
const solvedPct = Number(((solvedCount / results.length) * 100).toFixed(1));
const top1Count = results.filter(r => r.top1Match).length;
const top1Pct = Number(((top1Count / results.length) * 100).toFixed(1));
const defRecallCount = results.filter(r => r.defFound).length;
const defRecallPct = Number(((defRecallCount / results.length) * 100).toFixed(1));
const avgMrr = Number((results.reduce((sum, r) => sum + r.mrr, 0) / results.length).toFixed(3));
const cleanCount = results.filter(r => r.noiseClean).length;
const cleanPct = Number(((cleanCount / results.length) * 100).toFixed(1));
const netSavedTokens = Math.max(0, totalRawTokens - totalHydraTokens);
const netSavingsPct = totalRawTokens > 0 ? Number(((netSavedTokens / totalRawTokens) * 100).toFixed(1)) : 0;

console.log('\n============================= BENCHMARK SUMMARY =============================');
console.log(`Total Tasks:               ${tasks.length}`);
console.log(`Solved Accuracy:           ${solvedPct}% (${solvedCount}/${tasks.length})`);
console.log(`Top-1 Definition Match:    ${top1Pct}% (${top1Count}/${tasks.length})`);
console.log(`Definition Recall:         ${defRecallPct}% (${defRecallCount}/${tasks.length})`);
console.log(`Mean Reciprocal Rank (MRR): ${avgMrr}`);
console.log(`Noise Cleanliness:         ${cleanPct}% (${cleanCount}/${tasks.length})`);
console.log(`Raw Grep Tokens:           ~${totalRawTokens.toLocaleString()} tokens`);
console.log(`Hydra Ranked Tokens:       ~${totalHydraTokens.toLocaleString()} tokens`);
console.log(`Net Context Reduction:     ${netSavingsPct}% (~${netSavedTokens.toLocaleString()} tokens saved)`);
console.log(`Total Runtime:             ${totalTimeSec}s (~${(totalTimeSec * 1000 / tasks.length).toFixed(1)}ms/task)`);
console.log('=============================================================================\n');

// Write results
mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
const payload = {
  date: new Date().toISOString(),
  head: 'files',
  totalTasks: tasks.length,
  overall: {
    solved: Number((solvedPct / 100).toFixed(3)),
    top1: Number((top1Pct / 100).toFixed(3)),
    defRecall: Number((defRecallPct / 100).toFixed(3)),
    mrr: avgMrr,
    cleanliness: Number((cleanPct / 100).toFixed(3)),
    rawTokens: totalRawTokens,
    returnedTokens: totalHydraTokens,
    savingsPct: netSavingsPct,
    seconds: totalTimeSec,
  },
  tasks: results,
};

writeFileSync(RESULTS_FILE, JSON.stringify(payload, null, 2));
console.log(`Results written to: ${path.relative(ROOT, RESULTS_FILE)}`);
