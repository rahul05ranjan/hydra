#!/usr/bin/env node
// Builds the git_dev development set: 10 repositories x 20 intents = 200 tasks.
// Separate seeds (6100..6109) and reviewed development-only phrasings.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorld, rng } from '../../train/world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SET = process.env.HYDRA_GIT_DEV_SET || 'original';
if (!['original', 'extended', 'paraphrase'].includes(SET)) throw new Error('Unknown Git development set');
export const dataDir = SET === 'original' ? HERE : path.join(HERE, SET);
const TASKS = path.join(dataDir, 'tasks.jsonl');
const HEADS = path.join(dataDir, 'worlds.json');
const WORLDS = SET === 'original' ? 10 : 40;
const SEED = { original: 6100, extended: 6200, paraphrase: 6400 }[SET];

export const worldsDir = () => path.join(process.env.HYDRA_HOME ?? path.join(os.homedir(), '.hydra'), 'worlds', SET === 'original' ? 'git_dev' : `git_dev_${SET}`);
export const worldName = i => `dev_${String(i).padStart(2, '0')}`;
export const loadTasks = () => readFileSync(TASKS, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

const read = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
const list = text => (text ? text.split('\n') : []);
const unfiltered = { path: null, author: null, grep: null, base: null };

function tasksFor(world, index, phrasings) {
  const { repo, trunk, branch, sync } = world;
  const r = rng(SEED + 500 + index);
  const hashes = (...args) => list(read(repo, 'log', '--format=%h', ...args));
  const filesOf = hash => list(read(repo, 'show', '--name-only', '--format=', hash));
  const subjectOf = hash => read(repo, 'log', '-1', '--format=%s', hash);
  const authorOf = (...args) => read(repo, 'log', '-1', '--format=%an', ...args);
  const first = name => name.split(' ')[0];

  const busy = world.files.filter(file => hashes('--', file).length >= 2);
  const lastFile = r.pick(busy.length ? busy : world.files);
  const historyFile = r.pick(busy.length ? busy : world.files);
  const picked = r.pick(hashes('--skip=1', '-n10'));
  const writer = r.pick([...new Set(list(read(repo, 'log', '--format=%an')))]);
  const word = r.pick(world.history).object.split(' ').at(-1);
  const line = r.pick(world.history);
  const ahead = hashes(`${trunk}..HEAD`);
  const count = r.int(3, 8);
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
      accept: [{ probe: 'log', args: { ...unfiltered, base: trunk, nMin: Math.min(50, ahead.length) } }],
      facts: ahead.slice(0, 50),
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
      facts: list(read(repo, 'stash', 'list')).length ? list(read(repo, 'stash', 'list')) : ['$ git stash list\n(no output)'],
    },
    worktrees: {
      accept: [{ probe: 'worktrees' }],
      facts: [`[${branch}]`, ...world.worktrees.map(w => `/${path.basename(w.dir)} `)],
    },
    line_author: {
      slots: { path: line.file, token: line.token },
      accept: [{ probe: 'blame', args: { path: line.file } }],
      facts: [line.token, first(line.author)],
      say: [first(line.author)],
    },
  };

  return Object.entries(phrasings).map(([intent, templates]) => {
    const { slots = {}, ...expected } = gold[intent];
    const template = templates[index % templates.length];
    const question = Object.entries(slots).reduce(
      (text, [slot, value]) => text.replaceAll(`{${slot}}`, String(value)),
      template,
    );
    return { id: `dev-${worldName(index)}-${intent}`, world: worldName(index), intent, question, ...expected };
  });
}

export function buildWorlds() {
  const parent = path.resolve(process.env.HYDRA_HOME ?? path.join(os.homedir(), '.hydra'), 'worlds');
  const relative = path.relative(parent, path.resolve(worldsDir()));
  if (!['git_dev', 'git_dev_extended', 'git_dev_paraphrase'].includes(relative)) throw new Error('Unsafe development-world cleanup path');
  rmSync(worldsDir(), { recursive: true, force: true });
  mkdirSync(worldsDir(), { recursive: true });
  return Array.from({ length: WORLDS }, (_, i) => buildWorld(path.join(worldsDir(), worldName(i)), SEED + i));
}

export function ensureWorlds() {
  const heads = JSON.parse(readFileSync(HEADS, 'utf8'));
  if (!existsSync(path.join(worldsDir(), worldName(WORLDS - 1), 'repo'))) buildWorlds();
  for (const [name, head] of Object.entries(heads)) {
    const actual = read(path.join(worldsDir(), name, 'repo'), 'rev-parse', 'HEAD');
    if (actual !== head) throw new Error(`world ${name} is at ${actual}, tasks.jsonl was built against ${head}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const phrasings = JSON.parse(readFileSync(path.join(dataDir, 'phrasings.json'), 'utf8'));
  const worlds = buildWorlds();
  const tasks = worlds.flatMap((w, i) => tasksFor(w, i, phrasings));
  writeFileSync(TASKS, tasks.map(task => JSON.stringify(task)).join('\n') + '\n');
  writeFileSync(HEADS, JSON.stringify(Object.fromEntries(worlds.map((w, i) => [worldName(i), read(w.repo, 'rev-parse', 'HEAD')])), null, 2) + '\n');
  console.log(`${tasks.length} dev tasks over ${worlds.length} worlds built in ${worldsDir()}`);
}
