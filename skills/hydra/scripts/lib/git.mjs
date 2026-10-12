import { existsSync } from 'node:fs';
import path from 'node:path';
import { run } from './exec.mjs';
import { Unavailable } from './runtime.mjs';

const HARDEN = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'color.ui=false'];
const ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
const FORMAT = ['--pretty=tformat:%h %ad %an: %s', '--date=short'];
const PATCH = ['--no-ext-diff', '--no-textconv', '--stat', '-p'];
const MAX_PROBES = 4;

// A requested count belongs to the caller, not the model. Avoid treating line numbers or hashes as counts.
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
const COUNT = `(?:\\d+|(?:twenty|thirty|forty)[ -](?:one|two|three|four|five|six|seven|eight|nine)|${Object.keys(NUMBER_WORDS).join('|')})`;
const requestedCount = question => {
  const match = question.match(new RegExp(`\\b(?:last|latest|recent|top|first)\\s+(${COUNT})\\s+commits?\\b`, 'i'))
    ?? question.match(new RegExp(`\\b(${COUNT})\\s+(?:(?:last|latest|recent)\\s+)?commits?\\b`, 'i'));
  if (!match) return null;
  const text = match[1].toLowerCase();
  const value = /^\d+$/.test(text) ? Number(text) : text.split(/[ -]/).reduce((sum, word) => sum + NUMBER_WORDS[word], 0);
  return Math.min(Math.max(value, 1), 50);
};
const lastCommitRequest = question => /\b(?:last|latest|newest)\s+commit\b/i.test(question)
  && /\b(?:what|which)\b/i.test(question)
  && !/\b(?:since|after|before|between|compare|uncommitted|untracked|staged|working tree)\b/i.test(question);

export async function git(cwd, argv) {
  const r = await run('git', [...HARDEN, ...argv], cwd, ENV);
  return { ok: r.ok, out: r.out || r.err };
}

export const inRepo = async cwd => (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).out.trim() === 'true';

// The model picks from this menu and never writes a command. Every entry is read-only.
export const PROBES = {
  status: {
    about: 'current branch, ahead/behind, changed and untracked files',
    argv: () => ['status', '--short', '--branch'],
  },
  log: {
    about:
      'commit history, newest first, who changed a file or what changed in it; optional n, path, author, grep (text in the commit message), base (only commits this branch has that the base branch lacks)',
    argv: a => [
      'log',
      ...FORMAT,
      `-n${a.n}`,
      ...(a.author ? [`--author=${a.author}`] : []),
      ...(a.grep ? ['-i', `--grep=${a.grep}`] : []),
      ...(a.base ? [`${a.base}..HEAD`] : []),
      ...(a.path ? ['--', a.path] : []),
    ],
  },
  diff: {
    about:
      'all uncommitted changes as a patch; staged=true for only the staged ones; base for what this branch changed since it left the base branch; optional path',
    argv: a => [
      'diff',
      ...PATCH,
      a.base ? `${a.base}...HEAD` : a.staged ? '--staged' : 'HEAD',
      ...(a.path ? ['--', a.path] : []),
    ],
  },
  show: {
    about: 'one commit with its patch; optional rev (default HEAD)',
    argv: a => ['show', ...PATCH, ...FORMAT, a.rev ?? 'HEAD'],
  },
  blame: {
    about: 'line-by-line attribution of who wrote each specific line of a file (not for whole-file history); needs path',
    needs: 'path',
    argv: a => ['blame', '--date=short', '--', a.path],
  },
  branches: {
    about: 'local and remote branches with their latest commit',
    argv: () => ['branch', '--all', '-vv', '--sort=-committerdate'],
  },
  remotes: { about: 'remote names and URLs', argv: () => ['remote', '-v'] },
  stash: { about: 'stashed changes', argv: () => ['stash', 'list'] },
  tags: { about: 'tags, newest first', argv: () => ['tag', '--sort=-creatordate'] },
  worktrees: { about: 'worktrees of this repository and the branch each has checked out', argv: () => ['worktree', 'list'] },
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    probes: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_PROBES,
      items: {
        type: 'object',
        properties: {
          probe: { enum: Object.keys(PROBES) },
          n: { type: 'integer' },
          path: { type: 'string' },
          rev: { type: 'string' },
          base: { type: 'string' },
          author: { type: 'string' },
          grep: { type: 'string' },
          staged: { type: 'boolean' },
        },
        required: ['probe'],
      },
    },
  },
  required: ['probes'],
};

const PLAN_SYSTEM = `You choose git probes whose output will answer a question about a repository.
Choose 1 to 3 probes from this list:
${Object.entries(PROBES)
  .map(([name, p]) => `- ${name}: ${p.about}`)
  .join('\n')}
Set path, rev, base, author, grep or staged only when the question calls for one.

Examples:
"which branch am I on?" -> {"probes":[{"probe":"status"}]}
"what is staged?" -> {"probes":[{"probe":"diff","staged":true}]}
"what changed in src/app.js?" -> {"probes":[{"probe":"diff","path":"src/app.js"}]}
"who wrote line 40 of src/app.js?" -> {"probes":[{"probe":"blame","path":"src/app.js"}]}
"what has Asha committed lately?" -> {"probes":[{"probe":"log","author":"Asha"}]}
"which commits are on this branch but not on main?" -> {"probes":[{"probe":"log","base":"main"}]}
"which files differ between this branch and main?" -> {"probes":[{"probe":"diff","base":"main"}]}
"when was config.py last changed?" -> {"probes":[{"probe":"log","path":"config.py","n":3}]}`;

// The model's arguments are untrusted: keep a value only when the question itself names it and git can confirm it.
async function clean(p, question, cwd) {
  const asked = question.toLowerCase();
  const safe = s => typeof s === 'string' && s.trim() !== '' && !s.trim().startsWith('-') && asked.includes(s.trim().toLowerCase());
  const a = { n: Number.isInteger(p.n) ? Math.min(Math.max(p.n, 1), 50) : 15, staged: p.staged === true };
  if (p.probe === 'log') a.n = requestedCount(question) ?? a.n;
  for (const key of ['author', 'grep']) if (safe(p[key])) a[key] = p[key].trim();
  if (safe(p.path)) {
    const file = p.path.trim();
    const known =
      existsSync(path.resolve(cwd, file)) || (await git(cwd, ['log', '-1', '--format=%h', '--', file])).out.trim();
    if (known) a.path = file;
  }
  for (const key of ['rev', 'base']) {
    if (safe(p[key]) && (await git(cwd, ['rev-parse', '--verify', '--quiet', `${p[key].trim()}^{commit}`])).ok) {
      a[key] = p[key].trim();
    }
  }
  return a;
}

const shown = argv => `git ${argv.filter(arg => !FORMAT.includes(arg) && !PATCH.includes(arg)).join(' ')}`;

export async function gather(question, cwd, chat) {
  let plan = [];
  if (lastCommitRequest(question)) {
    plan = [{ probe: 'show' }];
  } else {
    try {
      plan = (await chat({ system: PLAN_SYSTEM, user: question, schema: PLAN_SCHEMA })).probes;
    } catch (e) {
      if (e instanceof Unavailable) throw e;
    }
  }

  const chosen = new Map();
  for (const p of Array.isArray(plan) ? plan.slice(0, MAX_PROBES) : []) {
    if (!PROBES[p?.probe]) continue;
    const args = await clean(p, question, cwd);
    if (PROBES[p.probe].needs && !args[PROBES[p.probe].needs]) continue;
    chosen.set(PROBES[p.probe].argv(args).join(' '), { probe: p.probe, args });
  }
  if (!chosen.size) for (const probe of ['status', 'log']) chosen.set(probe, { probe, args: { n: requestedCount(question) ?? 15 } });

  return Promise.all(
    [...chosen.values()].map(async ({ probe, args }) => {
      const argv = PROBES[probe].argv(args);
      return { probe, args, cmd: shown(argv), out: (await git(cwd, argv)).out || '(no output)' };
    }),
  );
}
