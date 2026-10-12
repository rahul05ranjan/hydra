#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { answer } from './lib/answer.mjs';
import { run } from './lib/exec.mjs';
import * as files from './lib/files.mjs';
import * as git from './lib/git.mjs';
import * as test_logs from './lib/test_logs.mjs';
import * as read from './lib/read.mjs';
import * as osHead from './lib/os.mjs';
import { record, stats, tokens } from './lib/ledger.mjs';
import { chat, hasModel, BACKEND, modelFor, Unavailable } from './lib/runtime.mjs';
import { route } from './lib/route.mjs';
import { stopLocal } from './lib/local.mjs';

const HEADS = { git, files, test: test_logs, read, os: osHead };

const USAGE = `usage:
  hydra ask "<question>" [--head git|files|test|read|os] answer a question about the repo or system
  hydra search <term...>                               search codebase with definition ranking
  hydra read <file> [symbol|--lines <start-end>]       slice a file, symbol, or show outline
  hydra run [--head test] -- <command...>              run a command and digest test/build output
  hydra os [question...]                               inspect ports, processes, disk, system
  hydra stats                                          token accounting for past calls
  hydra doctor                                         check that the local model is ready
  hydra setup                                          show runtime setup instructions
  hydra stop                                           stop Hydra's managed llama-server`;

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

async function ask(args) {
  const flag = args.indexOf('--head');
  const forced = flag >= 0 ? args.splice(flag, 2)[1] : undefined;
  const question = args.join(' ').trim();
  if (!question || (flag >= 0 && !HEADS[forced])) fail(1, USAGE);

  const cwd = process.cwd();
  const repo = await git.inRepo(cwd);
  const head = forced ?? route(question, repo);
  if (head === 'git' && !repo) fail(1, 'hydra: the git head needs a git repository, and this directory is not in one');

  const started = Date.now();
  const headChat = opts => chat({ ...opts, model: modelFor(head) });
  const sections = await HEADS[head].gather(question, cwd, headChat);
  const { text, rawChars } = await answer(question, sections, headChat);
  const raw = tokens(rawChars);
  const returned = tokens(text.length);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));

  record({ ts: new Date().toISOString(), head, question, raw, returned, seconds });
  console.log(`${text}\n\n[hydra ${head} · read ~${raw} tok locally, returned ~${returned} tok · ${seconds}s]`);
}

async function runCommand(args) {
  const doubleDash = args.indexOf('--');
  let cmdArgs = doubleDash >= 0 ? args.slice(doubleDash + 1) : args;

  if (cmdArgs.length === 0) {
    if (!process.stdin.isTTY) {
      const stdinData = readFileSync(0, 'utf8');
      if (stdinData.trim()) {
        const started = Date.now();
        const testChat = opts => chat({ ...opts, model: modelFor('test') });
        const { text, rawChars, exitCode } = await test_logs.digest({ cmd: 'pipe', out: stdinData, exitCode: 1 }, testChat);
        const raw = tokens(rawChars);
        const returned = tokens(text.length);
        const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
        record({ ts: new Date().toISOString(), head: 'test', question: 'pipe', raw, returned, seconds });
        console.log(`${text}\n\n[hydra test · read ~${raw} tok locally, returned ~${returned} tok · ${seconds}s]`);
        if (exitCode !== 0) process.exit(exitCode);
        return;
      }
    }
    fail(1, USAGE);
  }

  const [prog, ...progArgs] = cmdArgs;
  const cwd = process.cwd();
  const started = Date.now();
  const res = await run(prog, progArgs, cwd);
  const testChat = opts => chat({ ...opts, model: modelFor('test') });
  const { text, rawChars, exitCode } = await test_logs.digest({
    cmd: cmdArgs.join(' '),
    out: res.out,
    err: res.err,
    exitCode: res.exitCode,
  }, testChat);
  const raw = tokens(rawChars);
  const returned = tokens(text.length);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  record({ ts: new Date().toISOString(), head: 'test', question: cmdArgs.join(' '), raw, returned, seconds });
  console.log(`${text}\n\n[hydra test · read ~${raw} tok locally, returned ~${returned} tok · ${seconds}s]`);
  if (exitCode !== 0) process.exit(exitCode);
}

async function readCommand(args) {
  if (args.length === 0) fail(1, USAGE);

  let fileArg = null;
  let symbol = null;
  let lines = null;
  let isOutline = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--lines' && i + 1 < args.length) {
      lines = args[++i];
    } else if (arg.startsWith('--lines=')) {
      lines = arg.slice('--lines='.length);
    } else if (arg === '--outline' || arg === '-o') {
      isOutline = true;
    } else if (/^\d+[:-]\d+$/.test(arg)) {
      lines = arg;
    } else if (!fileArg) {
      fileArg = arg;
    } else if (!symbol) {
      symbol = arg;
    }
  }

  if (!fileArg) fail(1, USAGE);

  const cwd = process.cwd();
  const started = Date.now();
  const res = await read.readSlice(fileArg, { symbol, lines, outline: isOutline }, cwd);
  if (!res.ok) {
    fail(1, `hydra read: ${res.error}`);
  }

  const raw = tokens(res.rawChars);
  const returned = tokens(res.returnedChars);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(2));

  record({
    ts: new Date().toISOString(),
    head: 'read',
    question: `${fileArg}${symbol ? ` ${symbol}` : ''}${lines ? ` ${lines}` : ''}`,
    raw,
    returned,
    seconds,
  });

  console.log(`${res.text}\n\n[hydra read · read ~${raw} tok locally, returned ~${returned} tok · ${seconds}s]`);
}

async function osCommand(args) {
  const question = args.join(' ').trim() || 'system overview';
  const started = Date.now();
  const osChat = opts => chat({ ...opts, model: modelFor('os') });
  const sections = await osHead.gather(question, process.cwd(), osChat);
  const { text, rawChars } = await answer(question, sections, osChat);
  const raw = tokens(rawChars);
  const returned = tokens(text.length);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));

  record({ ts: new Date().toISOString(), head: 'os', question, raw, returned, seconds });
  console.log(`${text}\n\n[hydra os · read ~${raw} tok locally, returned ~${returned} tok · ${seconds}s]`);
}

async function searchCommand(args) {
  const query = args.join(' ').trim();
  if (!query) fail(1, USAGE);

  const cwd = process.cwd();
  const started = Date.now();
  const terms = query.split(/[^\w.-]+/).filter(w => w.length >= 2);
  const { files: matchedFiles, hits } = await files.scan(cwd, terms);

  const sections = [];
  const named = matchedFiles.filter(file => terms.some(term => file.toLowerCase().includes(term.toLowerCase())));
  if (named.length) {
    sections.push(`Files named like "${terms.join(', ')}":\n` + named.slice(0, 15).map(f => `  ${f}`).join('\n'));
  }

  for (const term of terms) {
    const list = hits.get(term) || [];
    if (list.length) {
      sections.push(`Matches for "${term}":\n` + list.slice(0, 25).map(h => `  ${h}`).join('\n'));
    }
  }

  const text = sections.length ? sections.join('\n\n') : `No matches found for "${query}"`;
  const rawChars = sections.reduce((sum, s) => sum + s.length * 3, 100);
  const raw = tokens(rawChars);
  const returned = tokens(text.length);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(2));

  record({
    ts: new Date().toISOString(),
    head: 'files',
    question: `search ${query}`,
    raw,
    returned,
    seconds,
  });

  console.log(`${text}\n\n[hydra files · read ~${raw} tok locally, returned ~${returned} tok · ${seconds}s]`);
}

function showStats() {
  const { calls, raw, returned, heads } = stats();
  const perHead = Object.entries(heads)
    .map(([head, n]) => `${head} ${n}`)
    .join(', ');
  console.log(`calls:        ${calls}${perHead ? ` (${perHead})` : ''}
read locally: ~${raw} tok
returned:     ~${returned} tok
net saved:    ~${raw - returned} tok

Estimate: output size / 4. It counts the output an agent would have read by running
the commands itself, and leaves out the extra turns those commands would have cost.`);
}

async function doctor() {
  const checks = new Map();
  const modelStatuses = await Promise.all(
    ['git', 'os', 'test', 'read', 'files'].map(async head => {
      const name = modelFor(head);
      if (!checks.has(name)) checks.set(name, hasModel(name));
      const ok = await checks.get(name);
      return `${head.padEnd(6)} -> ${name} ${ok ? 'present' : 'missing, see: hydra setup'}`;
    }),
  );
  const allPresent = (await Promise.all(checks.values())).every(Boolean);
  const rg = (await run('rg', ['--version'], process.cwd())).ok;
  console.log(`${BACKEND}: reachable
models:
  ${modelStatuses.join('\n  ')}
ripgrep: ${rg ? 'present' : 'missing, using the slower built-in search'}`);
  if (!allPresent) process.exit(2);
}

function setup() {
  if (BACKEND === 'llamacpp') {
    console.log(`Install the managed runtime with:
  node "${fileURLToPath(new URL('./install.mjs', import.meta.url))}" --runtime-only
Or start llama-server with your Hydra Nano GGUF model:
  llama-server -m <path-to-hydra-nano.gguf> --alias hydra-nano:git --host 127.0.0.1 --port 8080 -c 8192
Set HYDRA_BACKEND=llamacpp and HYDRA_MODEL=hydra-nano:git, then run hydra doctor.
HYDRA_LLAMA_URL defaults to http://127.0.0.1:8080 (server root, without /v1).
HYDRA_MODEL sends every head to the one loaded model; this does not create specialist weights.
This command prints instructions only; it does not install, download or launch a server.`);
    return;
  }
  if (BACKEND !== 'ollama') fail(2, `hydra: unknown HYDRA_BACKEND "${BACKEND}"; use ollama or llamacpp`);
  console.log('Ensuring hydra-nano models are installed in Ollama...');
  for (const m of new Set(['git', 'os', 'test', 'read', 'files'].map(modelFor))) {
    const pull = spawnSync('ollama', ['pull', m], { stdio: 'inherit' });
    if (pull.error?.code === 'ENOENT') fail(2, 'hydra: Ollama is not installed. Get it from https://ollama.com/download, then run setup again.');
    if (pull.error || pull.status !== 0) fail(2, `hydra: could not install ${m}`);
  }
}

const [command, ...rest] = process.argv.slice(2);
const commands = {
  ask: () => ask(rest),
  search: () => searchCommand(rest),
  find: () => searchCommand(rest),
  run: () => runCommand(rest),
  test: () => runCommand(rest),
  read: () => readCommand(rest),
  os: () => osCommand(rest),
  stats: showStats,
  doctor,
  setup,
  stop: () => console.log(stopLocal() ? 'Hydra local server stopped.' : 'No managed Hydra server is running.'),
};

try {
  if (!commands[command]) fail(1, USAGE);
  await commands[command]();
} catch (e) {
  if (!(e instanceof Unavailable)) throw e;
  fail(2, `hydra unavailable: ${e.message}`);
}
