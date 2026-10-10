#!/usr/bin/env node
// Builds the git1 worlds and writes tasks.jsonl: 50 repositories x 20 intents = 1000 tasks.
// Every expected fact is read back from git itself, so the gold cannot drift from the repositories.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTENTS } from './questions.mjs';
import { buildWorld, rng } from './world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TASKS = path.join(HERE, 'tasks.jsonl');
const HEADS = path.join(HERE, 'worlds.json');
const WORLDS = 50;
const SEED = 4100;

export const worldsDir = () => path.join(process.env.HYDRA_HOME ?? path.join(os.homedir(), '.hydra'), 'worlds', 'git1');
export const worldName = i => `w${String(i).padStart(2, '0')}`;
export const loadTasks = () => readFileSync(TASKS, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

const read = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
const list = text => (text ? text.split('\n') : []);
const unfiltered = { path: null, author: null, grep: null, base: null };

function tasksFor(world, index) {
  const { repo, trunk, branch, sync } = world;
  const r = rng(SEED + 500 + index);
  const hashes = (...args) => list(read(repo, 'log', '--format=%h', ...args));
  const filesOf = hash => list(read(repo, 'show', '--name-only', '--format=', hash));
  const subjectOf = hash => read(repo, 'log', '-1', '--format=%s', hash);
  const authorOf = (...args) => read(repo, 'log', '-1', '--format=%an', ...args);
  const first = name => name.split(' ')[0];

  const busy = world.files.filter(file => hashes('--', file).length >= 2);
  const lastFile = r.pick(busy);
  const historyFile = r.pick(busy);
  const picked = r.pick(hashes('--skip=2', '-n12'));
  const writer = r.pick([...new Set(list(read(repo, 'log', '--format=%an')))]);
  const word = r.pick(world.history).object.split(' ').at(-1);
  const line = r.pick(r.pick(world.history).lines);
  const lineHash = hashes('-S', `${line.token} =`, '--', line.file).at(-1);
  // The exact line blame prints, so the author and the token have to be shown together.
  const blamed = list(read(repo, 'blame', '--date=short', '--', line.file)).find(row => row.includes(`${line.token} =`));
  const ahead = hashes(`${trunk}..HEAD`);
  const count = r.int(2, 8);
  const edited = r.pick(world.unstaged);

  const gold = {
    branch_current: { accept: [{ probe: 'status' }, { probe: 'branches' }], facts: [branch], say: [branch] },
    sync:
      sync.state === 'ahead' || sync.state === 'behind'
        ? { accept: [{ probe: 'status' }, { probe: 'branches' }], facts: [`${sync.state} ${sync.by}`], say: [sync.state, String(sync.by)] }
        : { accept: [{ probe: 'status' }], facts: [read(repo, 'status', '--short', '--branch').split('\n')[0]] },
    modified_files: {
      accept: [{ probe: 'status' }, { probe: 'diff', args: { staged: false, base: null, path: null } }],
      facts: [...world.unstaged.map(u => u.file), ...world.staged],
    },
    untracked_files: { accept: [{ probe: 'status' }], facts: world.untracked.map(name => `?? ${name}`) },
    staged_files: { accept: [{ probe: 'diff', args: { staged: true, path: null } }, { probe: 'status' }], facts: world.staged },
    change_in_file: {
      slots: { path: edited.file },
      accept: [{ probe: 'diff', args: { staged: false, base: null, path: [edited.file, null] } }],
      facts: [edited.token],
    },
    branch_diff_files: {
      slots: { base: trunk },
      accept: [{ probe: 'diff', args: { base: trunk, path: null } }],
      facts: list(read(repo, 'diff', '--name-only', `${trunk}...HEAD`)),
    },
    last_commit: {
      accept: [{ probe: 'log', args: unfiltered }, { probe: 'show', args: { rev: [null, 'HEAD'] } }],
      facts: [hashes('-n1')[0], subjectOf('HEAD')],
    },
    recent_commits: {
      slots: { n: count },
      accept: [{ probe: 'log', args: { ...unfiltered, nMin: count } }],
      facts: hashes(`-n${count}`),
    },
    file_last_change: {
      slots: { path: lastFile },
      accept: [{ probe: 'log', args: { ...unfiltered, path: lastFile } }],
      facts: [authorOf('--', lastFile), subjectOf(hashes('-n1', '--', lastFile)[0])],
      say: [first(authorOf('--', lastFile))],
    },
    file_history: {
      slots: { path: historyFile },
      accept: [{ probe: 'log', args: { ...unfiltered, path: historyFile, nMin: 5 } }],
      facts: hashes('-n5', '--', historyFile),
    },
    author_commits: {
      slots: { author: r.next() < 0.5 ? writer : first(writer) },
      accept: [{ probe: 'log', args: { ...unfiltered, author: [writer, first(writer)], nMin: 3 } }],
      facts: hashes('-n3', `--author=${writer}`),
    },
    message_search: {
      slots: { word },
      accept: [{ probe: 'log', args: { ...unfiltered, grep: word, nMin: 3 } }],
      facts: hashes('-n3', '-i', `--grep=${word}`),
    },
    branch_commits: {
      slots: { base: trunk },
      accept: [{ probe: 'log', args: { ...unfiltered, base: trunk, nMin: ahead.length } }],
      facts: ahead,
    },
    last_commit_files: { accept: [{ probe: 'show', args: { rev: [null, 'HEAD'] } }], facts: filesOf('HEAD') },
    commit_files: {
      slots: { hash: picked },
      accept: [{ probe: 'show', args: { rev: picked } }],
      facts: [subjectOf(picked), ...filesOf(picked)],
    },
    branches: { accept: [{ probe: 'branches' }], facts: [trunk, branch, ...world.others].map(name => ` ${name} `) },
    stashes: {
      accept: [{ probe: 'stash' }],
      facts: world.stashes.length ? world.stashes : ['$ git stash list\n(no output)'],
    },
    worktrees: {
      accept: [{ probe: 'worktrees' }],
      facts: [`[${branch}]`, ...world.worktrees.map(w => `${w.dir} `)],
    },
    line_author: {
      slots: { path: line.file, token: line.token },
      accept: [{ probe: 'blame', args: { path: line.file } }],
      facts: [blamed],
      say: [first(authorOf(lineHash))],
    },
  };

  return Object.entries(INTENTS).map(([intent, { templates }]) => {
    const { slots = {}, ...expected } = gold[intent];
    const question = Object.entries(slots).reduce(
      (text, [slot, value]) => text.replaceAll(`{${slot}}`, value),
      templates[index % templates.length],
    );
    return { id: `git1-${worldName(index)}-${intent}`, world: worldName(index), intent, question, ...expected };
  });
}

// Rebuilds every world from its seed and returns their descriptions.
export function buildWorlds() {
  rmSync(worldsDir(), { recursive: true, force: true });
  return Array.from({ length: WORLDS }, (_, i) => buildWorld(path.join(worldsDir(), worldName(i)), SEED + i));
}

// The worlds live outside the project; rebuild them when missing and refuse to score against different ones.
export function ensureWorlds() {
  const heads = JSON.parse(readFileSync(HEADS, 'utf8'));
  if (!existsSync(path.join(worldsDir(), worldName(WORLDS - 1), 'repo'))) buildWorlds();
  for (const [name, head] of Object.entries(heads)) {
    const actual = read(path.join(worldsDir(), name, 'repo'), 'rev-parse', 'HEAD');
    if (actual !== head) throw new Error(`world ${name} is at ${actual}, tasks.jsonl was built against ${head}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const worlds = buildWorlds();
  const tasks = worlds.flatMap(tasksFor);
  writeFileSync(TASKS, tasks.map(task => JSON.stringify(task)).join('\n') + '\n');
  writeFileSync(HEADS, JSON.stringify(Object.fromEntries(worlds.map((w, i) => [worldName(i), read(w.repo, 'rev-parse', 'HEAD')])), null, 2) + '\n');
  console.log(`${tasks.length} tasks over ${worlds.length} worlds in ${worldsDir()}`);
}
