// New synthetic training cases; no benchmark question, world or failure inputs.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as git from '../skills/hydra/scripts/lib/git.mjs';
import { answer } from '../skills/hydra/scripts/lib/answer.mjs';
import { Unavailable } from '../skills/hydra/scripts/lib/runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(ROOT, 'train/data-balanced-git'));
const sha = data => createHash('sha256').update(data).digest('hex');
const sentinel = new Unavailable('prompt capture only');
async function capture(invoke) {
  let options;
  try { await invoke(async value => { options = value; throw sentinel; }); }
  catch (error) { if (error !== sentinel) throw error; }
  if (!options) throw new Error('Production path did not request its model');
  return options;
}
const planner = await capture(chat => git.gather('Inspect repository branch references.', ROOT, chat));
const rows = [];
function add(seed, intent, system, user, target) {
  rows.push({ head: 'git', worldSeed: seed, intent,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user },
      { role: 'assistant', content: JSON.stringify(target) }] });
}
for (let seed = 76000; seed < 76300; seed++) {
  const file = ['Dockerfile', 'Makefile', 'pyproject.toml', 'settings.gradle', 'CONTRIBUTING.md', 'bootstrap.sh', 'lib/engine_' + seed + '.cc', 'internal/cache_' + seed + '.go', 'src/client ' + seed + '.tsx', 'app/controller_' + seed + '.ex', 'service/entry_' + seed + '.js', 'conf/retry_' + seed + '.yaml', 'package.json', 'public/view_' + seed + '.html', 'db/store_' + seed + '.rs', 'modules/handler_' + seed + '.py'][seed % 16];
  const quoted = '"' + file + '"';
  const base = ['primary', 'release/maint-' + seed, 'integration_' + seed, 'main', 'master', 'trunk'][seed % 6];
  const fullAuthor = ['Mina Hadley', 'Jules Kamal', 'Nadia Voss', 'Kenzo Silva'][seed % 4];
  const author = seed % 3 === 0 ? fullAuthor.split(' ')[0] : fullAuthor;
  const rev = sha('revision-' + seed).slice(0, 8);
  const n = [1, 2, 3, 5, 7, 10, 15, 20, 35, 50][seed % 10];
  const marker = 'dispatch_' + seed;
  const cases = [
    ['branch_current', ['Name the checked-out branch.', 'Report the branch attached to this checkout.', 'What is my current branch?', 'On which branch is this repository checked out?', 'Tell me the active branch name.', 'What branch am I on now?'], { probe: 'status' }],
    ['sync', ['Report divergence from the upstream tracking reference.', 'Does this checkout have commits ahead of or behind upstream?'], { probe: 'status' }],
    ['modified', ['Enumerate tracked paths with pending edits.', 'Return paths changed in the working copy.', 'Which files have local modifications?', 'What tracked files are dirty?', 'List the files awaiting a commit.', 'Give me the repository status and edited files.'], { probe: 'status' }],
    ['untracked', ['Enumerate new paths outside the Git index.', 'Show paths present on disk that Git does not track.'], { probe: 'status' }],
    ['staged', ['Show the patch currently held in the index.', 'Return the differences prepared for the next commit.', 'What edits have been staged?', 'Give me the cached changes.', 'Inspect the modifications added to the Git index.', 'Show the patch queued for the next commit.'], { probe: 'diff', staged: true }],
    ['file_patch', ['Show pending edits within ' + quoted + '.', 'Give the uncommitted patch for ' + quoted + '.', 'Inspect the unstaged difference inside ' + quoted + '.', 'Which pending source edits exist in ' + quoted + '?', 'Read uncommitted modifications to ' + quoted + '.', 'Return the working copy patch affecting ' + quoted + '.'], { probe: 'diff', path: file, staged: false }],
    ['branch_patch', ['Compare this branch with ' + base + ' and show the changed file paths.', 'Return the branch patch since it diverged from ' + base + '.', 'Which path names differ from ' + base + '?', 'Inventory edited filenames compared to ' + base + '.', 'Against the ' + base + ' reference, identify the altered files.', 'Which files belong to the comparison with ' + base + '?'], { probe: 'diff', base }],
    ['last_commit', ['Describe the newest commit and its patch.', 'Inspect the tip commit of this checkout.', 'Read the commit object referenced by HEAD.', 'Which revision sits at the branch tip?', 'Describe the HEAD revision.', 'Inspect the commit located at the checkout tip.'], { probe: 'show' }],
    ['latest_files', ['Enumerate paths touched by the tip commit.', 'Identify files included in the newest commit.', 'Which paths belong to the HEAD commit?', 'Inventory all files included in HEAD.', 'Return the touched file names for the tip revision.', 'Identify every pathname belonging to the most recent revision.'], { probe: 'show' }],
    ['commit_files', ['Enumerate paths changed by commit ' + rev + '.', 'Inspect the files and patch in revision ' + rev + '.'], { probe: 'show', rev }],
    ['recent', ['Return ' + n + ' newest commits.', 'List the most recent ' + n + ' commits.'], { probe: 'log', n }],
    ['file_history', ['Return ' + n + ' commits affecting ' + quoted + '.', 'Trace the latest ' + n + ' commits for ' + quoted + '.', 'Give ' + n + ' committed revisions involving ' + quoted + '.', 'Read the ' + n + ' newest historical records of ' + quoted + '.', 'Inspect ' + n + ' commits that modified ' + quoted + '.', 'Show up to ' + n + ' earlier changes committed for ' + quoted + '.'], { probe: 'log', path: file, n }],
    ['file_last', ['Identify the newest commit touching ' + quoted + '.', 'Report the author of the most recent commit for ' + quoted + '.', 'Give the last committed edit for ' + quoted + ' with its contributor.', 'For ' + quoted + ', identify its latest commit writer and title.', 'Who committed the newest file change to ' + quoted + '?', 'Find the most recent committed update of ' + quoted + ' and its author.'], { probe: 'log', path: file, n: 1 }],
    ['author', ['Return ' + n + ' commits authored by ' + author + '.', 'List the latest ' + n + ' commits from ' + author + '.'], { probe: 'log', author, n }],
    ['message', ['Find ' + n + ' commits whose messages contain ' + marker + '.', 'Return up to ' + n + ' commits mentioning ' + marker + ' in their subjects.'], { probe: 'log', grep: marker, n }],
    ['branch_history', ['List up to 50 commits on this branch but absent from ' + base + '.', 'Show at most 50 commits added beyond ' + base + '.', 'Return no more than 50 revisions present here but missing from ' + base + '.', 'Read the newest 50 commits unique to this checkout versus ' + base + '.', 'Find up to 50 branch-only revisions beyond ' + base + '.', 'List the latest 50 branch-only commits relative to ' + base + '.'], { probe: 'log', base, n: 50 }],
    ['blame', ['Attribute the line containing ' + marker + ' in ' + quoted + '.', 'Who introduced the specific ' + marker + ' line inside ' + quoted + '?'], { probe: 'blame', path: file }],
    ['branches', ['Enumerate local and remote branch references.', 'Return all branch names and their tips.', 'Summarize every named branch reference in this repository.', 'List the available branch references.', 'What branch names are registered locally and remotely?', 'Inspect the complete branch registry.'], { probe: 'branches' }],
    ['stash', ['Enumerate saved stashes in this repository.', 'Show the shelved Git changes.'], { probe: 'stash' }],
    ['worktrees', ['Enumerate linked working directories and their branches.', 'Return the registered Git worktree paths.'], { probe: 'worktrees' }],
    ['remotes', ['Show remote aliases and their fetch URLs.', 'Enumerate configured remote names and addresses.'], { probe: 'remotes' }],
    ['tags', ['Enumerate repository tag references.', 'Return tags ordered from newest to oldest.'], { probe: 'tags' }],
    ['staged_paths', ['Which filenames have staged edits?', 'List all files already added for a commit.', 'What paths have changes in the Git index?', 'Show staged file names.', 'Inventory the cached file changes.', 'Name the files prepared for committing.'], { probe: 'diff', staged: true }],
    ['numeric_blame', ['Find the contributor to line ' + n + ' in ' + quoted + '.', 'Read blame for source line ' + n + ' of ' + quoted + '.'], { probe: 'blame', path: file }],
    ['all_file_history', ['List all recorded commits involving ' + quoted + '.', 'Show the commit history for ' + quoted + '.'], { probe: 'log', path: file, n: 50 }],
    ['all_author_history', ['Read all available commits written by ' + author + '.', 'List the commit history by ' + author + '.'], { probe: 'log', author, n: 50 }],
    ['combined_patch', ['Show both staged and unstaged modifications.', 'Read the staged differences together with the unstaged edits.'], { probe: 'diff', staged: false }],
    ['staged_file_patch', ['Show staged changes to ' + quoted + '.', 'Read the cached patch for ' + quoted + '.'], { probe: 'diff', path: file, staged: true }],
    ['author_file_history', ['Find ' + n + ' commits by ' + author + ' affecting ' + quoted + '.', 'List ' + n + ' revisions written by ' + author + ' that touched ' + quoted + '.'], { probe: 'log', path: file, author, n }],
  ];
  for (const [kindIndex, [intent, phrasings, probe]] of cases.entries()) {
    add(seed, intent, planner.system, phrasings[(seed + kindIndex) % phrasings.length], { probes: [probe] });
  }
  for (const kind of ['branch_files', 'commit_files', 'patch', 'attribution']) {
    const noise = Array.from({ length: 40 }, (_, i) => '// diagnostic context ' + i + ' ' + 'x'.repeat(45));
    const facts = kind === 'attribution'
      ? [rev + ' (' + author + ' 2026-01-01 12) def ' + marker + '():']
      : kind === 'patch' ? ['--- a/' + file, '+++ b/' + file, '-old_' + marker, '+new_' + marker]
        : [file + ' | 2 +-', 'src/extra_' + seed + '.js | 1 +'];
    const offset = 1 + (seed + kind.length) % 35;
    const lines = [...noise.slice(0, offset), ...facts, ...noise.slice(offset)];
    const question = kind === 'attribution' ? 'Which contributor introduced ' + marker + '?'
      : kind === 'patch' ? 'Show the altered source text in ' + quoted + '.'
        : 'List every file changed by this ' + (kind === 'branch_files' ? 'branch comparison.' : 'commit.');
    const options = await capture(chat => answer(question, [{ probe: kind === 'attribution' ? 'blame' : kind === 'branch_files' ? 'diff' : 'show',
      cmd: kind === 'attribution' ? 'git blame -- ' + file : kind === 'branch_files' ? 'git diff ' + base + '...HEAD' : 'git show ' + rev,
      out: lines.join('\n') }], chat));
    const selected = [...options.user.matchAll(/^\[(\d+)\] (.*)$/gm)]
      .filter(match => facts.includes(match[2])).map(match => Number(match[1]));
    if (selected.length !== facts.length || selected.length > 12) throw new Error('Evidence gold omitted or truncated');
    add(seed, 'evidence_' + kind, options.system, options.user, { lines: selected });
  }
}
const content = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const sourceNames = ['train/build_balanced_git.mjs', 'skills/hydra/scripts/lib/git.mjs', 'skills/hydra/scripts/lib/answer.mjs'];
const manifest = { scope: 'New balanced synthetic Git planner and evidence training. No release-quality claim; existing development/holdout sets remain separate.',
  sealedInputsUsed: false, developmentInputsUsed: false,
  worldSeeds: [...new Set(rows.map(row => row.worldSeed))], seedMeaning: 'Synthetic scenario IDs, not materialized repository worlds',
  dataSha256: sha(content), samplesByHead: { git: rows.length },
  intentCounts: Object.fromEntries([...new Set(rows.map(row => row.intent))].map(intent => [intent, rows.filter(row => row.intent === intent).length])),
  probeCounts: Object.fromEntries(Object.keys(git.PROBES).map(probe => [probe, rows.filter(row => JSON.parse(row.messages[2].content).probes?.[0].probe === probe).length])),
  sourceHashes: Object.fromEntries(sourceNames.map(name => [name, sha(readFileSync(path.join(ROOT, name)))])) };
if (Object.values(manifest.probeCounts).some(n => n < 40)) throw new Error('Fixed menu training coverage incomplete');
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'train.jsonl'), content);
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ samples: rows.length, probeCounts: manifest.probeCounts, dataSha256: manifest.dataSha256 }));
