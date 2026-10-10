#!/usr/bin/env node
import { cpSync, createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from './fixture.mjs';
import { prepareSources, copyWorkspace, unchanged, treeDigest } from './real_repo_tasks.mjs';
import { ARMS, BUDGET_PER_SESSION, MAX_SECONDS, MODEL, REPEATS, schedule, command, parseRun, summarize } from './real_repo_protocol.mjs';
import { runSession } from './session.mjs';
import { analyze } from './analyze_real_repo.mjs';

const argv = process.argv.slice(2);
const run = argv.includes('--run');
const preparedIndex = argv.indexOf('--prepared');
if (run && preparedIndex < 0) throw new Error('Run a reviewed, frozen preparation: --run --prepared <directory>');
const directory = preparedIndex >= 0 ? path.resolve(argv[preparedIndex + 1])
  : path.join(ROOT, 'evals/results/real-repo', new Date().toISOString().replace(/[:.]/g, '-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const planPath = path.join(directory, 'plan.json');
const manifestPath = path.join(directory, 'manifest.json');
const frozenRuntime = path.join(directory, 'hydra-skill');
const workspaceRoot = path.join(os.homedir(), '.hydra/trials/real-repo', path.basename(directory));
const localModels = async () => {
  const base = (process.env.HYDRA_OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Could not read local model metadata');
  return Object.fromEntries((await response.json()).models.filter(m => /^hydra-nano:(read|files)$/.test(m.name)).map(m => [m.name, m.digest]).sort(([a], [b]) => a.localeCompare(b)));
};

if (!run) {
  mkdirSync(directory, { recursive: true });
  const { tasks, provenance } = prepareSources(directory);
  cpSync(path.join(ROOT, 'skills/hydra'), frozenRuntime, { recursive: true });
  const plan = { tasks, schedule: schedule(tasks) };
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  const manifest = { preparedAt: new Date().toISOString(), model: MODEL, arms: ARMS, repeats: REPEATS,
    plannedSessions: plan.schedule.length, budgetPerSessionUsd: BUDGET_PER_SESSION,
    configuredBudgetUsd: plan.schedule.length * BUDGET_PER_SESSION, maximumSeconds: MAX_SECONDS,
    workspaceRoot, planSha256: hash(readFileSync(planPath)), frozenSkillSha256: treeDigest(frozenRuntime), localModels: await localModels(),
    tasks: tasks.map(({ expected, schema, ...task }) => ({ ...task, targetFunctionLines: expected.endLine - expected.startLine + 1 })),
    provenance, rules: [
      'Full JSON facts and function source are independently extracted with Python and TypeScript parsers before model calls.',
      'Source-only snapshots from real repos, no .env, data, sealed evals or installed dependencies. Gold stays outside agent workspaces.',
      'Three fresh sessions per task per arm. Cyclic arm order changes by task and repeat.',
      'Same project-only settings/tools/permissions in all arms. Plain has no Hydra skill; available/forced have identical frozen skills.',
      'The available arm receives no instruction naming Hydra. The forced arm is explicitly told to use the skill.',
      'Startup logs must prove the intended skill availability. Wrong model, permission denial or modified source invalidates the protocol.',
      'Report all outcomes and predeclared equal-correctness comparisons. A factual failure is retained, never repaired by changing tasks mid-run.',
      'Token figures are actual provider usage including cache creation/read. Cost equivalent is not a Pro-account bill.',
    ], commandExample: command(tasks[0], 'available', path.join(workspaceRoot, 'python_cast-r0-available')) };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ status: 'prepared', manifest, sessions: [] }, null, 2));
  console.log(JSON.stringify({ directory, status: 'prepared; no model calls', sessions: manifest.plannedSessions,
    budgetUsd: manifest.configuredBudgetUsd, maximumMinutes: MAX_SECONDS / 60,
    repos: Object.fromEntries(Object.entries(provenance).map(([n, p]) => [n, { sourceFiles: p.files.length, totalLines: p.totalLines }])),
    tasks: manifest.tasks.map(t => ({ id: t.id, file: t.file, sourceFileLines: t.sourceFileLines, targetFunctionLines: t.targetFunctionLines })) }, null, 2));
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (hash(readFileSync(planPath)) !== manifest.planSha256) throw new Error('The frozen plan changed; prepare a new run for review');
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  if (treeDigest(frozenRuntime) !== manifest.frozenSkillSha256) throw new Error('The frozen skill changed; prepare a new run');
  for (const [repo, provenance] of Object.entries(manifest.provenance)) if (!unchanged(path.join(directory, 'sources', repo), provenance)) throw new Error('Frozen source changed');
  if (JSON.stringify(await localModels()) !== JSON.stringify(manifest.localModels)) throw new Error('Local read/search model changed since preparation');
  const existing = JSON.parse(readFileSync(path.join(directory, 'report.json'), 'utf8'));
  if (existing.status !== 'prepared') throw new Error('This run was already started; prepare a new run rather than silently repeating paid calls');
  const report = { status: 'running', startedAt: new Date().toISOString(), manifest, sessions: [], violations: [] };
  const save = () => writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  save();
  const started = Date.now();
  let spent = 0;
  for (const cell of plan.schedule) {
    const left = MAX_SECONDS * 1000 - (Date.now() - started);
    if (left <= 0 || spent >= manifest.configuredBudgetUsd) { report.status = 'limit-reached'; break; }
    const task = plan.tasks.find(t => t.id === cell.task);
    const stem = `${cell.task}-r${cell.repeat}-${cell.arm}`;
    const work = path.join(workspaceRoot, stem);
    copyWorkspace(path.join(directory, 'sources', task.repo), work);
    if (cell.arm !== 'plain') {
      const skill = path.join(work, '.claude/skills/hydra');
      cpSync(frozenRuntime, skill, { recursive: true });
    }
    const traces = path.join(directory, 'traces'); mkdirSync(traces, { recursive: true });
    writeFileSync(path.join(traces, `${stem}.command.json`), JSON.stringify(command(task, cell.arm, work), null, 2));
    console.log(`START ${stem}`);
    const execution = await runSession(command(task, cell.arm, work), work, Math.min(left, 180000),
      { stdout: createWriteStream(path.join(traces, `${stem}.jsonl`)), stderr: createWriteStream(path.join(traces, `${stem}.stderr.txt`)) });
    const row = { ...cell, ...parseRun(task, execution, cell.arm), sourceUnchanged: unchanged(work, manifest.provenance[task.repo]),
      skillUnchanged: cell.arm === 'plain' || treeDigest(path.join(work, '.claude/skills/hydra')) === manifest.frozenSkillSha256 };
    report.sessions.push(row); spent += row.costUsd ?? 0;
    if (!row.availabilityValid) report.violations.push(`${stem}: wrong Hydra skill availability`);
    if (row.model !== MODEL) report.violations.push(`${stem}: unexpected frontier model`);
    if (row.permissionDenials) report.violations.push(`${stem}: permission denial`);
    if (!row.sourceUnchanged) report.violations.push(`${stem}: source changed`);
    if (!row.skillUnchanged) report.violations.push(`${stem}: skill changed`);
    if (!row.usageAvailable) report.violations.push(`${stem}: usage missing`);
    if (JSON.stringify(await localModels()) !== JSON.stringify(manifest.localModels)) report.violations.push(`${stem}: local read/search model changed`);
    report.summary = summarize(report.sessions, plan.tasks.map(t => t.id)); save();
    console.log(`DONE ${stem}: correct=${row.correct} available=${row.skillAvailable} hydra=${row.hydraSuccessfulCalls} input=${row.inputTokens} output=${row.outputTokens} ${row.seconds.toFixed(1)}s`);
    if (report.violations.length || !row.finished) { report.status = 'protocol-error'; break; }
  }
  if (report.status === 'running') report.status = 'complete';
  report.endedAt = new Date().toISOString(); report.durationSeconds = (Date.now() - started) / 1000;
  report.comparable = report.status === 'complete' && report.sessions.length === manifest.plannedSessions && report.violations.length === 0;
  save();
  analyze(directory);
  console.log(JSON.stringify({ directory, status: report.status, comparable: report.comparable, summary: report.summary, violations: report.violations }, null, 2));
}
