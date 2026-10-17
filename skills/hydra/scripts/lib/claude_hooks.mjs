// Claude Code integration: two hooks that make an agent actually use Hydra where it pays.
//   PreToolUse (Bash): a test or build run is turned back with the `hydra run --` command to use instead.
//   SessionStart: a short note tells the agent to ask Hydra about git history before reading it raw.
// The installer registers them in the user's settings.json; `hydra hooks remove` takes them out again.
// Only entries whose command points into skills/hydra/scripts/hooks/ are ever touched.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OURS = /[\\/]skills[\\/]hydra[\\/]scripts[\\/]hooks[\\/]/;

// Test and build runners, matched against one simple command with any VAR=value prefix removed.
const RUNNERS = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:test|t)\b/,
  /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build)(?:[:\w-]*)\b/,
  /^(?:npx|pnpx|bunx)\s+(?:jest|vitest|mocha|tsc|playwright\s+test)\b/,
  /^(?:jest|vitest|mocha|tsc)\b/,
  /^(?:(?:uv|poetry|pipenv)\s+run\s+)?(?:\S*\/)?pytest\b/,
  /^(?:(?:uv|poetry|pipenv)\s+run\s+)?(?:\S*\/)?python3?(?:\.\d+)?\s+-m\s+(?:pytest|unittest)\b/,
  /^node\s+--test\b/,
  /^cargo\s+(?:test|build|nextest)\b/,
  /^go\s+(?:test|build|vet)\b/,
  /^(?:\.\/gradlew|gradle)\s+(?:\S+\s+)*?(?:\S*:)?(?:test|build|check)\b/,
  /^mvn\s+(?:\S+\s+)*?(?:test|verify|package)\b/,
  /^dotnet\s+(?:test|build)\b/,
  /^make\s+(?:test|check)\b/,
];

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export const settingsFile = () => path.join(claudeDir(), 'settings.json');

/** The simple commands of a shell line: split on &&, ||, ;, | and newlines outside quotes, so a
 * quoted grep pattern such as "test\|pytest" is never mistaken for a command of its own. A heredoc
 * body (<<EOF ... EOF) is data, not commands, and is skipped whole. With pipes false, a pipeline
 * (a | b) stays one piece. */
export function simpleCommands(command, { pipes = true } = {}) {
  const parts = [];
  let current = '';
  let quote = null;
  const heredocs = [];
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const heredoc = !quote && c === '<' && command[i + 1] === '<' && command[i + 2] !== '<'
      && /^<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(command.slice(i));
    if (heredoc) {
      heredocs.push(heredoc[2]);
      current += heredoc[0];
      i += heredoc[0].length - 1;
      continue;
    }
    if (!quote && c === '\n' && heredocs.length) {
      parts.push(current);
      current = '';
      // Skip each body up to the line that holds only its delimiter.
      for (const delimiter of heredocs.splice(0)) {
        const end = command.slice(i + 1).split('\n').findIndex(line => line.trim() === delimiter);
        if (end < 0) return parts.map(part => part.trim()).filter(Boolean);
        i += command.slice(i + 1).split('\n').slice(0, end + 1).join('\n').length + 1;
      }
      continue;
    }
    if (quote) {
      if (quote === '"' && c === '\\') { current += c + (command[++i] ?? ''); continue; }
      if (c === quote) quote = null;
      current += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === '\\') {
      current += c + (command[++i] ?? '');
    } else if ((c === '&' || c === '|') && command[i + 1] === c) {
      parts.push(current);
      current = '';
      i++;
    } else if (c === '|' && !pipes) {
      current += c;
    } else if (c === ';' || c === '|' || c === '\n') {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean);
}

const ownRun = command => /hydra(?:\.mjs)?"?\s+(?:run|test)\b/.test(command);

// A later pipeline stage that keeps at most this many lines leaves little for Hydra to save.
const FEW_LINES = 40;

/** A pipeline stage that cuts its input to a few lines or a count: tail/head of at most FEW_LINES
 * lines (10 when not given), grep -c, or wc. tail -f and tail -n +N can return everything. */
function cutsShort(stage) {
  const [name, ...args] = stage.split(/\s+/);
  if (name === 'wc') return true;
  if (name === 'grep' || name === 'rg') return args.some(arg => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg) || arg === '--count');
  if (name !== 'tail' && name !== 'head') return false;
  let lines = 10;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (/^-[a-zA-Z]*[fF]/.test(arg) || arg.startsWith('--follow')) return false;
    const value = /^-\d+$/.test(arg) ? arg.slice(1) : arg === '-n' || arg === '--lines' ? args[++i]
      : /^-n./.test(arg) ? arg.slice(2) : arg.startsWith('--lines=') ? arg.slice(8) : null;
    if (value === null) continue;
    if (!/^\d+$/.test(value ?? '')) return false;
    lines = Number(value);
  }
  return lines <= FEW_LINES;
}

/** Each test/build run in a shell line, and whether its own pipeline cuts the output short. */
function runsIn(command) {
  return simpleCommands(command, { pipes: false }).flatMap(pipeline => {
    const stages = simpleCommands(pipeline).map(part => part.replace(/^(?:\w+=\S*\s+)+/, ''));
    const at = stages.findIndex(part => RUNNERS.some(re => re.test(part)));
    return at < 0 ? [] : [{ run: stages[at].replace(/\s+2>&1\s*$/, ''), cut: stages.slice(at + 1).some(cutsShort) }];
  });
}

const passesAnyway = command => !command || ownRun(command) || /\bHYDRA_RAW=1\b/.test(command);

/** The test/build run inside a shell command that would put its whole log in context, or null.
 * Hydra's own runs, HYDRA_RAW=1 and runs already cut to a few lines (| tail -n 15) pass. */
export function testRun(command) {
  if (passesAnyway(command)) return null;
  return runsIn(command).find(run => !run.cut)?.run ?? null;
}

/** A command whose every test/build run is already cut to a few lines by its own pipeline. */
export function trimmedRun(command) {
  if (passesAnyway(command)) return false;
  const runs = runsIn(command);
  return runs.length > 0 && runs.every(run => run.cut);
}

/** A test/build run let through by HYDRA_RAW=1: the agent wanted more than Hydra's digest. */
export function rawBypass(command) {
  return Boolean(command) && /\bHYDRA_RAW=1\b/.test(command) && !ownRun(command)
    && runsIn(command.replace(/\bHYDRA_RAW=1\s+/g, '')).length > 0;
}

function load(file) {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  let value;
  try { value = JSON.parse(text); } catch { value = null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} is not valid JSON, so Hydra left it unchanged. Fix it and run "hydra hooks install", or skip hooks.`);
  }
  return value;
}

function withoutOurs(settings) {
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    const kept = groups.map(group => ({ ...group, hooks: (group.hooks ?? []).filter(hook => !OURS.test(hook.command ?? '')) }))
      .filter(group => group.hooks.length);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  return settings;
}

function save(file, settings) {
  mkdirSync(path.dirname(file), { recursive: true });
  // Keep the user's settings as they were before Hydra first touched them.
  if (existsSync(file) && !existsSync(`${file}.before-hydra`)) copyFileSync(file, `${file}.before-hydra`);
  writeFileSync(`${file}.hydra-tmp`, JSON.stringify(settings, null, 2) + '\n');
  renameSync(`${file}.hydra-tmp`, file);
}

/** Register both hooks for the Hydra scripts directory `scripts`; re-running replaces, never duplicates. */
export function installHooks(scripts, file = settingsFile()) {
  const settings = withoutOurs(load(file));
  const command = name => `node "${path.join(scripts, 'hooks', name)}"`;
  settings.hooks ??= {};
  (settings.hooks.PreToolUse ??= []).push({ matcher: 'Bash', hooks: [{ type: 'command', command: command('route-tests.mjs'), timeout: 10 }] });
  (settings.hooks.SessionStart ??= []).push({ hooks: [{ type: 'command', command: command('session-guide.mjs'), timeout: 10 }] });
  save(file, settings);
  return file;
}

export function removeHooks(file = settingsFile()) {
  if (!existsSync(file)) return false;
  const settings = load(file);
  const before = JSON.stringify(settings);
  withoutOurs(settings);
  if (JSON.stringify(settings) === before) return false;
  save(file, settings);
  return true;
}

export function hookStatus(file = settingsFile()) {
  const settings = existsSync(file) ? load(file) : {};
  return Object.entries(settings.hooks ?? {}).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [])
    .flatMap(group => (group.hooks ?? []).filter(hook => OURS.test(hook.command ?? '')).map(hook => `${event}: ${hook.command}`)));
}
