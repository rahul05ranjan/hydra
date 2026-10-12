// Small, newly authored data for timing/memory preflight, NOT release training data.
// No sealed or existing benchmark input is imported/read.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as git from '../skills/hydra/scripts/lib/git.mjs';
import * as files from '../skills/hydra/scripts/lib/files.mjs';
import * as osHead from '../skills/hydra/scripts/lib/os.mjs';
import { answer } from '../skills/hydra/scripts/lib/answer.mjs';
import { digest } from '../skills/hydra/scripts/lib/test_logs.mjs';
import { Unavailable } from '../skills/hydra/scripts/lib/runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'train/data-full-feasibility'));
const sentinel = new Unavailable('capture only; no inference/probe execution');
async function capture(invoke) {
  let options;
  try { await invoke(async value => { options = value; throw sentinel; }); }
  catch (error) { if (error !== sentinel) throw error; }
  if (!options) throw new Error('Production path did not call its model');
  return options;
}
const prompts = {
  git: await capture(chat => git.gather('Describe tracked edits pending in the work tree.', ROOT, chat)),
  files: await capture(chat => files.gather('Locate the SuiteGate declaration.', ROOT, chat)),
  os: await capture(chat => osHead.gather('Inspect current memory availability.', ROOT, chat)),
  test: await capture(chat => digest({ cmd: 'fixture', exitCode: 1, out: 'noise\n'.repeat(150) + 'FAIL suite\nExpected: 3\nReceived: 4\nfixture.ts:9' }, chat)),
  read: await capture(chat => answer('Which line defines SuiteGate?', [{ cmd: 'read fixture.ts', out: 'filler\n'.repeat(150) + 'export class SuiteGate {}' }], chat)),
};
const rows = [];
function add(head, seed, intent, user, target) {
  rows.push({ head, worldSeed: seed, intent, messages: [{ role: 'system', content: prompts[head].system },
    { role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(target) }] });
}
for (let seed = 71000; seed < 71008; seed++) {
  const file = `src/suite_${seed}.ts`;
  const base = `suite_base_${seed}`;
  const author = `SuiteWriter${seed}`;
  const count = 4 + seed % 5;
  for (const [intent, user, probe] of [
    ['modified', 'Describe tracked edits pending in the work tree.', { probe: 'status' }],
    ['untracked', 'Identify paths that Git has never tracked yet.', { probe: 'status' }],
    ['staged', 'Inspect changes already added to the index.', { probe: 'diff', staged: true }],
    ['file_patch', `Inspect the pending patch inside ${file}.`, { probe: 'diff', path: file }],
    ['file_history', `List ${count} revisions touching ${file}.`, { probe: 'log', path: file, n: count }],
    ['branch_history', `List up to 50 revisions unique to this checkout compared with ${base}.`, { probe: 'log', base, n: 50 }],
    ['branch_diff', `Display the branch patch relative to ${base}.`, { probe: 'diff', base }],
    ['author', `Retrieve ${count} revisions written by ${author}.`, { probe: 'log', author, n: count }],
    ['message', `Retrieve ${count} revisions mentioning suite_marker_${seed} in the subject.`, { probe: 'log', grep: `suite_marker_${seed}`, n: count }],
    ['blame', `Attribute the line containing suiteToken${seed} in ${file}.`, { probe: 'blame', path: file }],
  ]) add('git', seed, intent, user, { probes: [probe] });
  add('files', seed, 'identifier', `Locate the declaration of SuiteGate${seed}.`, { terms: [`SuiteGate${seed}`] });
  add('files', seed, 'config_key', `Locate uses of SUITE_OPTION_${seed}.`, { terms: [`SUITE_OPTION_${seed}`] });
  for (const [probe, user] of [['ports', 'Inspect active TCP listeners.'], ['disk', 'Report remaining filesystem capacity.'],
    ['memory', 'Inspect current memory availability.'], ['system', 'Report the kernel and processor architecture.']]) {
    add('os', seed, probe, user, { probes: [{ probe }] });
  }
  add('os', seed, 'named_process', `Locate the suite_worker_${seed} process.`, { probes: [{ probe: 'processes', name: `suite_worker_${seed}` }] });
  add('os', seed, 'env', `Inspect SUITE_MODE_${seed} in the environment.`, { probes: [{ probe: 'env', var: `SUITE_MODE_${seed}` }] });
  add('test', seed, 'failure_evidence', `[1] build setup complete\n[2] FAIL suite_case_${seed}\n[3] Expected: ${seed}\n[4] Received: ${seed + 1}\n[5] at ${file}:19:2\n[6] runner initialization\n\nSelect failure evidence:`, { lines: [2, 3, 4, 5] });
  add('read', seed, 'definition_evidence', `$ read ${file}\n[1] // helper module\n[2] export function SuiteGate${seed}() {\n[3]   return suite_value_${seed};\n[4] }\n[5] // neighbor begins here\n\nQuestion: Return the SuiteGate${seed} implementation.`, { lines: [2, 3, 4] });
}
mkdirSync(out, { recursive: true });
const content = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
writeFileSync(path.join(out, 'train.jsonl'), content);
const sources = ['git', 'files', 'os', 'test_logs', 'answer'].map(name => `skills/hydra/scripts/lib/${name}.mjs`);
const manifest = { scope: 'New synthetic feasibility examples only. Not enough diversity/heldout coverage for release training or a 95% claim.',
  sealedInputsUsed: false, developmentInputsUsed: false, worldSeeds: [...new Set(rows.map(row => row.worldSeed))],
  seedMeaning: 'Synthetic scenario IDs, not materialized Git repository worlds', dataSha256: sha(content),
  samplesByHead: Object.fromEntries(Object.keys(prompts).map(head => [head, rows.filter(row => row.head === head).length])),
  sourceHashes: Object.fromEntries(sources.map(name => [name, sha(readFileSync(path.join(ROOT, name)))])) };
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
