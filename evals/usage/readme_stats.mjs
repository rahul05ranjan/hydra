#!/usr/bin/env node
// Refresh the "In real use" block of README.md from the local ledger (~/.hydra/ledger.jsonl).
// Only totals are written: no project names, commands or session ids, because the README is public.
// Counting starts at SINCE, when the test suite stopped writing fixture calls into the ledger, and covers
// only calls made inside an agent session.
// Token figures are the ledger's estimates (characters / 4).
//   node evals/usage/readme_stats.mjs [--check]   (--check prints the block without writing)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rows } from '../../skills/hydra/scripts/lib/ledger.mjs';

const SINCE = '2026-10-17T05:00:00.000Z';
const README = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../README.md');
const BEGIN = '<!-- usage-stats:begin (written by evals/usage/readme_stats.mjs) -->';
const END = '<!-- usage-stats:end -->';
const NAMES = { test: 'Test and build runs', git: 'Git questions', os: 'System inspection', read: 'File slices', files: 'Code search' };

/** Distinct Claude Code projects behind the recorded sessions, counted (never named) from its transcripts. */
function projectCount(sessions) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  if (!existsSync(root)) return 0;
  const projects = new Set();
  for (const project of readdirSync(root)) {
    try {
      for (const file of readdirSync(path.join(root, project))) if (sessions.has(file.replace(/\.jsonl$/, ''))) projects.add(project);
    } catch { /* Not a project folder. */ }
  }
  return projects.size;
}

const fmt = n => Math.round(n).toLocaleString('en-US');
const count = (n, word) => `**${fmt(n)} ${word}${n === 1 ? '' : 's'}**`;

export function block(all = rows(), today = new Date()) {
  // Only calls made inside an agent session: a shell or a test fixture has no session and is not real use.
  const calls = all.filter(row => (row.kind ?? 'call') === 'call' && (row.ts ?? '') >= SINCE && row.session);
  const heads = {};
  for (const row of calls) {
    const head = heads[row.head] ??= { calls: 0, raw: 0, returned: 0 };
    head.calls += 1; head.raw += row.raw; head.returned += row.returned;
  }
  const raw = calls.reduce((sum, row) => sum + row.raw, 0);
  const returned = calls.reduce((sum, row) => sum + row.returned, 0);
  const sessions = new Set(calls.map(row => row.session).filter(Boolean));
  const projects = projectCount(sessions);
  const share = value => (value.raw ? `${Math.round((1 - value.returned / value.raw) * 100)}%` : '0%');
  const lines = Object.entries(heads).sort(([, a], [, b]) => (b.raw - b.returned) - (a.raw - a.returned))
    .map(([head, h]) => `| ${NAMES[head] ?? head} | ${fmt(h.calls)} | ~${fmt(h.raw)} | ~${fmt(h.returned)} | **${share(h)}** |`);
  return [BEGIN,
    `**In real use.** Since ${SINCE.slice(0, 10)}, Hydra has handled ${count(calls.length, 'call')} in ${count(sessions.size, 'coding session')}` +
      `${projects ? ` across ${count(projects, 'project')}` : ''} on the maintainer's machine. Of **~${fmt(raw)} tokens** of command output, ` +
      `**~${fmt(returned)}** reached the agent: **${share({ raw, returned })} kept out of context**.`,
    '',
    '| Work | Calls | Output read locally | Reached the agent | Kept out |',
    '|---|---|---|---|---|',
    ...lines,
    '',
    `<sub>From Hydra's local ledger; tokens are estimates (characters / 4). Updated ${today.toISOString().slice(0, 10)}.</sub>`,
    END].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = block();
  if (process.argv.includes('--check')) { console.log(text); process.exit(0); }
  const readme = readFileSync(README, 'utf8');
  const start = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) throw new Error(`README.md has no ${BEGIN} ... ${END} block`);
  writeFileSync(README, readme.slice(0, start) + text + readme.slice(end + END.length));
  console.log(text);
}
