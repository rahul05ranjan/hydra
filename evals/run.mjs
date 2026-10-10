#!/usr/bin/env node
// Scores the git head on the git1 tasks:  node evals/run.mjs [--limit N] [--intent NAME]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer } from '../skills/hydra/scripts/lib/answer.mjs';
import * as git from '../skills/hydra/scripts/lib/git.mjs';
import { tokens } from '../skills/hydra/scripts/lib/ledger.mjs';
import { chat, MODEL } from '../skills/hydra/scripts/lib/ollama.mjs';
import { route } from '../skills/hydra/scripts/lib/route.mjs';
import { ensureWorlds, loadTasks, worldsDir } from './git1/build.mjs';
import { INTENTS } from './git1/questions.mjs';
import { startLive, recordLive, finishLive } from './live_reporter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PARALLEL = 4;
const READING = 'Local model says: ';

const option = name => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

const same = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);

// A chosen probe fits when it is the wanted one and every argument the gold constrains has an allowed value.
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
  try {
    const sections = await git.gather(task.question, cwd, chat);
    const { text, rawChars } = await answer(task.question, sections, chat);
    // Facts are looked for only in the verbatim part, never in the model's own sentence.
    const [first, ...rest] = text.split('\n\n');
    const reading = first.startsWith(READING) ? first.toLowerCase() : null;
    const evidence = reading ? rest.join('\n\n') : text;
    const found = task.facts.filter(fact => evidence.includes(fact)).length;
    return {
      ...row,
      plan: sections.some(section => task.accept.some(want => fits(section, want))),
      recall: found / task.facts.length,
      evidence: found === task.facts.length,
      reading: reading && task.say ? task.say.every(word => reading.includes(word.toLowerCase())) : null,
      raw: tokens(rawChars),
      returned: tokens(text.length),
      seconds: (Date.now() - started) / 1000,
      probes: sections.map(section => section.cmd),
    };
  } catch (e) {
    return { ...row, plan: false, recall: 0, evidence: false, reading: null, raw: 0, returned: 0, seconds: (Date.now() - started) / 1000, error: e.message };
  }
}

function summarise(rows) {
  const share = pick => rows.filter(pick).length / rows.length;
  const read = rows.filter(row => row.reading !== null);
  return {
    tasks: rows.length,
    routed: share(row => row.routed),
    plan: share(row => row.plan),
    evidence: share(row => row.evidence),
    solved: share(row => row.plan && row.evidence),
    recall: rows.reduce((sum, row) => sum + row.recall, 0) / rows.length,
    readingRight: read.filter(row => row.reading).length,
    readingScored: read.length,
    raw: rows.reduce((sum, row) => sum + row.raw, 0),
    returned: rows.reduce((sum, row) => sum + row.returned, 0),
    errors: rows.filter(row => row.error).length,
  };
}

ensureWorlds();
let tasks = loadTasks();
if (option('intent')) tasks = tasks.filter(task => task.intent === option('intent'));
if (option('limit')) tasks = tasks.slice(0, Number(option('limit')));

startLive('git1', MODEL, tasks.length);
const rows = [];
const queue = [...tasks];
const started = Date.now();
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      const res = await score(task);
      rows.push(res);
      recordLive(res);
      if (rows.length % 100 === 0) console.error(`${rows.length}/${tasks.length}`);
    }
  }),
);
rows.sort((a, b) => (a.id < b.id ? -1 : 1));

const byIntent = Object.fromEntries(
  Object.keys(INTENTS)
    .map(intent => [intent, rows.filter(row => row.intent === intent)])
    .filter(([, own]) => own.length)
    .map(([intent, own]) => [intent, summarise(own)]),
);
const overall = summarise(rows);
finishLive(overall);

// Each family's real-usage weight is shared equally by the intents that stand in for it.
const { weights } = JSON.parse(readFileSync(path.join(HERE, 'git1', 'usage.json'), 'utf8'));
const inFamily = family => Object.keys(byIntent).filter(intent => INTENTS[intent].family === family).length;
const weightOf = intent => weights[INTENTS[intent].family] / inFamily(INTENTS[intent].family);
const totalWeight = Object.keys(byIntent).reduce((sum, intent) => sum + weightOf(intent), 0);
overall.solvedWeighted = Object.entries(byIntent).reduce((sum, [intent, s]) => sum + s.solved * weightOf(intent), 0) / totalWeight;

const pct = x => `${(100 * x).toFixed(0)}%`.padStart(5);
console.log(`model ${MODEL}, ${rows.length} tasks, ${((Date.now() - started) / 60000).toFixed(1)} min\n`);
console.log(`${'intent'.padEnd(19)} tasks routed  plan evid. solved  reading  read-tok  returned`);
for (const [name, s] of [...Object.entries(byIntent), ['ALL', overall]]) {
  const reading = s.readingScored ? `${s.readingRight}/${s.readingScored}` : '-';
  console.log(
    `${name.padEnd(19)} ${String(s.tasks).padStart(5)} ${pct(s.routed)} ${pct(s.plan)} ${pct(s.evidence)} ${pct(s.solved)}  ${reading.padStart(7)}  ${String(s.raw).padStart(8)}  ${String(s.returned).padStart(8)}`,
  );
}
console.log(`\nsolved, weighted by real usage: ${pct(overall.solvedWeighted).trim()}   errors: ${overall.errors}`);

mkdirSync(path.join(HERE, 'results'), { recursive: true });
const file = path.join(HERE, 'results', `git1.${MODEL.replace(/[^\w.-]+/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ model: MODEL, date: new Date().toISOString(), overall, byIntent, rows }, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), file)}`);
