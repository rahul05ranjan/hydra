#!/usr/bin/env node
// Scores a model on the 200 development tasks in evals/git_dev
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer } from '../skills/hydra/scripts/lib/answer.mjs';
import * as git from '../skills/hydra/scripts/lib/git.mjs';
import { tokens } from '../skills/hydra/scripts/lib/ledger.mjs';
import { chat, MODEL } from '../skills/hydra/scripts/lib/ollama.mjs';
import { route } from '../skills/hydra/scripts/lib/route.mjs';
import { ensureWorlds, loadTasks, worldsDir } from './git_dev/build.mjs';
import { startLive, recordLive, finishLive } from './live_reporter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PARALLEL = 4;
const READING = 'Local model says: ';

const option = name => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

const same = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);

function fits(section, want) {
  if (section.probe !== want.probe) return false;
  return Object.entries(want.args ?? {}).every(([key, allowed]) => {
    if (key === 'nMin') return section.args.n >= allowed;
    return [allowed].flat().some(value => same(section.args[key] ?? null, value));
  });
}

async function score(task) {
  const cwd = path.join(worldsDir(), task.world, 'repo');
  const row = { id: task.id, intent: task.intent, routed: route(task.question, true) === 'git' };
  const started = Date.now();
  const calls = [];
  const tracedChat = async options => {
    const begin = Date.now();
    const call = { stage: options.schema?.required?.includes('probes') ? 'plan' : 'evidence' };
    calls.push(call);
    try { call.reply = await chat(options); return call.reply; }
    catch (error) { call.error = error.message; throw error; }
    finally { call.seconds = (Date.now() - begin) / 1000; }
  };
  try {
    const sections = await git.gather(task.question, cwd, tracedChat);
    const { text, rawChars } = await answer(task.question, sections, tracedChat);
    const rawProbes = calls.find(call => call.stage === 'plan')?.reply?.probes;
    const [first, ...rest] = text.split('\n\n');
    const reading = first.startsWith(READING) ? first.toLowerCase() : null;
    const evidence = reading ? rest.join('\n\n') : text;
    const comparable = task.intent === 'worktrees' ? evidence.replaceAll('\\', '/') : evidence;
    const found = task.facts.filter(fact => comparable.includes(fact)).length;
    return {
      ...row,
      calls,
      modelProbeChoice: Array.isArray(rawProbes) ? rawProbes.some(probe => task.accept.some(want => probe?.probe === want.probe))
        : calls.some(call => call.stage === 'plan') ? false : null,
      plan: sections.some(section => task.accept.some(want => fits(section, want))),
      recall: task.facts.length ? found / task.facts.length : 1,
      evidence: found === task.facts.length,
      reading: reading && task.say ? task.say.every(word => reading.includes(word.toLowerCase())) : null,
      raw: tokens(rawChars),
      returned: tokens(text.length),
      seconds: (Date.now() - started) / 1000,
      probes: sections.map(section => section.cmd),
    };
  } catch (e) {
    const rawProbes = calls.find(call => call.stage === 'plan')?.reply?.probes;
    const modelProbeChoice = Array.isArray(rawProbes) ? rawProbes.some(probe => task.accept.some(want => probe?.probe === want.probe))
      : calls.some(call => call.stage === 'plan') ? false : null;
    return { ...row, calls, modelProbeChoice, plan: false, recall: 0, evidence: false, reading: null, raw: 0, returned: 0, seconds: (Date.now() - started) / 1000, error: e.message };
  }
}

function summarise(rows) {
  const share = pick => rows.filter(pick).length / rows.length;
  const read = rows.filter(row => row.reading !== null);
  const planned = rows.filter(row => row.modelProbeChoice !== null);
  return {
    tasks: rows.length,
    modelCalls: rows.reduce((sum, row) => sum + row.calls.length, 0),
    tasksWithModelCalls: rows.filter(row => row.calls.length).length,
    modelPlannerTasks: planned.length,
    modelProbeChoiceAccuracy: planned.length ? planned.filter(row => row.modelProbeChoice).length / planned.length : null,
    routed: share(row => row.routed),
    plan: share(row => row.plan),
    evidence: share(row => row.evidence),
    solved: share(row => row.plan && row.evidence),
    recall: rows.reduce((sum, r) => sum + r.recall, 0) / rows.length,
    readingRight: read.filter(row => row.reading).length,
    readingScored: read.length,
    raw: rows.reduce((sum, r) => sum + r.raw, 0),
    returned: rows.reduce((sum, r) => sum + r.returned, 0),
    errors: rows.filter(row => row.error).length,
  };
}

ensureWorlds();
const allTasks = loadTasks();
const limit = option('limit') ? Number(option('limit')) : undefined;
const intentFilter = option('intent');
const tasks = allTasks
  .filter(task => !intentFilter || task.intent === intentFilter)
  .slice(0, limit);

console.log(`Scoring ${tasks.length} dev tasks with model ${MODEL}...`);
startLive('git_dev', MODEL, tasks.length);
const started = Date.now();
const rows = [];
const queue = [...tasks];

await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      const res = await score(task);
      rows.push(res);
      recordLive(res);
      if (rows.length % 50 === 0) console.error(`${rows.length}/${tasks.length}`);
    }
  }),
);
rows.sort((a, b) => (a.id < b.id ? -1 : 1));

const intents = [...new Set(tasks.map(t => t.intent))];
const byIntent = Object.fromEntries(
  intents.map(intent => [intent, summarise(rows.filter(row => row.intent === intent))]),
);
const overall = summarise(rows);
finishLive(overall);

const pct = x => `${(100 * x).toFixed(0)}%`.padStart(5);
console.log(`\nmodel ${MODEL}, ${rows.length} tasks, ${((Date.now() - started) / 60000).toFixed(1)} min\n`);
console.log(`${'intent'.padEnd(19)} tasks routed  plan evid. solved  reading  read-tok  returned`);
for (const [name, s] of [...Object.entries(byIntent), ['ALL', overall]]) {
  const reading = s.readingScored ? `${s.readingRight}/${s.readingScored}` : '-';
  console.log(
    `${name.padEnd(19)} ${String(s.tasks).padStart(5)} ${pct(s.routed)} ${pct(s.plan)} ${pct(s.evidence)} ${pct(s.solved)}  ${reading.padStart(7)}  ${String(s.raw).padStart(8)}  ${String(s.returned).padStart(8)}`,
  );
}

mkdirSync(path.join(HERE, 'results'), { recursive: true });
const setSuffix = process.env.HYDRA_GIT_DEV_SET && process.env.HYDRA_GIT_DEV_SET !== 'original' ? `_${process.env.HYDRA_GIT_DEV_SET}` : '';
const file = path.join(HERE, 'results', `git_dev${setSuffix}.${MODEL.replace(/[^\w.-]+/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ model: MODEL, date: new Date().toISOString(), overall, byIntent, rows }, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), file)}`);
