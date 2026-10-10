#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from '../../skills/hydra/scripts/lib/ledger.mjs';
import * as read from '../../skills/hydra/scripts/lib/read.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const TASKS_FILE = path.join(HERE, 'tasks.json');
const RESULTS_FILE = path.join(ROOT, 'evals', 'results', 'read.json');

const tasks = JSON.parse(readFileSync(TASKS_FILE, 'utf8'));

console.log(`Evaluating read head on ${tasks.length} tasks...`);
const started = Date.now();

const results = [];
let totalRaw = 0;
let totalReturned = 0;

for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i];
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'hydra-eval-read-'));
  const filePath = path.join(tmpDir, task.file);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, task.content);

  let outputText = '';
  let rawChars = task.content.length;

  if (task.question) {
    const sections = await read.gather(task.question, tmpDir, null);
    outputText = sections.map(s => s.out).join('\n\n');
  } else {
    const res = await read.readSlice(task.file, task.query, tmpDir);
    outputText = res.ok ? res.text : res.error;
    if (res.rawChars) rawChars = res.rawChars;
  }

  const rawTok = tokens(rawChars);
  const returnedTok = tokens(outputText.length);
  totalRaw += rawTok;
  totalReturned += returnedTok;

  const gold = task.gold;
  const targetHits = gold.targetLines.filter(line => outputText.includes(line));
  const targetRecall = gold.targetLines.length ? targetHits.length / gold.targetLines.length : 1;

  const forbiddenHits = gold.forbiddenLines.filter(line => outputText.includes(line));
  const clean = forbiddenHits.length === 0;

  const solved = targetRecall === 1 && clean;

  results.push({
    id: task.id,
    lang: task.lang,
    kind: gold.expectedKind,
    solved,
    targetRecall,
    clean,
    rawTok,
    returnedTok,
    savedTok: Math.max(0, rawTok - returnedTok),
    savingPct: rawTok > 0 ? Number(((1 - returnedTok / rawTok) * 100).toFixed(1)) : 0,
  });
}

const elapsedSec = Number(((Date.now() - started) / 1000).toFixed(2));
const solvedCount = results.filter(r => r.solved).length;
const solvedPct = ((solvedCount / results.length) * 100).toFixed(1);
const avgRecall = ((results.reduce((s, r) => s + r.targetRecall, 0) / results.length) * 100).toFixed(1);
const cleanPct = ((results.filter(r => r.clean).length / results.length) * 100).toFixed(1);
const totalSaved = Math.max(0, totalRaw - totalReturned);
const netSavingPct = ((totalSaved / totalRaw) * 100).toFixed(1);

console.log('\n--- EVALUATION SUMMARY ---');
console.log(`Tasks:           ${results.length}`);
console.log(`Solved:          ${solvedCount}/${results.length} (${solvedPct}%)`);
console.log(`Target Recall:   ${avgRecall}%`);
console.log(`Cleanliness:     ${cleanPct}%`);
console.log(`Raw Tokens:      ~${totalRaw}`);
console.log(`Returned Tokens: ~${totalReturned}`);
console.log(`Net Saved:       ~${totalSaved} tok (${netSavingPct}%)`);
console.log(`Elapsed Time:    ${elapsedSec}s\n`);

console.log('| ID | Lang | Kind | Solved | Recall | Saved % |');
console.log('|---|---|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.id} | ${r.lang} | ${r.kind} | ${r.solved ? 'PASS' : 'FAIL'} | ${(r.targetRecall * 100).toFixed(0)}% | ${r.savingPct}% |`);
}

mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
writeFileSync(
  RESULTS_FILE,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      tasksCount: results.length,
      solvedCount,
      solvedPct: Number(solvedPct),
      avgRecall: Number(avgRecall),
      cleanPct: Number(cleanPct),
      totalRaw,
      totalReturned,
      totalSaved,
      netSavingPct: Number(netSavingPct),
      elapsedSec,
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(`\nResults saved to ${RESULTS_FILE}`);
