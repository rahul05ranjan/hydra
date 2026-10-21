#!/usr/bin/env node
// Hydra as an MCP server (stdio, JSON-RPC 2.0, one message per line), for any coding tool that
// speaks MCP: Codex, Cursor, OpenCode, Gemini CLI, Antigravity and others. Three tools only, where
// Hydra pays: git history, test/build runs and OS inspection. Reading and searching source stay with
// the agent's own tools (forced delegation measured +72% tokens). Each tool runs the Hydra CLI in a
// child process, so heads stay read-only, the model never writes a command, and every call lands in
// the local ledger with the client's name as its agent.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simpleCommands, testRun } from './lib/claude_hooks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'hydra.mjs');
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const RUN_TIMEOUT_MS = 30 * 60_000;

const INSTRUCTIONS = 'Hydra runs noisy read-only commands on a small local model and returns only the lines that matter. '
  + 'Use hydra_git for git history, diff, blame and "what changed" questions instead of reading git log or git diff output. '
  + 'Use hydra_run for test and build commands; it returns failing tests, assertion diffs and locations, or a short pass summary. '
  + 'Keep using your own tools to read and search source files; Hydra does not save tokens there.';

const cwdProperty = { type: 'string', description: 'Absolute path of the repository or project to work in. Defaults to the server\'s working directory.' };
// Clients use these hints to decide which calls need approval; hydra_run runs the project's own test scripts.
const READS = { readOnlyHint: true, openWorldHint: false };
export const TOOLS = [
  { name: 'hydra_git', description: 'Answer a read-only question about this git repository (history, diffs, blame, branches, stashes) and return only the matching lines.',
    inputSchema: { type: 'object', properties: { question: { type: 'string', description: 'The question, in plain words.' }, cwd: cwdProperty }, required: ['question'] }, annotations: READS },
  { name: 'hydra_run', description: 'Run one test or build command (npm test, pytest, cargo test, go test, tsc, and similar) in the project and return its digest. It runs the project\'s own test scripts. Shell operators, paths outside cwd and flags that load other code are refused.',
    inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'One test or build command, for example "npm test" or "pytest -q tests/test_api.py".' }, cwd: cwdProperty }, required: ['command'] },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } },
  { name: 'hydra_os', description: 'Answer a read-only question about this machine (ports, processes, disk, memory, system, environment variables; credential-looking ones are withheld).',
    inputSchema: { type: 'object', properties: { question: { type: 'string', description: 'The question, in plain words.' } }, required: ['question'] }, annotations: READS },
  { name: 'hydra_smell', description: 'Scan a file, directory or git diff for Refactoring.Guru code smells (Long Method, Large Class, Deep Nesting, Long Parameter List, etc.) with exact line numbers and refactoring recipes.',
    inputSchema: { type: 'object', properties: { target: { type: 'string', description: 'File or directory path to scan. Defaults to repository root.' }, diff: { type: 'boolean', description: 'If true, scans newly introduced smells in unstaged/staged git changes.' }, cwd: cwdProperty } }, annotations: READS },
  { name: 'hydra_refactor', description: 'Generate a step-by-step Refactoring.Guru recipe (Extract Method, Guard Clauses, Parameter Object) for a function or line range in a file.',
    inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Path to the file.' }, symbol: { type: 'string', description: 'Function, method or class name.' }, lines: { type: 'string', description: 'Line range like "40-90".' }, cwd: cwdProperty }, required: ['file'] }, annotations: READS },
  { name: 'hydra_design', description: 'Query GoF design patterns from Refactoring.Guru (intent, problem, solution, applicability) or get pattern recommendations for an architectural problem.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Pattern name (e.g. strategy, builder, observer) or architectural problem description.' }, file: { type: 'string', description: 'Optional path to file to analyze for pattern recommendation.' }, cwd: cwdProperty }, required: ['query'] }, annotations: READS },
];

let client = 'mcp-client';

// The repository's package.json when run from a checkout; an installed skill folder has none.
const version = (() => {
  try { return JSON.parse(readFileSync(path.join(HERE, '..', '..', '..', 'package.json'), 'utf8')).version ?? '0'; } catch { return '0'; }
})();

/** Split one command into argv the way a shell would for plain words and quotes, or null when it
 * holds anything a shell would interpret (operators, redirection, expansion, env prefixes). */
export function argvOf(command) {
  if (typeof command !== 'string' || !command.trim() || simpleCommands(command).length !== 1) return null;
  const argv = [];
  let word = null;
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") { if (c === "'") quote = null; else word += c; continue; }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\' && /["\\$`]/.test(command[i + 1] ?? '')) word += command[++i];
      else if (c === '$' || c === '`') return null;
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; word ??= ''; continue; }
    if (/\s/.test(c)) { if (word !== null) argv.push(word); word = null; continue; }
    if (/[;&|<>()$`*?~{}\[\]#!]/.test(c)) return null;
    if (c === '\\') { word = (word ?? '') + (command[++i] ?? ''); continue; }
    word = (word ?? '') + c;
  }
  if (quote) return null;
  if (word !== null) argv.push(word);
  if (!argv.length || /^\w+=/.test(argv[0])) return null;
  return argv;
}

function workdir(cwd) {
  if (cwd === undefined) return process.cwd();
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error('cwd must be the absolute path of an existing directory');
  }
  return cwd;
}

const inside = (root, file) => {
  const rel = path.relative(root, file);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
// A word that names a file: a path separator, a leading dot or tilde. Test names, patterns and globs like ./... are checked too.
const pathLike = word => /[\\/]/.test(word) || /^[.~]/.test(word);

/** The file or directory a path word points to, if it stays inside cwd after ../ and symlinks are resolved. */
function confined(word, cwd) {
  if (word.startsWith('~') || /^[A-Za-z][\w+.-]*:[^:]/.test(word) && /[\\/]/.test(word)) return null;
  const file = path.resolve(cwd, word.split('::')[0]);
  const root = realpathSync(cwd);
  if (!inside(cwd, file) && !inside(root, file)) return null;
  try { return inside(root, realpathSync(file)) ? file : null; } catch { return file; }
}

// Flags that make a runner load or run code named on the command line instead of the project's own tests.
const LOADS_CODE = [
  /^--(?:import|require|loader|experimental-loader|eval|print|env-file(?:-if-exists)?|inspect(?:-brk|-port|-wait)?|experimental-config-file)(?:=|$)/,
  /^-[erp]$/, // node -e/-r/-p; pytest -p is checked on its own below
  /^--(?:script-shell|node-options|userconfig|globalconfig)(?:=|$)/, // npm, pnpm, yarn
  /^--eval(?:=|$)/, // make
  /^--config(?:=|$)/, /^-Z/, // cargo
  /^--?(?:exec|toolexec|vettool|overlay)(?:=|$)/, // go
  /^(?:--init-script(?:=|$)|-I)/, // gradle
];

/** argv for one project test or build command in cwd, or a thrown reason the agent can read. */
export function runArgv(command, cwd) {
  const argv = argvOf(command);
  if (!argv || testRun(command.trim()) !== command.trim()) {
    throw new Error('hydra_run takes one test or build command with no shell operators, redirection or env prefix, such as "npm test" or "pytest -q"');
  }
  const tool = path.basename(argv.find(word => !/^(?:uv|poetry|pipenv|run|-m|python3?(?:\.\d+)?|npx|pnpx|bunx)$/.test(path.basename(word))) ?? argv[0]);
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (i > 0 && word === '--') break; // what follows goes to the test binary as its own arguments
    const [flag, value] = word.startsWith('-') ? [word.split('=')[0], word.includes('=') ? word.slice(word.indexOf('=') + 1) : null] : [null, word];
    if (flag && (tool === 'pytest' ? flag === '-p' && !String(value ?? argv[i + 1]).startsWith('no:') : LOADS_CODE.some(re => re.test(flag)))) {
      throw new Error(`hydra_run refuses ${flag}: it loads code named on the command line`);
    }
    if (tool === 'make' && !flag && /^[A-Za-z_.][\w.]*=/.test(word)) throw new Error(`hydra_run refuses ${word}: a make variable can replace recipe commands`);
    if (value !== null && pathLike(value) && !confined(value, cwd)) throw new Error(`hydra_run takes paths inside cwd only: ${value}`);
  }
  return argv;
}

const SOURCE = /\.(?:[cm]?js|jsx|tsx?|py|go|rs|java|cpp|c|h|cs)$/i;

/** A file or directory argument confined to cwd: no hidden path segment, a source extension for files. */
function projectPath(word, cwd, name) {
  const refuse = () => { throw new Error(`${name} must be a source file or directory inside cwd`); };
  if (typeof word !== 'string' || !word.trim() || word.startsWith('-')) refuse();
  const file = confined(word, cwd);
  if (!file || !existsSync(file)) refuse();
  if (path.relative(realpathSync(cwd), realpathSync(file)).split(path.sep).some(part => part.startsWith('.'))) refuse();
  if (!statSync(file).isDirectory() && !SOURCE.test(file)) refuse();
  return realpathSync(file);
}

function hydra(args, cwd) {
  return new Promise(resolve => {
    execFile(process.execPath, [CLI, ...args], {
      cwd, timeout: RUN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, HYDRA_AGENT: client, HYDRA_VIA: 'mcp' },
    }, (error, stdout, stderr) => {
      const unavailable = /hydra unavailable:|hydra: /.test(stderr) && !stdout.trim();
      resolve({ text: (stdout || stderr || String(error?.message ?? '')).trim(), isError: Boolean(unavailable || (error && !stdout.trim())) });
    });
  });
}

export async function callTool(name, args = {}) {
  if (name === 'hydra_git') {
    if (typeof args.question !== 'string' || !args.question.trim()) throw new Error('question is required');
    return hydra(['ask', '--head', 'git', args.question], workdir(args.cwd));
  }
  if (name === 'hydra_os') {
    if (typeof args.question !== 'string' || !args.question.trim()) throw new Error('question is required');
    return hydra(['os', args.question], process.cwd());
  }
  if (name === 'hydra_run') {
    const cwd = workdir(args.cwd);
    if (typeof args.command !== 'string') throw new Error('command is required');
    return hydra(['run', '--', ...runArgv(args.command, cwd)], cwd);
  }
  // The agent picks both cwd and the file, so a file must be project source under cwd, never a dotfile or a key.
  if (name === 'hydra_smell') {
    const cwd = workdir(args.cwd);
    const cliArgs = ['smell'];
    if (args.diff) cliArgs.push('--diff');
    if (args.target !== undefined) cliArgs.push(projectPath(args.target, cwd, 'target'));
    return hydra(cliArgs, cwd);
  }
  if (name === 'hydra_refactor') {
    if (typeof args.file !== 'string' || !args.file.trim()) throw new Error('file is required');
    const cwd = workdir(args.cwd);
    const cliArgs = ['refactor', projectPath(args.file, cwd, 'file')];
    if (args.symbol) cliArgs.push(String(args.symbol));
    if (args.lines) cliArgs.push('--lines', String(args.lines));
    return hydra(cliArgs, cwd);
  }
  if (name === 'hydra_design') {
    if (typeof args.query !== 'string' || !args.query.trim()) throw new Error('query is required');
    const cwd = workdir(args.cwd);
    const cliArgs = ['design', args.query];
    if (args.file !== undefined) cliArgs.push('--file', projectPath(args.file, cwd, 'file'));
    return hydra(cliArgs, cwd);
  }
  throw new Error(`Unknown tool: ${name}`);
}

export async function handle(message) {
  const { id, method, params = {} } = message ?? {};
  const reply = result => ({ jsonrpc: '2.0', id, result });
  const failure = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
  if (id === undefined || id === null) return null; // A notification: nothing to answer.
  if (method === 'initialize') {
    client = String(params.clientInfo?.name ?? client).slice(0, 80);
    const protocolVersion = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0];
    return reply({ protocolVersion, capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'hydra', version }, instructions: INSTRUCTIONS });
  }
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools: TOOLS });
  if (method === 'tools/call') {
    try {
      const { text, isError } = await callTool(params.name, params.arguments ?? {});
      return reply({ content: [{ type: 'text', text }], isError });
    } catch (error) {
      // A bad argument is a tool result the agent can read and correct, not a protocol error.
      return reply({ content: [{ type: 'text', text: `hydra: ${error.message}` }], isError: true });
    }
  }
  return failure(-32601, `Method not found: ${method}`);
}

export function serve() {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        continue;
      }
      handle(message).then(answer => { if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`); });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serve();
