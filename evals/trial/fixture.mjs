import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const HYDRA = path.join(ROOT, 'skills/hydra/scripts/hydra.mjs');

export function execute(argv, cwd, env = process.env) {
  const started = Date.now();
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  return { argv, exitCode: result.status, error: result.error?.message ?? null,
    stdout: result.stdout ?? '', stderr: result.stderr ?? '', seconds: (Date.now() - started) / 1000 };
}

// A new, hand-written development fixture. No git1 worlds, phrases or word lists are used.
export function createFixture() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'hydra-trial-'));
  const put = (file, content) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), content);
  };
  const source = [
    '// Pricing helpers',
    'export const CURRENCY = "USD";',
    '',
    '// Calculate a discounted basket total.',
    'export function computeTotal(items, discount = 0) {',
    '  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);',
    '  return Math.round(subtotal * (1 - discount) * 100) / 100;',
    '}',
    '',
    'export function isEligible(user) {',
    '  return user.active && user.age >= 18;',
    '}',
    ...Array.from({ length: 180 }, (_, i) => `// Reference note ${i}: unrelated module documentation.`),
    'export const retryLimit = 3;',
  ].join('\n') + '\n';
  put('src/pricing.mjs', source);
  put('src/checkout.mjs', 'import { computeTotal } from "./pricing.mjs";\nexport const checkout = items => computeTotal(items, 0.1);\n');
  put('config.json', '{"mode":"standard"}\n');
  put('notes.txt', 'Initial notes\n');
  put('TRACKER.md', 'Release policy is pending.\n');
  put('README.md', 'Pricing example.\n');
  put('tools/pass.mjs', 'for (let i=0;i<80;i++) console.log(`runner progress ${i}`);\nconsole.log("Tests: 4 passed, 4 total");\nconsole.log("Failures: 0");\n');
  put('tools/fail.mjs', 'console.log("FAIL src/pricing.test.ts > discounted basket\\nAssertionError: expected 19 to be 18\\n- Expected: 18\\n+ Received: 19\\nat src/pricing.test.ts:42:18");\nfor (let i=0;i<60;i++) console.log(`node_modules/runner.js:${i}`);\nprocess.exit(1);\n');
  // A concise direct-command baseline that preserves the child's exit status.
  put('tools/filter.mjs', 'import { spawnSync } from "node:child_process";\nconst r=spawnSync(process.execPath,[`tools/${process.argv[2]}.mjs`],{encoding:"utf8"});\nif(r.error)throw r.error;\nconsole.log(r.stdout.split("\\n").filter(l=>/^(Tests:|Failures:|FAIL |AssertionError:|- Expected:|\\+ Received:|at src\\/)/.test(l)).join("\\n"));\nprocess.exit(r.status ?? 1);\n');
  const git = (...args) => {
    const r = execute(['git', '-c', 'user.name=Fixture Dev', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', ...args], cwd,
      { ...process.env, GIT_AUTHOR_DATE: '2026-10-01T12:00:00+00:00', GIT_COMMITTER_DATE: '2026-10-01T12:00:00+00:00', GIT_CONFIG_NOSYSTEM: '1' });
    if (r.exitCode !== 0) throw new Error(`Fixture git command failed: ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  git('init', '-q', '--initial-branch=main');
  git('add', '.');
  git('commit', '-qm', 'Add pricing helpers and log examples');
  for (let i = 1; i <= 5; i++) {
    put('notes.txt', `Reference revision ${i}\n`);
    git('add', 'notes.txt');
    git('commit', '-qm', `Update reference notes ${i}`);
  }
  put('TRACKER.md', 'Keep the README and trial script private in the release.\n');
  git('add', 'TRACKER.md');
  git('commit', '-qm', 'Record that README and trial script stay private');
  git('branch', 'review');
  put('notes.txt', 'Stashed reference draft\n');
  git('stash', 'push', '-qm', 'Reference draft');
  put('config.json', '{"mode":"strict"}\n');
  git('add', 'config.json');
  put('src/checkout.mjs', readFileSync(path.join(cwd, 'src/checkout.mjs'), 'utf8') + '// Uncommitted checkout note\n');
  put('scratch.txt', 'Untracked draft\n');
  const format = ['--pretty=tformat:%h %ad %an: %s', '--date=short'];
  const recent = git('log', ...format, '-n5').trimEnd().split('\n');
  const sourceLines = source.trimEnd().split('\n');
  const spec = [
    { id: 'read_symbol', head: 'read', raw: ['awk', 'index($0, "export function computeTotal(")==1 {if (substr(prev,1,2)=="//") print prev; show=1} show {print} show && $0=="}" {exit} {prev=$0}', 'src/pricing.mjs'], hydra: ['read', 'src/pricing.mjs', 'computeTotal'],
      gold: { kind: 'source', lines: sourceLines.slice(3, 8), start: 4 } },
    { id: 'read_lines', head: 'read', raw: ['sed', '-n', '5,12p', 'src/pricing.mjs'], hydra: ['read', 'src/pricing.mjs', '--lines', '5-12'],
      gold: { kind: 'source', lines: sourceLines.slice(4, 12), start: 5 } },
    { id: 'outline', head: 'read', raw: ['rg', '-n', '^export (function|const) ', 'src/pricing.mjs'], hydra: ['read', 'src/pricing.mjs', '--outline'],
      gold: { kind: 'definitions', names: ['CURRENCY', 'computeTotal', 'isEligible', 'retryLimit'] } },
    { id: 'definition', head: 'files', raw: ['rg', '-n', '-F', '--sort', 'path', 'computeTotal', '.'], hydra: ['search', 'computeTotal'],
      gold: { kind: 'hits', hits: ['src/pricing.mjs:5:' + sourceLines[4], 'src/checkout.mjs:1:import { computeTotal } from "./pricing.mjs";', 'src/checkout.mjs:2:export const checkout = items => computeTotal(items, 0.1);'], definition: 'src/pricing.mjs:5:' } },
    { id: 'usages', head: 'files', raw: ['rg', '-n', '-F', '--sort', 'path', 'pricing.mjs', '.'], hydra: ['search', 'pricing.mjs'],
      gold: { kind: 'hits', hits: ['src/checkout.mjs:1:import { computeTotal } from "./pricing.mjs";'] } },
    { id: 'status', head: 'git', raw: ['git', 'status', '--short', '--branch'], hydra: ['ask', '--head', 'git', 'which branch am I on and what files are changed or untracked?'],
      gold: { kind: 'status', branch: 'main', entries: ['M  config.json', ' M src/checkout.mjs', '?? scratch.txt'] } },
    { id: 'last_commit', head: 'git', raw: ['git', 'show', '--stat', ...format, 'HEAD'], hydra: ['ask', '--head', 'git', 'what files changed in the last commit?'],
      gold: { kind: 'changes', files: ['TRACKER.md'], subject: 'Record that README and trial script stay private' } },
    { id: 'recent_commits', head: 'git', raw: ['git', 'log', ...format, '-n5'], hydra: ['ask', '--head', 'git', 'show the recent 5 commits'],
      gold: { kind: 'commits', records: recent } },
    { id: 'branches', head: 'git', raw: ['git', 'branch', '--all', '-vv', '--sort=-committerdate'], hydra: ['ask', '--head', 'git', 'which branches exist?'],
      gold: { kind: 'branches', names: ['main', 'review'] } },
    { id: 'passing_tests', head: 'test', raw: ['node', 'tools/filter.mjs', 'pass'], hydra: ['run', '--', 'node', 'tools/pass.mjs'],
      gold: { kind: 'log', lines: ['Tests: 4 passed, 4 total', 'Failures: 0'] } },
    { id: 'failing_tests', head: 'test', raw: ['node', 'tools/filter.mjs', 'fail'], hydra: ['run', '--', 'node', 'tools/fail.mjs'], expectedExitCode: 1,
      gold: { kind: 'log', lines: ['FAIL src/pricing.test.ts > discounted basket', 'AssertionError: expected 19 to be 18', '- Expected: 18', '+ Received: 19', 'at src/pricing.test.ts:42:18'] } },
    { id: 'stashes', head: 'git', raw: ['git', 'stash', 'list'], hydra: ['ask', '--head', 'git', 'list the stashed changes'],
      gold: { kind: 'stash', records: git('stash', 'list').trimEnd().split('\n') } },
  ];
  return { cwd, spec, gold: { recent, sourceLines }, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}
