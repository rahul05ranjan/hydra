import { existsSync, statSync } from 'node:fs';
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
const COUNT_MODIFIERS = '(?:(?:last|latest|recent|newest|oldest|branch-only|file-specific|unique|matching|first|history|historical|past)\\s+){0,3}';
const COUNT_ITEMS = '(?:commits?|revisions?|changesets?|records?)';
const requestedCount = question => {
  const match = question.match(new RegExp(`\\b(?:last|latest|recent|top|first)\\s+(${COUNT})\\s+${COUNT_MODIFIERS}${COUNT_ITEMS}\\b`, 'i'))
    ?? question.match(new RegExp(`\\b(${COUNT})\\s+${COUNT_MODIFIERS}${COUNT_ITEMS}\\b`, 'i'));
  if (!match) return null;
  const text = match[1].toLowerCase();
  const value = /^\d+$/.test(text) ? Number(text) : text.split(/[ -]/).reduce((sum, word) => sum + NUMBER_WORDS[word], 0);
  return Math.min(Math.max(value, 1), 50);
};
const lastCommitRequest = question => /\b(?:last|latest|newest|most recent)\s+commit\b/i.test(question)
  && /\b(?:what|which)\b/i.test(question)
  && !/\b(?:since|after|before|between|compare|against|uncommitted|untracked|staged|working tree)\b/i.test(question);
// The name of the checked-out branch, not a list of branches or a comparison.
const currentBranchRequest = question => /\b(?:current|active|checked[- ]out)\s+branch\b|\b(?:which|what)\s+branch\b[^?]*\b(?:HEAD|am I|are we|currently|right now|checked out)\b/i.test(question)
  && !/\bbranches\b|\bcontain|\bbetween|\bcompar|\bmerg|\bdiffer/i.test(question);
// Edits not yet committed, measured against HEAD itself (HEAD~2 or HEAD^ is history).
const pendingEditRequest = question => /\b(?:since|relative to|against|versus|vs\.?)\s+HEAD\b(?![~^@])|\buncommitted\b|\bnot (?:yet )?committed\b|\bworking (?:tree|copy)\b|\bagainst (?:the )?(?:last|latest|previous) commit\b|\b(?:isn't|is not|aren't|are not|haven't been|hasn't been) (?:yet )?committed\b/i.test(question);
// Files Git has never tracked; "would git add . pick up" asks about these, not about the index.
const untrackedRequest = question => /\buntracked\b|\bnot tracked\b|\bisn't tracking\b|\bnot under version control\b|\bbrand[- ]new\b|\bnever (?:been )?added\b|\bnot (?:been |yet )?added to git\b/i.test(question);
// The branch's position against its remote tracking branch.
const syncRequest = question => /\b(?:remote|upstream|origin|tracking)\b/i.test(question)
  && /\b(?:ahead|behind|up[- ]to[- ]date|in sync|diverg\w*|separate\w*|pull|push)\b/i.test(question);
// Commits that touched a file over time, as opposed to its pending edits.
const historyRequest = question => /\b(?:commits?|history|evolved|over time|git log)\b/i.test(question) && !pendingEditRequest(question);
// "with timeout in their subjects", "messages mentioning cache"
const subjectTerm = question => (question.match(/\bwith\s+["'`]?([\w.-]+)["'`]?\s+in\s+(?:their|the|its)\s+(?:subjects?|messages?|titles?)\b/i)
  ?? question.match(/\b(?:subjects?|messages?)\s+(?:containing|mentioning|that mention|with)\s+["'`]?([\w.-]+)/i))?.[1];
// The first word of the question that is a file inside the repository, e.g. src/app.ts or Makefile.
function fileInQuestion(question, cwd) {
  for (const word of question.split(/\s+/)) {
    const name = word.replace(/^["'`(]+|["'`),;:!?]+$|\.$/g, '');
    if (!name || name.startsWith('-') || path.isAbsolute(name)) continue;
    const file = path.resolve(cwd, name), relative = path.relative(cwd, file);
    if (!relative || relative.startsWith('..')) continue;
    try { if (statSync(file).isFile()) return name; } catch {}
  }
}
// Staging scope from the question, ignoring any named file such as staged.js or index.txt.
function scope(question, file) {
  let text = file ? question.split(file.toLowerCase()).join(' ') : question.replace(/[\w./-]+\.[a-z0-9]+\b/gi, ' ');
  text = text.replace(/\b(?:un[- ]?staged|not staged)\b/gi, 'unstaged');
  const unstaged = /\bunstaged\b/i.test(text);
  text = text.replace(/\bunstaged\b/gi, '');
  const index = !untrackedRequest(text) && /\b(?:staged|staging|cached)\b|\bgit\s+add(?:ed)?\b|\b(?:in|from|the|to|of)\s+(?:git\s+)?index(?=\s|[?!,;:]|\.(?:\s|$)|$)|\b(?:prepared|ready|queued|waiting)\s+for\s+(?:(?:the|next|a)\s+)*commit\b|\binto (?:my |the )?next commit\b/i.test(text);
  return { index, unstaged };
}

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
      'committed revision history, newest first, who last committed a file; optional n, path, author, grep (text in the commit message), base (only commits this branch has that the base branch lacks)',
    argv: a => [
      'log',
      ...FORMAT,
      `-n${a.n}`,
      ...(a.author || a.grep ? ['-i', '--fixed-strings'] : []),
      ...(a.author ? [`--author=${a.author}`] : []),
      ...(a.grep ? [`--grep=${a.grep}`] : []),
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
      ...(a.base ? [`${a.base}...HEAD`] : a.staged ? ['--staged'] : a.worktreeOnly ? [] : ['HEAD']),
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
Use author for who wrote commits; grep only searches commit messages. A file history query uses path, not grep. A file's last edit uses log; the author of a specific source line uses blame. Copy a named commit's rev exactly from the question.
For the active branch name use status; for a list of branch references use branches. HEAD in a branch-name question does not ask for a commit patch.
For multiple revisions or historical records use log with n, including file-specific history. show reads one committed revision and its changed files.
Pending source edits relative to HEAD use diff. Cached/index/prepared differences use diff with staged=true; these edits have not been committed.
Linked checkout directories use worktrees, even when the question also mentions their branches.

Examples:
"which branch am I on?" -> {"probes":[{"probe":"status"}]}
"what is staged?" -> {"probes":[{"probe":"diff","staged":true}]}
"what changed in src/app.js?" -> {"probes":[{"probe":"diff","path":"src/app.js"}]}
"who wrote line 40 of src/app.js?" -> {"probes":[{"probe":"blame","path":"src/app.js"}]}
"what has Asha committed lately?" -> {"probes":[{"probe":"log","author":"Asha"}]}
"which commits are on this branch but not on main?" -> {"probes":[{"probe":"log","base":"main"}]}
"which files differ between this branch and main?" -> {"probes":[{"probe":"diff","base":"main"}]}
"when was config.py last changed?" -> {"probes":[{"probe":"log","path":"config.py","n":3}]}
"who most recently edited src/cart.js?" -> {"probes":[{"probe":"log","path":"src/cart.js","n":1}]}
"show the history of src/cart.js" -> {"probes":[{"probe":"log","path":"src/cart.js","n":50}]}
"list commits written by Rina" -> {"probes":[{"probe":"log","author":"Rina","n":50}]}
"files touched by commit b71ac90" -> {"probes":[{"probe":"show","rev":"b71ac90"}]}
"commits present here but absent from main" -> {"probes":[{"probe":"log","base":"main","n":50}]}`;

// The model's arguments are untrusted: keep a value only when the question itself names it and git can confirm it.
async function clean(p, question, cwd) {
  const asked = question.toLowerCase();
  const safe = s => typeof s === 'string' && s.trim() !== '' && !s.trim().startsWith('-') && asked.includes(s.trim().toLowerCase());
  const a = { n: Number.isInteger(p.n) ? Math.min(Math.max(p.n, 1), 50) : 15, staged: false };
  if (p.probe === 'log') a.n = requestedCount(question) ?? a.n;
  if (safe(p.author)) {
    const candidate = p.author.trim();
    const known = await git(cwd, ['log', '-1', '--format=%an', '-i', '--fixed-strings', `--author=${candidate}`]);
    const at = asked.indexOf(candidate.toLowerCase());
    const before = asked.slice(0, at).trimEnd();
    const after = asked.slice(at + candidate.length);
    const explicitlyNamed = /\b(?:by|from|author(?: is)?)\s*["'`]?$/i.test(before)
      || /^["'`]?\s+(?:wrote|authored|committed|contributed)\b/i.test(after)
      || /^['’]s\s+commits?\b/i.test(after);
    if ((known.ok && known.out.trim()) || explicitlyNamed) a.author = candidate;
  }
  // "commits from Hydra Seed": the model may file the name under another argument.
  const named = !a.author && p.probe === 'log' ? question.match(/\b(?:by|from)\s+([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*)?)/)?.[1] : null;
  if (named && (await git(cwd, ['log', '-1', '--format=%an', '-i', '--fixed-strings', `--author=${named}`])).out.trim()) a.author = named;
  if (safe(p.path)) {
    const file = p.path.trim();
    const known =
      existsSync(path.resolve(cwd, file)) || (await git(cwd, ['log', '-1', '--format=%h', '--', file])).out.trim();
    if (known) a.path = file;
  }
  // A validated file named staged.js or index.txt is not a staging request.
  const { index: asksIndex, unstaged: asksUnstaged } = scope(asked, a.path);
  const asksBoth = asksUnstaged && asksIndex;
  a.staged = asksIndex && !asksUnstaged;
  if (p.probe === 'diff' && asksUnstaged && !asksBoth) a.worktreeOnly = true;
  // A named file or author is not automatically a commit-message filter.
  // Preserve compound filtering only when the question also asks about messages.
  const asksMessage = /\b(?:messages?|subjects?|mention\w*)\b/i.test(question);
  if (safe(p.grep) && (asksMessage || (!a.path && !a.author))) a.grep = p.grep.trim();
  if (p.probe === 'log' && !a.grep && subjectTerm(question)) a.grep = subjectTerm(question);
  for (const key of ['rev', 'base']) {
    // HEAD as a base compares HEAD with itself and always shows nothing.
    if (key === 'base' && /^HEAD$/i.test(String(p.base ?? '').trim())) continue;
    if (safe(p[key]) &&(await git(cwd, ['rev-parse', '--verify', '--quiet', `${p[key].trim()}^{commit}`])).ok) {
      a[key] = p[key].trim();
    }
  }
  // The model asked for a base it could not name ("here"); use the one other local branch the question names.
  if (p.base && !a.base && ['log', 'diff'].includes(p.probe)) {
    const current = (await git(cwd, ['branch', '--show-current'])).out.trim();
    const words = new Set(question.split(/[\s"'`?,.!;:()]+/).filter(Boolean));
    const local = (await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).out.split('\n').map(name => name.trim());
    const named = local.filter(name => name && name !== current && words.has(name));
    if (named.length === 1) a.base = named[0];
  }
  // Commits this branch has over its base form a bounded set; return it whole unless a count was asked for.
  if (p.probe === 'log' && a.base && requestedCount(question) === null) a.n = 50;
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

  plan = Array.isArray(plan) ? plan.filter(p => PROBES[p?.probe]).slice(0, MAX_PROBES) : [];
  // The question can name a scope the model's plan misses; add the probe that covers it.
  const has = (...probes) => plan.some(p => probes.includes(p.probe));
  const named = plan.find(p => p.path)?.path ?? fileInQuestion(question, cwd);
  if (scope(question.toLowerCase(), null).index && !has('diff', 'status')) plan.push({ probe: 'diff', staged: true });
  if (currentBranchRequest(question) && !has('status', 'branches')) plan.push({ probe: 'status' });
  if (syncRequest(question) && !has('status', 'branches')) plan.push({ probe: 'status' });
  if (untrackedRequest(question) && !has('status')) plan.push({ probe: 'status' });
  if (historyRequest(question) && named && !has('log', 'blame')) {
    plan = plan.filter(p => !((p.probe === 'show' && !p.rev) || (p.probe === 'diff' && !p.base)));
    plan.push({ probe: 'log', path: named });
  }
  if (pendingEditRequest(question) && named && !has('diff')) {
    // Edits since HEAD exclude HEAD's own commit patch, which would only crowd out the diff.
    plan = plan.filter(p => !(p.probe === 'show' && (!p.rev || /^HEAD$/i.test(p.rev))));
    plan.push({ probe: 'diff', path: named });
  }

  const chosen = new Map();
  for (const p of plan) {
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
