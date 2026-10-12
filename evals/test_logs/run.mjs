#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from '../../skills/hydra/scripts/lib/ledger.mjs';
import { chat, MODEL } from '../../skills/hydra/scripts/lib/ollama.mjs';
import { digest } from '../../skills/hydra/scripts/lib/test_logs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const TASKS_FILE = path.join(HERE, 'tasks.json');
const RESULTS_FILE = path.join(ROOT, 'evals', 'results', `test_logs.${MODEL.replace(/[^\w.-]+/g, '-')}.json`);

const tasks = JSON.parse(readFileSync(TASKS_FILE, 'utf8'));

console.log(`Evaluating test_logs head on ${tasks.length} tasks with model ${MODEL}...`);
const started = Date.now();

const results = [];
let totalRaw = 0;
let totalReturned = 0;

for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i];
  const { text, rawChars, exitCode } = await digest(
    { cmd: task.command, out: task.rawOutput, exitCode: task.exitCode },
    chat,
  );

  const rawTok = tokens(rawChars);
  const returnedTok = tokens(text.length);
  totalRaw += rawTok;
  totalReturned += returnedTok;

  const gold = task.gold;
  const testHits = gold.expectedTests.filter(t => text.toLowerCase().includes(t.toLowerCase()));
  const testRecall = gold.expectedTests.length ? testHits.length / gold.expectedTests.length : 1;

  const fileHits = gold.expectedFiles.filter(f => text.includes(f));
  const fileRecall = gold.expectedFiles.length ? fileHits.length / gold.expectedFiles.length : 1;

  const assertionHits = gold.expectedAssertions.filter(a => text.toLowerCase().includes(a.toLowerCase()));
  const assertionRecall = gold.expectedAssertions.length ? assertionHits.length / gold.expectedAssertions.length : 1;

  const isPassThrough = rawChars <= 800;
  const forbiddenHits = gold.forbiddenStrings.filter(s => text.includes(s));
  const clean = isPassThrough || forbiddenHits.length === 0;

  const solved = testRecall >= 1 && fileRecall >= 1 && assertionRecall >= 0.5 && clean && exitCode === task.exitCode;

  results.push({
    id: task.id,
    framework: task.framework,
    solved,
    testRecall,
    fileRecall,
    assertionRecall,
    clean,
    rawTok,
    returnedTok,
    saving: Number(((1 - returnedTok / Math.max(1, rawTok)) * 100).toFixed(1)),
    text,
  });

  const mark = solved ? '✔' : '✖';
  console.log(`[${i + 1}/${tasks.length}] ${mark} ${task.id} (${task.framework}) · ~${rawTok} -> ~${returnedTok} tok (${results.at(-1).saving}% saved)`);
}

const elapsedSec = Number(((Date.now() - started) / 1000).toFixed(1));
const solvedCount = results.filter(r => r.solved).length;
const solvedPct = Number(((solvedCount / tasks.length) * 100).toFixed(1));
const avgTestRecall = Number(((results.reduce((s, r) => s + r.testRecall, 0) / tasks.length) * 100).toFixed(1));
const avgFileRecall = Number(((results.reduce((s, r) => s + r.fileRecall, 0) / tasks.length) * 100).toFixed(1));
const avgAssertionRecall = Number(((results.reduce((s, r) => s + r.assertionRecall, 0) / tasks.length) * 100).toFixed(1));
const cleanPct = Number(((results.filter(r => r.clean).length / tasks.length) * 100).toFixed(1));
const totalSavingPct = Number(((1 - totalReturned / totalRaw) * 100).toFixed(1));

console.log(`\n================== SUMMARY ==================`);
console.log(`Model:             ${MODEL}`);
console.log(`Tasks:             ${tasks.length}`);
console.log(`Solved:            ${solvedCount}/${tasks.length} (${solvedPct}%)`);
console.log(`Test Recall:       ${avgTestRecall}%`);
console.log(`File/Line Recall:  ${avgFileRecall}%`);
console.log(`Assertion Recall:  ${avgAssertionRecall}%`);
console.log(`Cleanliness:       ${cleanPct}% (no framework stack pollution)`);
console.log(`Raw Tokens:        ~${totalRaw} tok`);
console.log(`Returned Tokens:   ~${totalReturned} tok`);
console.log(`Net Tokens Saved:  ~${totalRaw - totalReturned} tok (${totalSavingPct}% reduction)`);
console.log(`Elapsed Time:      ${elapsedSec}s`);

const output = {
  model: MODEL,
  date: new Date().toISOString().slice(0, 10),
  overall: {
    tasks: tasks.length,
    solved: solvedPct,
    testRecall: avgTestRecall,
    fileRecall: avgFileRecall,
    assertionRecall: avgAssertionRecall,
    cleanliness: cleanPct,
    rawTokens: totalRaw,
    returnedTokens: totalReturned,
    tokenSaving: totalSavingPct,
    elapsedSec,
  },
  rows: results,
};

writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote detailed results to ${RESULTS_FILE}`);
