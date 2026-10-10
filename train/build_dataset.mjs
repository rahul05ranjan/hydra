import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorld, rng } from './world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, 'data');
const WORLDS_DIR = path.join(os.tmpdir(), 'hydra_train_worlds');

const PLAN_SYSTEM = `You choose git probes whose output will answer a question about a repository.
Choose 1 to 3 probes from this list:
- status: current branch, ahead/behind, changed and untracked files
- log: commit history, newest first, who changed a file or what changed in it; optional n, path, author, grep, base
- diff: all uncommitted changes as a patch; staged=true for only staged; base for branch diff; optional path
- show: one commit with its patch; optional rev (default HEAD)
- blame: line-by-line attribution of who wrote each specific line; needs path
- branches: local and remote branches with latest commit
- remotes: remote names and URLs
- stash: stashed changes
- tags: tags, newest first
- worktrees: worktrees of this repository and checked out branch
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

const read = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
const list = text => (text ? text.split('\n') : []);

export function buildExamplesFor(world, index, templatesMap, seed) {
  const { repo, trunk, branch } = world;
  const r = rng(seed + index);
  const hashes = (...args) => list(read(repo, 'log', '--format=%h', ...args));
  const busy = world.files.filter(file => hashes('--', file).length >= 2);
  const lastFile = r.pick(busy.length ? busy : world.files);
  const historyFile = r.pick(busy.length ? busy : world.files);
  const picked = r.pick(hashes('--skip=1', '-n10'));
  const writer = r.pick([...new Set(list(read(repo, 'log', '--format=%an')))]);
  const word = r.pick(world.history).object.split(' ').at(-1);
  const line = r.pick(world.history) ?? { file: lastFile, token: 'item_0' };
  const count = r.int(3, 8);
  const edited = r.pick(world.unstaged);

  const planDefs = {
    branch_current: { slots: {}, plan: { probes: [{ probe: 'status' }] } },
    sync: { slots: {}, plan: { probes: [{ probe: 'status' }] } },
    modified_files: { slots: {}, plan: { probes: [{ probe: 'status' }] } },
    untracked_files: { slots: {}, plan: { probes: [{ probe: 'status' }] } },
    staged_files: { slots: {}, plan: { probes: [{ probe: 'diff', staged: true }] } },
    change_in_file: { slots: { path: edited.file }, plan: { probes: [{ probe: 'diff', path: edited.file }] } },
    branch_diff_files: { slots: { base: trunk }, plan: { probes: [{ probe: 'diff', base: trunk }] } },
    last_commit: { slots: {}, plan: { probes: [{ probe: 'show' }] } },
    recent_commits: { slots: { n: count }, plan: { probes: [{ probe: 'log', n: count }] } },
    file_last_change: { slots: { path: lastFile }, plan: { probes: [{ probe: 'log', path: lastFile, n: 3 }] } },
    file_history: { slots: { path: historyFile }, plan: { probes: [{ probe: 'log', path: historyFile, n: 10 }] } },
    author_commits: { slots: { author: writer }, plan: { probes: [{ probe: 'log', author: writer, n: 10 }] } },
    message_search: { slots: { word }, plan: { probes: [{ probe: 'log', grep: word, n: 10 }] } },
    branch_commits: { slots: { base: trunk }, plan: { probes: [{ probe: 'log', base: trunk, n: 15 }] } },
    last_commit_files: { slots: {}, plan: { probes: [{ probe: 'show' }] } },
    commit_files: { slots: { hash: picked }, plan: { probes: [{ probe: 'show', rev: picked }] } },
    branches: { slots: {}, plan: { probes: [{ probe: 'branches' }] } },
    stashes: { slots: {}, plan: { probes: [{ probe: 'stash' }] } },
    worktrees: { slots: {}, plan: { probes: [{ probe: 'worktrees' }] } },
    line_author: { slots: { path: line.file, token: line.token }, plan: { probes: [{ probe: 'blame', path: line.file }] } },
  };

  // Weak intents get oversampled: 4 phrasing variants per world instead of 1
  const WEAK_INTENTS = new Set([
    'change_in_file', 'branch_diff_files', 'file_last_change',
    'branch_commits', 'line_author', 'author_commits', 'file_history',
  ]);

  const examples = [];
  for (const [intent, { slots, plan }] of Object.entries(planDefs)) {
    const tmpls = templatesMap[intent] ?? [];
    if (!tmpls.length) continue;
    const repeats = WEAK_INTENTS.has(intent) ? Math.min(4, tmpls.length) : 1;
    for (let r = 0; r < repeats; r++) {
      const template = tmpls[(index + r) % tmpls.length];
      const question = Object.entries(slots).reduce(
        (text, [slot, val]) => text.replaceAll(`{${slot}}`, String(val)),
        template,
      );
      examples.push({
        messages: [
          { role: 'system', content: PLAN_SYSTEM },
          { role: 'user', content: question },
          { role: 'assistant', content: JSON.stringify(plan) },
        ],
      });
    }
  }
  return examples;
}

export function buildAllData(phrasingsPath) {
  const phrasings = JSON.parse(readFileSync(phrasingsPath, 'utf8'));
  mkdirSync(DATA_DIR, { recursive: true });
  rmSync(WORLDS_DIR, { recursive: true, force: true });
  mkdirSync(WORLDS_DIR, { recursive: true });

  console.log('Building training worlds and examples...');
  const trainExamples = [];
  for (let i = 0; i < 40; i++) {
    const seed = 5100 + i;
    const worldDir = path.join(WORLDS_DIR, `train_${i}`);
    const world = buildWorld(worldDir, seed);
    trainExamples.push(...buildExamplesFor(world, i, phrasings, seed));
  }

  console.log('Building validation worlds and examples...');
  const validExamples = [];
  for (let i = 0; i < 10; i++) {
    const seed = 5200 + i;
    const worldDir = path.join(WORLDS_DIR, `valid_${i}`);
    const world = buildWorld(worldDir, seed);
    validExamples.push(...buildExamplesFor(world, i, phrasings, seed));
  }

  writeFileSync(path.join(DATA_DIR, 'train.jsonl'), trainExamples.map(e => JSON.stringify(e)).join('\n') + '\n');
  writeFileSync(path.join(DATA_DIR, 'valid.jsonl'), validExamples.map(e => JSON.stringify(e)).join('\n') + '\n');
  console.log(`Generated ${trainExamples.length} training and ${validExamples.length} validation examples in ${DATA_DIR}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const phrasingsFile = path.join(HERE, 'phrasings.json');
  if (!existsSync(phrasingsFile)) {
    console.error(`Phrasings file missing at ${phrasingsFile}. Run gen_phrasings.mjs first.`);
    process.exit(1);
  }
  buildAllData(phrasingsFile);
}
