import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { answer } from '../skills/hydra/scripts/lib/answer.mjs';
import * as files from '../skills/hydra/scripts/lib/files.mjs';
import * as git from '../skills/hydra/scripts/lib/git.mjs';
import { record, stats } from '../skills/hydra/scripts/lib/ledger.mjs';
import { Unavailable } from '../skills/hydra/scripts/lib/ollama.mjs';
import { route } from '../skills/hydra/scripts/lib/route.mjs';
import * as test_logs from '../skills/hydra/scripts/lib/test_logs.mjs';
import * as read from '../skills/hydra/scripts/lib/read.mjs';
import * as osHead from '../skills/hydra/scripts/lib/os.mjs';

const temp = () => mkdtempSync(path.join(os.tmpdir(), 'hydra-'));
const replies = (...list) => async () => {
  const next = list.shift();
  if (next instanceof Error) throw next;
  return next;
};

function repo() {
  const dir = temp();
  const run = (...argv) => execFileSync('git', ['-c', 'user.name=Asha', '-c', 'user.email=a@example.com', ...argv], { cwd: dir });
  run('init', '-q');
  writeFileSync(path.join(dir, 'app.js'), 'export const port = 3000;\n');
  run('add', '.');
  run('commit', '-q', '-m', 'add port setting');
  return dir;
}

test('route sends git questions to git and everything else to files', () => {
  assert.equal(route('what are my uncommitted changes?', true), 'git');
  assert.equal(route('who changed app.js last?', true), 'git');
  assert.equal(route('where is the commit handler defined?', true), 'files');
  assert.equal(route('when was README.md last modified?', true), 'git');
  assert.equal(route('how is the port configured?', true), 'files');
  assert.equal(route('what is on this branch?', false), 'files');
});

test('git head runs the chosen probes and drops arguments it cannot trust', async () => {
  const dir = repo();
  const plan = {
    probes: [
      { probe: 'log', n: 5, path: '--output=leak.txt' },
      { probe: 'show', rev: 'no-such-branch' },
      { probe: 'blame' },
      { probe: 'log', n: 3, path: 'app.js', author: 'Asha' },
    ],
  };
  // The question names both the option-shaped path and the missing branch, so only their own checks can drop them.
  const question = 'what changed in app.js, --output=leak.txt or no-such-branch?';
  const sections = await git.gather(question, dir, replies(plan));

  assert.deepEqual(
    sections.map(s => s.cmd),
    ['git log -n5', 'git show HEAD', 'git log -n3 -- app.js'],
  );
  assert.match(sections[0].out, /Asha: add port setting/);
  assert.match(sections[1].out, /\+export const port = 3000;/);
});

test('git head compares against a base branch the question names', async () => {
  const dir = repo();
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
  const plan = { probes: [{ probe: 'log', base: branch }, { probe: 'diff', base: branch }, { probe: 'log', base: 'elsewhere' }] };
  const sections = await git.gather(`what is here that ${branch} lacks?`, dir, replies(plan));

  assert.deepEqual(
    sections.map(s => s.cmd),
    // Commits ahead of a base are returned whole (up to 50) unless the question asks for a count.
    [`git log -n50 ${branch}..HEAD`, `git diff ${branch}...HEAD`, 'git log -n15'],
  );
});

test('git head falls back to status and log when the plan is unusable', async () => {
  const sections = await git.gather('anything', repo(), replies(new SyntaxError('bad json')));
  assert.deepEqual(
    sections.map(s => s.cmd),
    ['git status --short --branch', 'git log -n15'],
  );
});

test('Git history drops a redundant file-name message filter', async () => {
  const dir = repo();
  const sections = await git.gather('Show the history of app.js.', dir,
    replies({ probes: [{ probe: 'log', path: 'app.js', grep: 'app.js' }] }));
  assert.equal(sections[0].args.grep, undefined);
  assert.match(sections[0].out, /add port setting/);
});

test('Git author history drops unintended message filters and unconfirmed author labels', async () => {
  const dir = repo();
  const byAuthor = await git.gather('List commits written by Asha.', dir,
    replies({ probes: [{ probe: 'log', author: 'Asha', grep: 'Asha' }] }));
  assert.equal(byAuthor[0].args.grep, undefined);
  assert.match(byAuthor[0].out, /Asha: add port setting/);
  const byFile = await git.gather('Name the last contributor to app.js.', dir,
    replies({ probes: [{ probe: 'log', path: 'app.js', author: 'last contributor' }] }));
  assert.equal(byFile[0].args.author, undefined);
  assert.match(byFile[0].out, /Asha: add port setting/);
});

test('Git keeps an explicitly requested compound author/file/message filter', async () => {
  const dir = repo();
  const sections = await git.gather('Find commits by Asha affecting app.js with message containing port.', dir,
    replies({ probes: [{ probe: 'log', path: 'app.js', author: 'Asha', grep: 'port' }] }));
  assert.equal(sections[0].args.author, 'Asha');
  assert.equal(sections[0].args.path, 'app.js');
  assert.equal(sections[0].args.grep, 'port');
  assert.match(sections[0].out, /add port setting/);
});

test('Git preserves an explicitly named unknown author as an empty query', async () => {
  const dir = repo();
  const sections = await git.gather('List commits written by NobodySuiteWriter.', dir,
    replies({ probes: [{ probe: 'log', author: 'NobodySuiteWriter' }] }));
  assert.equal(sections[0].args.author, 'NobodySuiteWriter');
  assert.equal(sections[0].out, '(no output)');
});

test('files head finds the same lines with ripgrep and with the built-in walk', async () => {
  const dir = temp();
  mkdirSync(path.join(dir, 'src'));
  mkdirSync(path.join(dir, 'node_modules'));
  writeFileSync(path.join(dir, 'src', 'config.js'), '// settings\nexport function parseConfig(raw) {}\n');
  writeFileSync(path.join(dir, 'node_modules', 'dep.js'), 'parseConfig()\n');
  writeFileSync(path.join(dir, 'CHANGELOG.md'), 'renamed parseConfig\n');
  writeFileSync(path.join(dir, 'README.md'), 'Call parseConfig first.\n');

  // Source before prose, generated and vendored files left out.
  const expected = ['src/config.js:2:export function parseConfig(raw) {}', 'README.md:1:Call parseConfig first.'];
  const walked = await files.scan(dir, ['parseConfig'], false);
  assert.deepEqual(walked.hits.get('parseConfig'), expected);
  assert.deepEqual(walked.files, ['README.md', 'src/config.js']);

  const sections = await files.gather('where is the config parsed?', dir, replies({ terms: ['parseConfig', 'config'] }));
  assert.deepEqual(sections[0], { cmd: 'files named like parseConfig, config', out: 'src/config.js' });
  assert.equal(sections[1].out, expected.join('\n'));
});

const long = Array.from({ length: 60 }, (_, i) => `commit ${i + 1} ${'x'.repeat(20)}`).join('\n');

test('answer prints the cited lines verbatim and ignores numbers that do not exist', async () => {
  const sections = [{ cmd: 'git log -n60', out: long }];
  const { text, rawChars } = await answer('q', sections, replies({ answer: 'It was the fortieth.', lines: [40, 99] }));

  const shown = [1, 2, 3, 40].map(i => `commit ${i} ${'x'.repeat(20)}`).join('\n');
  assert.equal(text, `Selected evidence:\n\n$ git log -n60\n${shown}\n(56 more lines not shown)`);
  assert.equal(rawChars, long.length);
});

test('answer shows the start of each output when the model reply is unusable', async () => {
  const { text } = await answer('q', [{ cmd: 'git log -n60', out: long }], replies(new SyntaxError('bad json')));
  assert.match(text, /no usable answer/);
  assert.match(text, /commit 8 x+\n\(52 more lines not shown\)$/);
});

test('answer hands small output over whole, without asking the model', async () => {
  const never = async () => assert.fail('the model was called');
  const { text } = await answer('q', [{ cmd: 'git status --short --branch', out: '## main...origin/main\n' }], never);
  assert.equal(text, '$ git status --short --branch\n## main...origin/main');
});

test('an unreachable model stops the call instead of producing a guess', async () => {
  await assert.rejects(answer('q', [{ cmd: 'x', out: long }], replies(new Unavailable('down'))), Unavailable);
  await assert.rejects(git.gather('q', repo(), replies(new Unavailable('down'))), Unavailable);
});

test('ledger totals what was read locally against what was returned', () => {
  process.env.HYDRA_HOME = temp();
  record({ head: 'git', raw: 900, returned: 100 });
  record({ head: 'files', raw: 50, returned: 80 });
  assert.deepEqual(stats(), { calls: 2, raw: 950, returned: 180, heads: { git: 1, files: 1 } });
});

test('route sends test questions to test head', () => {
  assert.equal(route('did the tests pass?', true), 'test');
  assert.equal(route('why did the test fail?', true), 'test');
  assert.equal(route('is there any build failure?', true), 'test');
});

test('test_logs hands short output over whole without calling the model', async () => {
  const never = async () => assert.fail('the model was called');
  const shortPass = await test_logs.digest({ cmd: 'npm test', out: 'PASS src/index.test.ts', exitCode: 0 }, never);
  // A short pass is the output alone: the command line would cost more than it labels.
  assert.equal(shortPass.text, 'PASS src/index.test.ts');
  assert.equal(shortPass.exitCode, 0);

  const shortFail = await test_logs.digest({ cmd: 'npm test', out: 'FAIL src/index.test.ts', exitCode: 1 }, never);
  assert.equal(shortFail.text, '$ npm test (exit 1)\nFAIL src/index.test.ts');
  assert.equal(shortFail.exitCode, 1);

  const venv = await test_logs.digest({ cmd: '/home/u/.venv/bin/python -m pytest -q', out: 'E assert 1 == 2', exitCode: 1 }, never);
  assert.equal(venv.text, '$ python -m pytest -q (exit 1)\nE assert 1 == 2');
  assert.equal(test_logs.label('"/a b/bin/node" --test x/y.mjs'), 'node --test x/y.mjs');
  assert.equal(test_logs.label('npm test'), 'npm test');
});

test('test_logs summarizes passing tests when output is long without calling the model', async () => {
  const never = async () => assert.fail('the model was called');
  const longPass = 'console.log("noisy")\n'.repeat(60) + 'Tests: 12 passed, 12 total\n';
  const res = await test_logs.digest({ cmd: 'npm test', out: longPass, exitCode: 0 }, never);
  assert.match(res.text, /All tests passed/);
  assert.match(res.text, /Tests: 12 passed/);
  assert.match(res.text, /Verbose output withheld/);
  assert.equal(res.exitCode, 0);
});

test('test_logs extracts failure lines and excludes unverified model summaries', async () => {
  const noisyFail = [
    'FAIL src/auth.test.ts > login',
    'AssertionError: expected 200 to be 401',
    '- Expected: 401',
    '+ Received: 200',
    'at src/auth.test.ts:42:18',
    ...Array.from({ length: 60 }, (_, i) => `node_modules/vitest/internal/runner.js:${i}`),
  ].join('\n');

  const modelReply = {
    summary: 'login test failed: expected 401 but got 200 at src/auth.test.ts:42',
    lines: [1, 2, 3, 4, 5],
  };

  const res = await test_logs.digest({ cmd: 'npm test', out: noisyFail, exitCode: 1 }, replies(modelReply));
  assert.doesNotMatch(res.text, /Local model says:/);
  assert.match(res.text, /FAIL src\/auth\.test\.ts > login/);
  assert.match(res.text, /AssertionError: expected 200 to be 401/);
  assert.match(res.text, /at src\/auth\.test\.ts:42:18/);
  assert.doesNotMatch(res.text, /node_modules\/vitest\/internal\/runner\.js:50/);
  assert.equal(res.exitCode, 1);
});

test('test_logs falls back to candidate lines when model reply is unusable', async () => {
  const noisyFail = [
    'FAIL src/auth.test.ts > login',
    'AssertionError: expected 200 to be 401',
    '- Expected: 401',
    '+ Received: 200',
    'at src/auth.test.ts:42:18',
    ...Array.from({ length: 60 }, (_, i) => `node_modules/vitest/internal/runner.js:${i}`),
  ].join('\n');

  const res = await test_logs.digest({ cmd: 'npm test', out: noisyFail, exitCode: 1 }, replies(new SyntaxError('bad json')));
  assert.doesNotMatch(res.text, /Local model says:/);
  assert.match(res.text, /FAIL src\/auth\.test\.ts > login/);
  assert.match(res.text, /AssertionError: expected 200 to be 401/);
  assert.equal(res.exitCode, 1);
});

test('route sends file reading questions to read head', () => {
  assert.equal(route('read src/auth.ts', true), 'read');
  assert.equal(route('show authenticate in src/auth.ts', true), 'read');
  assert.equal(route('outline of src/server.js', true), 'read');
  assert.equal(route('slice lines 10-30 in app.py', true), 'read');
});

test('read slices line range correctly with line numbers', () => {
  const content = 'one\ntwo\nthree\nfour\nfive';
  const sliced = read.sliceLines(content, 2, 4);
  assert.equal(sliced, '2: two\n3: three\n4: four');
});

test('read slices JS function with braces and leading comments', () => {
  const content = [
    '// Helper function',
    'export function computeTotal(items) {',
    '  let sum = 0;',
    '  for (const item of items) {',
    '    sum += item.price;',
    '  }',
    '  return sum;',
    '}',
    '',
    'export const taxRate = 0.08;',
  ].join('\n');

  const res = read.sliceSymbol(content, 'computeTotal');
  assert.ok(res);
  assert.equal(res.start, 1); // includes leading comment
  assert.equal(res.end, 8);
  assert.match(res.text, /Helper function/);
  assert.match(res.text, /return sum;/);
  assert.doesNotMatch(res.text, /taxRate/);
});

test('read slices Python defs using indentation blocks', () => {
  const pyContent = [
    '# Calculates discounted price',
    'def apply_discount(price, rate):',
    '    if rate <= 0:',
    '        return price',
    '    discount = price * rate',
    '    return price - discount',
    '',
    'def other_func():',
    '    pass',
  ].join('\n');

  const res = read.sliceSymbol(pyContent, 'apply_discount');
  assert.ok(res);
  assert.equal(res.start, 1);
  assert.equal(res.end, 6);
  assert.match(res.text, /apply_discount/);
  assert.match(res.text, /return price - discount/);
  assert.doesNotMatch(res.text, /other_func/);
});

test('read outline extracts top-level symbols and ignores inner declarations', () => {
  const code = [
    'export const API_URL = "https://api.example.com";',
    '',
    'export async function fetchData(url) {',
    '  const res = await fetch(url);',
    '  const data = await res.json();',
    '  return data;',
    '}',
    '',
    'function helper() {',
    '  let temp = 1;',
    '}',
  ].join('\n');

  const symbols = read.outline(code);
  const names = symbols.map(s => s.name);
  assert.deepEqual(names, ['API_URL', 'fetchData', 'helper']);
});

test('readSlice handles short files verbatim, line ranges, and missing files', async () => {
  const dir = temp();
  const filePath = path.join(dir, 'example.js');
  writeFileSync(filePath, 'console.log("short file");\n');

  // Short file pass-through
  const shortRes = await read.readSlice(filePath, {}, dir);
  assert.ok(shortRes.ok);
  assert.match(shortRes.text, /console\.log\("short file"\);/);

  // Missing file
  const missRes = await read.readSlice('non_existent.js', {}, dir);
  assert.equal(missRes.ok, false);
  assert.match(missRes.error, /File not found/);

  // Explicit line range
  const multiLine = path.join(dir, 'multi.txt');
  writeFileSync(multiLine, Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'));
  const rangeRes = await read.readSlice('multi.txt', { lines: '10-15' }, dir);
  assert.ok(rangeRes.ok);
  assert.match(rangeRes.text, /10: line 10/);
  assert.match(rangeRes.text, /15: line 15/);
  assert.doesNotMatch(rangeRes.text, /16: line 16/);
});

test('read gather extracts file path and symbol from question', async () => {
  const dir = temp();
  const filePath = path.join(dir, 'service.js');
  writeFileSync(filePath, 'export function login(user) {\n  return true;\n}\n');

  const sections = await read.gather('show login in service.js', dir, null);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].cmd, 'read service.js login');
  assert.match(sections[0].out, /export function login/);
});

test('read gather preserves quoted paths with spaces for ranges, symbols and outlines', async () => {
  const dir = temp();
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, 'src', 'My File.ts'), 'export function login(user) {\n  return true;\n}\n');
  for (const quote of ['"', "'"]) {
    const range = await read.gather(`read ${quote}src/My File.ts${quote} lines 2-3`, dir, null);
    assert.match(range[0].out, /2:   return true;/);
    assert.doesNotMatch(range[0].out, /File not found/);
    const symbol = await read.gather(`show login in ${quote}src/My File.ts${quote}`, dir, null);
    assert.match(symbol[0].out, /export function login/);
    const outline = await read.gather(`outline ${quote}src/My File.ts${quote}`, dir, null);
    assert.match(outline[0].out, /Outline of definitions/);
  }
});

test('an explicitly requested read slice is returned whole, not cut down by the model', async () => {
  const dir = temp();
  const body = Array.from({ length: 40 }, (_, i) => `  const value_${i} = "padding text so this slice is longer than the pass-through limit";`);
  writeFileSync(path.join(dir, 'big.js'), ['export function wide() {', ...body, '}', ''].join('\n'));
  const firstOnly = async () => ({ lines: [1] });
  for (const question of ['read big.js lines 5-30', 'read big.js at function wide']) {
    const { text } = await answer(question, await read.gather(question, dir, null), firstOnly);
    assert.match(text, /^30: /m, question);
    assert.doesNotMatch(text, /more lines not shown/, question);
  }
});

test('route sends system questions to os head', () => {
  assert.equal(route('which ports are listening?', true), 'os');
  assert.equal(route('what is the cpu usage and uptime?', true), 'os');
  assert.equal(route('how much disk space is left?', true), 'os');
});

test('os head probes execute safely and return output', async () => {
  const sections = await osHead.gather('how much disk space is left?', process.cwd(), null);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].probe, 'disk');
  assert.match(sections[0].out, /Filesystem/);
});

test('os head blocks sensitive environment variable inspection', async () => {
  const safeRes = await osHead.PROBES.env.cmd({ var: 'PATH' });
  assert.ok(safeRes.ok);
  assert.match(safeRes.out, /PATH=/);

  const blockedRes = await osHead.PROBES.env.cmd({ var: 'MY_API_KEY' });
  assert.ok(blockedRes.ok);
  assert.match(blockedRes.out, /GUARDRAIL/);
});

test('os head filters processes by name', async () => {
  const sections = await osHead.gather('is node running?', process.cwd(), null);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].probe, 'processes');
  assert.match(sections[0].out, /node/i);
});

test('os fallback plans one probe per requested topic', async () => {
  const probes = async question => (await osHead.gather(question, process.cwd(), null)).map(section => section.probe);
  assert.deepEqual(await probes('is there free storage, plus how much memory headroom?'), ['disk', 'memory']);
  assert.deepEqual(await probes('list every listener as well as the process table'), ['ports', 'processes']);
  assert.deepEqual(await probes('how large is the swap space?'), ['memory']);
  assert.deepEqual(await probes('which processes are listening on ports?'), ['ports']);
  assert.deepEqual(await probes('what program parameters are used?'), ['system']);
});

test('os plan adds a topic the model dropped from a compound question', async () => {
  const original = Object.fromEntries(Object.entries(osHead.PROBES).map(([key, probe]) => [key, probe.cmd]));
  try {
    for (const key of Object.keys(osHead.PROBES)) osHead.PROBES[key].cmd = async () => ({ ok: true, out: `fixture-${key}` });
    const only = probe => async () => ({ probes: [{ probe }] });
    const probes = async (question, chat) => (await osHead.gather(question, process.cwd(), chat)).map(section => section.probe);
    assert.deepEqual(await probes('is there free storage, plus how much memory headroom?', only('disk')), ['disk', 'memory']);
    assert.deepEqual(await probes('list every listener as well as the process table', only('ports')), ['ports', 'processes']);
    assert.deepEqual(await probes('which processes are listening on ports?', only('ports')), ['ports']);
    assert.deepEqual(await probes('how much RAM and memory pressure?', only('memory')), ['memory']);
    const invented = async () => ({ probes: [{ probe: 'disk', name: 'disk', var: 'disk_usage' }, { probe: 'env', var: 'NODE_ENV', name: 'x' }] });
    const sections = await osHead.gather('disk space and NODE_ENV', process.cwd(), invented);
    assert.deepEqual(sections.map(section => section.args), [{ probe: 'disk' }, { probe: 'env', var: 'NODE_ENV' }]);
  } finally {
    for (const [key, cmd] of Object.entries(original)) osHead.PROBES[key].cmd = cmd;
  }
});

test('os plan treats an environment-variable name planned as a process as an env lookup', async () => {
  const chat = async () => ({ probes: [{ probe: 'processes', name: 'BUILD_FLAVOR_17' }] });
  const sections = await osHead.gather('What is the value of BUILD_FLAVOR_17?', process.cwd(), chat);
  assert.deepEqual(sections.map(section => section.args), [{ probe: 'env', var: 'BUILD_FLAVOR_17' }]);
  const named = async () => ({ probes: [{ probe: 'processes', name: 'nginx' }] });
  assert.deepEqual((await osHead.gather('is nginx up?', process.cwd(), named)).map(section => section.args), [{ probe: 'processes', name: 'nginx' }]);
});

test('os compound questions joined by "or" and "along with" get both probes', async () => {
  const probes = async question => (await osHead.gather(question, process.cwd(), null)).map(section => section.probe);
  assert.deepEqual(await probes('is the disk or the RAM running low?'), ['disk', 'memory']);
  assert.deepEqual(await probes('open sockets along with the process list'), ['ports', 'processes']);
  assert.deepEqual(await probes('is node or python running?'), ['processes']);
});

test('os ports output keeps only the listener for a named port', async () => {
  const original = osHead.PROBES.ports.cmd;
  try {
    osHead.PROBES.ports.cmd = async () => ({ ok: true, out: 'COMMAND PID NAME\nnode 11 TCP 127.0.0.1:3000 (LISTEN)\njava 12 TCP 127.0.0.1:30001 (LISTEN)\nruby 13 TCP *:8080 (LISTEN)' });
    const [section] = await osHead.gather('who owns :3000', process.cwd(), async () => ({ probes: [{ probe: 'ports' }] }));
    assert.equal(section.out, 'COMMAND PID NAME\nnode 11 TCP 127.0.0.1:3000 (LISTEN)');
    const [none] = await osHead.gather('what is on port 9999?', process.cwd(), async () => ({ probes: [{ probe: 'ports' }] }));
    assert.match(none.out, /^COMMAND PID NAME\n\(no listener on port 9999\)$/);
  } finally {
    osHead.PROBES.ports.cmd = original;
  }
});

test('os port and process lists are returned whole, not cut to the model line choice', async () => {
  const rows = Array.from({ length: 24 }, (_, i) => `${4000 + i} ${(40 - i).toFixed(1)} 1.0 /usr/local/bin/service_number_${i}`);
  const sections = [{ probe: 'processes', cmd: 'os processes', out: ['PID %CPU %MEM COMM', ...rows].join('\n') }];
  const { text } = await answer('what is eating the CPU?', sections, async () => ({ lines: [2] }));
  assert.ok(rows.every(row => text.includes(row)));
});

test('search ranks current source before archived definitions on both backends', async () => {
  const dir = temp();
  mkdirSync(path.join(dir, 'evals/results/snapshot'), { recursive: true });
  writeFileSync(path.join(dir, 'evals/results/snapshot/copy.js'), 'export function currentSymbol() {}');
  writeFileSync(path.join(dir, 'source.js'), 'export function currentSymbol() {}');
  for (const backend of [false, true]) {
    const hits = (await files.scan(dir, ['currentSymbol'], backend)).hits.get('currentSymbol');
    assert.match(hits[0], /^source\.js:/);
    assert.ok(hits.some(hit => hit.startsWith('evals/results/')));
  }
});

test('OS probe failures are retained in evidence', async () => {
  const original = osHead.PROBES.disk.cmd;
  try {
    osHead.PROBES.disk.cmd = async () => ({ ok: false, out: 'command unavailable' });
    const [section] = await osHead.gather('disk space', process.cwd(), null);
    assert.equal(section.ok, false);
    assert.match(section.out, /\[probe failed\] command unavailable/);
  } finally {
    osHead.PROBES.disk.cmd = original;
  }
});

test('system and memory probes return usable machine facts', async () => {
  const system = await osHead.PROBES.system.cmd();
  assert.ok(system.ok);
  assert.ok(system.out.includes(os.release()));
  assert.match(system.out, /Uptime: \d+ seconds/);
  const memory = await osHead.PROBES.memory.cmd();
  assert.ok(memory.ok);
  assert.match(memory.out, /RAM|Mem/);
});

