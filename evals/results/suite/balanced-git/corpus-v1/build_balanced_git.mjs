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
for (let seed = 74000; seed < 74040; seed++) {
  const file = seed % 3 === 0 ? 'src/client ' + seed + '.ts' : 'lib/worker_' + seed + '.py';
  const quoted = '"' + file + '"';
  const base = 'integration_' + seed;
  const author = 'Contributor' + seed;
  const rev = sha('revision-' + seed).slice(0, 8);
  const n = 1 + seed % 12;
  const marker = 'dispatch_' + seed;
  const cases = [
    ['branch_current', ['Name the checked-out branch.', 'Report the branch attached to this checkout.'], { probe: 'status' }],
    ['sync', ['Report divergence from the upstream tracking reference.', 'Does this checkout have commits ahead of or behind upstream?'], { probe: 'status' }],
    ['modified', ['Enumerate tracked paths with pending edits.', 'Return paths changed in the working copy.'], { probe: 'status' }],
    ['untracked', ['Enumerate new paths outside the Git index.', 'Show paths present on disk that Git does not track.'], { probe: 'status' }],
    ['staged', ['Show the patch currently held in the index.', 'Return the differences prepared for the next commit.'], { probe: 'diff', staged: true }],
    ['file_patch', ['Show pending edits within ' + quoted + '.', 'Give the uncommitted patch for ' + quoted + '.'], { probe: 'diff', path: file }],
    ['branch_patch', ['Compare this branch with ' + base + ' and show the changed file paths.', 'Return the branch patch since it diverged from ' + base + '.'], { probe: 'diff', base }],
    ['last_commit', ['Describe the newest commit and its patch.', 'Inspect the tip commit of this checkout.'], { probe: 'show' }],
    ['latest_files', ['Enumerate paths touched by the tip commit.', 'Identify files included in the newest commit.'], { probe: 'show' }],
    ['commit_files', ['Enumerate paths changed by commit ' + rev + '.', 'Inspect the files and patch in revision ' + rev + '.'], { probe: 'show', rev }],
    ['recent', ['Return ' + n + ' newest commits.', 'List the most recent ' + n + ' commits.'], { probe: 'log', n }],
    ['file_history', ['Return ' + n + ' commits affecting ' + quoted + '.', 'Trace the latest ' + n + ' commits for ' + quoted + '.'], { probe: 'log', path: file, n }],
    ['file_last', ['Identify the newest commit touching ' + quoted + '.', 'Report the author of the most recent commit for ' + quoted + '.'], { probe: 'log', path: file, n: 1 }],
    ['author', ['Return ' + n + ' commits authored by ' + author + '.', 'List the latest ' + n + ' commits from ' + author + '.'], { probe: 'log', author, n }],
    ['message', ['Find ' + n + ' commits whose messages contain ' + marker + '.', 'Return up to ' + n + ' commits mentioning ' + marker + ' in their subjects.'], { probe: 'log', grep: marker, n }],
    ['branch_history', ['List up to 50 commits on this branch but absent from ' + base + '.', 'Show at most 50 commits added beyond ' + base + '.'], { probe: 'log', base, n: 50 }],
    ['blame', ['Attribute the line containing ' + marker + ' in ' + quoted + '.', 'Who introduced the specific ' + marker + ' line inside ' + quoted + '?'], { probe: 'blame', path: file }],
    ['branches', ['Enumerate local and remote branch references.', 'Return all branch names and their tips.'], { probe: 'branches' }],
    ['stash', ['Enumerate saved stashes in this repository.', 'Show the shelved Git changes.'], { probe: 'stash' }],
    ['worktrees', ['Enumerate linked working directories and their branches.', 'Return the registered Git worktree paths.'], { probe: 'worktrees' }],
    ['remotes', ['Show remote aliases and their fetch URLs.', 'Enumerate configured remote names and addresses.'], { probe: 'remotes' }],
    ['tags', ['Enumerate repository tag references.', 'Return tags ordered from newest to oldest.'], { probe: 'tags' }],
  ];
  for (const [intent, phrasings, probe] of cases) {
    add(seed, intent, planner.system, phrasings[seed % phrasings.length], { probes: [probe] });
  }
  for (const kind of ['branch_files', 'commit_files', 'patch', 'attribution']) {
    const noise = Array.from({ length: 12 }, (_, i) => '// diagnostic context ' + i + ' ' + 'x'.repeat(65));
    const facts = kind === 'attribution'
      ? [rev + ' (' + author + ' 2026-01-01 12) def ' + marker + '():']
      : kind === 'patch' ? ['--- a/' + file, '+++ b/' + file, '-old_' + marker, '+new_' + marker]
        : [file + ' | 2 +-', 'src/extra_' + seed + '.js | 1 +'];
    const lines = [...noise.slice(0, 5), ...facts, ...noise.slice(5)];
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
