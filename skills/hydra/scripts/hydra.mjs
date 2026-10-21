#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer } from './lib/answer.mjs';
import { run } from './lib/exec.mjs';
import * as files from './lib/files.mjs';
import * as git from './lib/git.mjs';
import * as test_logs from './lib/test_logs.mjs';
import * as read from './lib/read.mjs';
import * as osHead from './lib/os.mjs';
import { findings, metered, record, stats, tokens } from './lib/ledger.mjs';
import { chat, hasModel, BACKEND, modelFor, Unavailable } from './lib/runtime.mjs';
import { route } from './lib/route.mjs';
import { stopLocal } from './lib/local.mjs';
import { hookStatus, installHooks, removeHooks } from './lib/claude_hooks.mjs';
import * as integrations from './lib/integrations.mjs';
import * as refactor from './lib/refactor.mjs';

const HEADS = { git, files, test: test_logs, read, os: osHead };

const USAGE = `usage:
  hydra ask "<question>" [--head git|files|test|read|os] answer a question about the repo or system
  hydra search <term...>                               search codebase with definition ranking
  hydra read <file> [symbol|--lines <start-end>]       slice a file, symbol, or show outline
  hydra smell [file|dir|--diff|--staged]               detect Refactoring.Guru code smells & anti-patterns
  hydra refactor <file> [symbol|--lines <start-end>]   step-by-step refactoring recipe for a function or range
  hydra design [pattern|query] [--file <file>]         GoF design pattern advisor & architecture guide
  hydra run [--head test] -- <command...>              run a command and digest test/build output
  hydra os [question...]                               inspect ports, processes, disk, system
  hydra stats                                          token accounting for past calls
  hydra improve [--since <date>] [--json]              what the local telemetry says to improve
  hydra doctor                                         check that the local model is ready
  hydra setup                                          show runtime setup instructions
  hydra stop                                           stop Hydra's managed llama-server
  hydra hooks install|remove|status                    Claude Code hooks that route tests and git questions here
  hydra agents install|remove|status [tool...]         Hydra's MCP server and hooks in codex, cursor, opencode,
                                                       gemini-cli, antigravity and antigravity-ide (default: every tool found)
  hydra mcp                                            run the MCP server on stdio`;

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

// The footer reports a saving; when there is none (short output passed through whole) it is pure cost.
function withFooter(text, head, raw, returned, seconds) {
  return returned < raw ? `${text}\n\n[hydra ${head} · read ~${raw} tok locally, returned ~${returned} tok · ${seconds}s]` : text;
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
  const meter = metered(opts => chat({ ...opts, model: modelFor(head) }));
  const sections = await HEADS[head].gather(question, cwd, meter.chat);
  const { text, rawChars } = await answer(question, sections, meter.chat);
  const raw = tokens(rawChars);
  const returned = tokens(text.length);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));

  record({ ts: new Date().toISOString(), head, question, raw, returned, seconds, modelCalls: meter.modelCalls, modelSeconds: meter.modelSeconds });
  console.log(withFooter(text, head, raw, returned, seconds));
}

async function runCommand(args) {
  const doubleDash = args.indexOf('--');
  let cmdArgs = doubleDash >= 0 ? args.slice(doubleDash + 1) : args;

  if (cmdArgs.length === 0) {
    if (!process.stdin.isTTY) {
      const stdinData = readFileSync(0, 'utf8');
      if (stdinData.trim()) {
        const started = Date.now();
        const meter = metered(opts => chat({ ...opts, model: modelFor('test') }));
        const { text, rawChars, exitCode } = await test_logs.digest({ cmd: 'pipe', out: stdinData, exitCode: 1 }, meter.chat);
        const raw = tokens(rawChars);
        const returned = tokens(text.length);
        const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
        record({ ts: new Date().toISOString(), head: 'test', question: 'pipe', raw, returned, seconds, modelCalls: meter.modelCalls, modelSeconds: meter.modelSeconds });
        console.log(withFooter(text, 'test', raw, returned, seconds));
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
  const commandSeconds = Number(((Date.now() - started) / 1000).toFixed(1));
  const meter = metered(opts => chat({ ...opts, model: modelFor('test') }));
  const { text, rawChars, exitCode } = await test_logs.digest({
    cmd: cmdArgs.join(' '),
    out: res.out,
    err: res.err,
    exitCode: res.exitCode,
  }, meter.chat);
  const raw = tokens(rawChars);
  const returned = tokens(text.length);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  record({ ts: new Date().toISOString(), head: 'test', question: cmdArgs.join(' '), raw, returned, seconds,
    commandSeconds, exit: exitCode, modelCalls: meter.modelCalls, modelSeconds: meter.modelSeconds });
  console.log(withFooter(text, 'test', raw, returned, seconds));
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

  console.log(withFooter(res.text, 'read', raw, returned, seconds));
}

async function osCommand(args) {
  const question = args.join(' ').trim() || 'system overview';
  const started = Date.now();
  const meter = metered(opts => chat({ ...opts, model: modelFor('os') }));
  const sections = await osHead.gather(question, process.cwd(), meter.chat);
  const { text, rawChars } = await answer(question, sections, meter.chat);
  const raw = tokens(rawChars);
  const returned = tokens(text.length);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));

  record({ ts: new Date().toISOString(), head: 'os', question, raw, returned, seconds, modelCalls: meter.modelCalls, modelSeconds: meter.modelSeconds });
  console.log(withFooter(text, 'os', raw, returned, seconds));
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

  console.log(withFooter(text, 'files', raw, returned, seconds));
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

function improve(args) {
  const flag = args.indexOf('--since');
  const since = flag >= 0 ? args[flag + 1] : undefined;
  if (flag >= 0 && (!since || Number.isNaN(Date.parse(since)))) fail(1, 'usage: hydra improve [--since <date>] [--json]');
  const report = findings(undefined, { since: since && new Date(since).toISOString() });
  if (args.includes('--json')) return console.log(JSON.stringify(report, null, 2));
  const lines = [`since ${report.since ?? 'the start'}: ${report.calls} calls; ${report.sessions.usingHydra} of ${report.sessions.seen} recorded sessions used Hydra`];
  for (const [head, h] of Object.entries(report.perHead)) {
    lines.push(`${head.padEnd(6)} ${h.calls} calls, saved ~${h.saved} tok (${Math.round(h.savedShare * 100)}%), ` +
      `${h.costMore} cost more than raw, p50 ${h.p50Seconds}s, p90 ${h.p90Seconds}s, ${h.modelCalls} model calls`);
    for (const row of h.costMoreExamples) lines.push(`         cost more: ${row.question.slice(0, 80)} (${row.raw} -> ${row.returned})`);
  }
  for (const [agent, a] of Object.entries(report.agents)) {
    const apps = Object.entries(a.fromApps ?? {}).map(([app, n]) => `, ${n} from ${app}`).join('');
    lines.push(`agent  ${agent}: ${a.calls} calls (${a.viaMcp} through MCP${apps}), ${a.denials} runs turned back, ${a.sessions} sessions started`);
  }
  const { denials, followedByHydra, trimmed, rawBypasses } = report.hooks;
  const { decisions, p50Ms, p90Ms } = report.hooks;
  lines.push(`hooks  ${decisions} Bash calls checked (p50 ${p50Ms} ms, p90 ${p90Ms} ms); ${denials} test/build runs turned back, ` +
    `${followedByHydra} followed by a Hydra run within 5 minutes; ${trimmed} let through already cut short (| tail -n N)`);
  for (const command of rawBypasses) lines.push(`         HYDRA_RAW=1 bypass (check for a false match): ${command.slice(0, 100)}`);
  for (const error of report.errors) lines.push(`error  ${error.ts} ${error.command}: ${error.error}`);
  console.log(lines.join('\n'));
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

async function smellCommand(args) {
  const isJson = args.includes('--json');
  const isDiff = args.includes('--diff');
  const isStaged = args.includes('--staged');
  const target = args.filter(a => !a.startsWith('--'))[0] || (isDiff || isStaged ? '.' : process.cwd());

  const started = Date.now();
  let text = '';
  let rawChars = 0;

  if (isDiff || isStaged) {
    const gitArgs = ['diff'];
    if (isStaged) gitArgs.push('--staged');
    const diffRes = await run('git', gitArgs, process.cwd());
    const diffOutput = diffRes.out || '';
    rawChars = diffOutput.length;
    const diffReport = refactor.scanDiff(diffOutput);
    if (isJson) {
      text = JSON.stringify(diffReport, null, 2);
    } else {
      if (!diffReport.filesWithSmells) {
        text = '✔ No code smells introduced in this diff.';
      } else {
        text = `[hydra smell] ${diffReport.filesWithSmells} changed files with smells:\n\n` +
          diffReport.reports.map(r => refactor.formatSmellReport(r)).join('\n\n');
      }
    }
  } else {
    const resolved = path.resolve(target);
    if (!existsSync(resolved)) fail(1, `hydra smell: path not found: ${target}`);
    const isDir = statSync(resolved).isDirectory();
    if (isDir) {
      const dirReport = refactor.scanDirectory(resolved);
      rawChars = dirReport.reports.reduce((s, r) => s + r.totalLines * 30, 100);
      if (isJson) {
        text = JSON.stringify(dirReport, null, 2);
      } else {
        if (!dirReport.filesWithSmells) {
          text = `✔ ${target}: No code smells detected across scanned files.`;
        } else {
          text = `[hydra smell] ${dirReport.totalSmells} smells across ${dirReport.filesWithSmells} files in ${target}:\n\n` +
            dirReport.reports.map(r => refactor.formatSmellReport(r)).join('\n\n');
        }
      }
    } else {
      const report = refactor.scanFile(resolved);
      rawChars = report.totalLines * 35;
      text = isJson ? JSON.stringify(report, null, 2) : refactor.formatSmellReport(report);
    }
  }

  const raw = tokens(rawChars);
  const returned = tokens(text.length);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(2));

  record({
    ts: new Date().toISOString(),
    head: 'refactor',
    question: `smell ${args.join(' ')}`,
    raw,
    returned,
    seconds,
  });

  console.log(withFooter(text, 'smell', raw, returned, seconds));
}

async function refactorCommand(args) {
  const isJson = args.includes('--json');
  const cleanArgs = args.filter(a => a !== '--json');
  if (cleanArgs.length === 0) fail(1, 'usage: hydra refactor <file> [symbol|--lines <start-end>]');

  let fileArg = null;
  let symbol = null;
  let lines = null;

  for (let i = 0; i < cleanArgs.length; i++) {
    const arg = cleanArgs[i];
    if (arg === '--lines' && i + 1 < cleanArgs.length) {
      lines = cleanArgs[++i];
    } else if (arg.startsWith('--lines=')) {
      lines = arg.slice('--lines='.length);
    } else if (/^\d+[:-]\d+$/.test(arg)) {
      lines = arg;
    } else if (!fileArg) {
      fileArg = arg;
    } else if (!symbol) {
      symbol = arg;
    }
  }

  if (!fileArg) fail(1, 'usage: hydra refactor <file> [symbol|--lines <start-end>]');
  const resolved = path.resolve(fileArg);
  if (!existsSync(resolved) || statSync(resolved).isDirectory()) {
    fail(1, `hydra refactor: file not found: ${fileArg}`);
  }

  const started = Date.now();
  const content = readFileSync(resolved, 'utf8');

  let startLine, endLine;
  if (lines) {
    const [s, e] = lines.split(/[:-]/).map(Number);
    startLine = s;
    endLine = e;
  }

  const recipe = refactor.generateRecipe(content, { symbol, startLine, endLine });
  const rawChars = content.length;
  const text = isJson ? JSON.stringify(recipe, null, 2) : refactor.formatRecipe(recipe);

  const raw = tokens(rawChars);
  const returned = tokens(text.length);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(2));

  record({
    ts: new Date().toISOString(),
    head: 'refactor',
    question: `refactor ${fileArg}${symbol ? ` ${symbol}` : ''}`,
    raw,
    returned,
    seconds,
  });

  console.log(withFooter(text, 'refactor', raw, returned, seconds));
}

async function designCommand(args) {
  const isJson = args.includes('--json');
  let fileArg = null;
  const words = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') continue;
    if (arg === '--file' && i + 1 < args.length) {
      fileArg = args[++i];
    } else if (arg.startsWith('--file=')) {
      fileArg = arg.slice('--file='.length);
    } else {
      words.push(arg);
    }
  }

  const query = words.join(' ').trim();
  let codeSnippet = '';
  if (fileArg) {
    const resolved = path.resolve(fileArg);
    if (existsSync(resolved) && !statSync(resolved).isDirectory()) {
      codeSnippet = readFileSync(resolved, 'utf8').slice(0, 5000);
    }
  }

  const started = Date.now();
  const adv = refactor.advisePattern(query, codeSnippet);
  const text = isJson ? JSON.stringify(adv, null, 2) : refactor.formatPattern(adv);

  const seconds = Number(((Date.now() - started) / 1000).toFixed(2));

  // A pattern lookup replaces no command output, so it has no raw baseline: it counts as neither a
  // saving nor a cost, and its size is kept apart.
  record({
    ts: new Date().toISOString(),
    head: 'refactor',
    question: `design ${query}`,
    raw: 0,
    returned: 0,
    replyTokens: tokens(text.length),
    seconds,
  });

  console.log(text);
}

const [command, ...rest] = process.argv.slice(2);
const commands = {
  ask: () => ask(rest),
  search: () => searchCommand(rest),
  find: () => searchCommand(rest),
  run: () => runCommand(rest),
  test: () => runCommand(rest),
  read: () => readCommand(rest),
  smell: () => smellCommand(rest),
  refactor: () => refactorCommand(rest),
  design: () => designCommand(rest),
  os: () => osCommand(rest),
  stats: showStats,
  improve: () => improve(rest),
  doctor,
  setup,
  stop: () => console.log(stopLocal() ? 'Hydra local server stopped.' : 'No managed Hydra server is running.'),
  hooks: () => hooksCommand(rest[0]),
  agents: () => agentsCommand(rest),
  mcp: () => import('./mcp.mjs').then(server => server.serve()),
};

function agentsCommand(args) {
  const [action, ...words] = args;
  const ids = words.filter(word => !word.startsWith('--'));
  if (action === 'status') {
    for (const row of integrations.status()) {
      console.log(`${row.id.padEnd(15)} ${row.present ? 'found    ' : 'not found'}  mcp ${row.mcp ? 'yes' : 'no '}${'hooks' in row ? `  hooks ${row.hooks ? 'yes' : 'no'}` : ''}${'skill' in row ? `  skill ${row.skill ? 'yes' : 'no'}` : ''}`);
    }
    console.log(`claude-code     ${hookStatus().length ? 'hooks yes' : 'hooks no'} (skill and hooks; see hydra hooks status)`);
    return;
  }
  if (!['install', 'remove'].includes(action)) fail(1, 'usage: hydra agents install|remove|status [codex cursor opencode gemini-cli antigravity antigravity-ide] [--no-hooks]');
  const scripts = action === 'install'
    ? integrations.installSharedScripts(path.dirname(fileURLToPath(import.meta.url))) : integrations.sharedScripts();
  const targets = ids.length ? ids : action === 'install' ? integrations.detected(scripts) : Object.keys(integrations.tools(scripts));
  if (!targets.length) return console.log('No supported coding tool found (codex, cursor, opencode, gemini-cli, antigravity, antigravity-ide).');
  for (const result of integrations.apply(targets, action, { scripts, hooks: !words.includes('--no-hooks') })) {
    if (result.error) { console.log(`${result.id}: ${result.error}`); continue; }
    console.log(`${result.id}: ${result.changes.length ? result.changes.join('; ') : action === 'install' ? 'nothing changed' : 'nothing to remove'}`);
    for (const message of result.manual) console.log(`  ${message.replace(/\n/g, '\n  ')}`);
    if (result.note) console.log(`  ${result.note}`);
  }
}

function hooksCommand(action) {
  const scripts = path.dirname(fileURLToPath(import.meta.url));
  if (action === 'install') console.log(`Hydra hooks registered in ${installHooks(scripts)}.`);
  else if (action === 'remove') console.log(removeHooks() ? 'Hydra hooks removed.' : 'No Hydra hooks were registered.');
  else if (action === 'status') console.log(hookStatus().join('\n') || 'No Hydra hooks are registered.');
  else fail(1, 'usage: hydra hooks install|remove|status');
}

try {
  if (!commands[command]) fail(1, USAGE);
  await commands[command]();
} catch (e) {
  record({ ts: new Date().toISOString(), kind: 'error', command, error: String(e?.message ?? e).slice(0, 300) });
  if (!(e instanceof Unavailable)) throw e;
  fail(2, `hydra unavailable: ${e.message}`);
}
