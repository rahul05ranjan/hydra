#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ARMS, parseRun, summarize } from './real_repo_protocol.mjs';

export function pairedComparison(rows, tasks, arm) {
  const blocks = [];
  for (const task of tasks) for (let repeat = 0; repeat < 3; repeat++) {
    const eligible = rows.filter(r => r.task === task && r.repeat === repeat && ['plain', arm].includes(r.arm));
    if (eligible.length !== 2 || !eligible.every(r => r.finished && r.correct && r.sourceUnchanged && r.availabilityValid && !r.permissionDenials && r.usageAvailable)) continue;
    const total = a => { const r = eligible.find(r => r.arm === a); return r.inputTokens + r.outputTokens; };
    blocks.push({ task, repeat, plain: total('plain'), other: total(arm) });
  }
  const reduction = list => {
    const baseline = list.reduce((s, r) => s + r.plain, 0);
    return baseline ? (1 - list.reduce((s, r) => s + r.other, 0) / baseline) * 100 : null;
  };
  // Resample whole task clusters, keeping their repeats together. Four distinct tasks warrant a wide, exploratory interval.
  const clusters = [...new Set(blocks.map(b => b.task))];
  const boot = []; let seed = 7191;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  if (clusters.length > 1) for (let i = 0; i < 5000; i++) {
    const sampled = clusters.flatMap(() => {
      const chosen = clusters[Math.floor(random() * clusters.length)];
      return blocks.filter(b => b.task === chosen);
    });
    const value = reduction(sampled); if (value !== null) boot.push(value);
  }
  boot.sort((a, b) => a - b);
  return { eligiblePairs: blocks.length, distinctTasks: clusters.length, totalTokenReductionPct: reduction(blocks),
    exploratory95PctClusterInterval: boot.length ? [boot[Math.floor(boot.length * .025)], boot[Math.floor(boot.length * .975)]] : null,
    byTask: tasks.map(task => ({ task, pairs: blocks.filter(b => b.task === task).length, reductionPct: reduction(blocks.filter(b => b.task === task)) })) };
}

export function analyze(directory) {
  const report = JSON.parse(readFileSync(path.join(directory, 'report.json'), 'utf8'));
  const planBytes = readFileSync(path.join(directory, 'plan.json'));
  assert.equal(createHash('sha256').update(planBytes).digest('hex'), report.manifest.planSha256);
  const plan = JSON.parse(planBytes);
  for (const row of report.sessions) {
    const stem = `${row.task}-r${row.repeat}-${row.arm}`;
    const trace = readFileSync(path.join(directory, 'traces', `${stem}.jsonl`), 'utf8');
    const parsed = parseRun(plan.tasks.find(t => t.id === row.task), { stdout: trace, exitCode: row.finished ? 0 : 1, error: row.error, seconds: row.seconds }, row.arm);
    for (const field of ['correct', 'answer', 'model', 'skillAvailable', 'availabilityValid', 'permissionDenials', 'inputTokens', 'outputTokens', 'hydraSuccessfulCalls', 'skillInvocations']) assert.deepEqual(row[field], parsed[field], `trace mismatch: ${stem}/${field}`);
  }
  report.summary = summarize(report.sessions, plan.tasks.map(t => t.id));
  report.comparisons = Object.fromEntries(['available', 'forced'].map(a => [a, pairedComparison(report.sessions, plan.tasks.map(t => t.id), a)]));
  report.analysisCaveats = [
    'Four real-source extraction tasks, not a broad end-to-end coding-workload benchmark; source snapshots contain no project config, data or installed dependencies.',
    'Byte-exact source plus file and line numbers is the predeclared correctness criterion. Incomplete source cannot earn a saving.',
    'Three repeated fresh sessions per task/arm; uncertainty is clustered by task, with only four distinct tasks. Intervals are exploratory.',
    'The available arm measures skill availability and actual use; forced is explicit instruction. Skills not loaded invalidate the protocol.',
    'All outcomes are retained. Pairwise equal-correctness subsets and full-triplet matched results were declared before calls.',
    'Cached and uncached input are both counted. Cost equivalents depend on cache reuse and do not measure the Pro allowance.',
  ];
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(path.join(directory, 'analysis.json'), JSON.stringify({ summary: report.summary, comparisons: report.comparisons, caveats: report.analysisCaveats }, null, 2));
  const lines = ['# Repeated real-repository trial', '', `Status: ${report.status}. Protocol comparable: ${report.comparable}.`, '',
    `Completed sessions: ${report.sessions.length}/${report.manifest.plannedSessions}. Elapsed: ${(report.durationSeconds ?? 0).toFixed(1)} seconds.`, '',
    '| Arm | Correct | Adopted Hydra | Reported input | Reported output | Total tokens | Cost equivalent |', '|---|---:|---:|---:|---:|---:|---:|'];
  for (const a of ARMS) { const s = report.summary.byArm[a]; lines.push(`| ${a} | ${s.correct}/${s.sessions} | ${s.adopted}/${s.sessions} | ${s.inputTokens} | ${s.outputTokens} | ${s.inputTokens + s.outputTokens} | $${s.costUsd.toFixed(4)} |`); }
  if (report.violations?.length) lines.push('', '## Protocol violations', '', ...report.violations.map(v => `- ${v}`));
  lines.push('', '## Equal-correctness pairs', '');
  for (const a of ['available', 'forced']) {
    const c = report.comparisons[a]; lines.push(`- ${a}: ${c.eligiblePairs} eligible pairs; token reduction ${c.totalTokenReductionPct?.toFixed(2) ?? 'not measurable'}%; exploratory task-cluster 95% interval ${c.exploratory95PctClusterInterval?.map(n => n.toFixed(2)).join(' to ') ?? 'not measurable'}.`);
  }
  lines.push('', '## Limits', '', ...report.analysisCaveats.map(c => `- ${c}`), '', 'Gold, source hashes and order are in [plan.json](plan.json) and [manifest.json](manifest.json). Session events are in `traces/`. Full results: [report.json](report.json).');
  writeFileSync(path.join(directory, 'SUMMARY.md'), lines.join('\n') + '\n');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  if (!process.argv[2]) throw new Error('Provide a prepared/run directory');
  const r = analyze(path.resolve(process.argv[2])); console.log(JSON.stringify({ summary: r.summary, comparisons: r.comparisons }, null, 2));
}
