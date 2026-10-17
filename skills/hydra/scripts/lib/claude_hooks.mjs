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

/** The test/build run inside a shell command, or null. Hydra's own runs and HYDRA_RAW=1 pass. */
export function testRun(command) {
  if (!command || /hydra(?:\.mjs)?\s+(?:run|test)\b/.test(command) || /\bHYDRA_RAW=1\b/.test(command)) return null;
  const run = command.split(/&&|\|\||;|\|/).map(part => part.trim().replace(/^(?:\w+=\S*\s+)+/, ''))
    .find(part => RUNNERS.some(re => re.test(part)));
  return run ? run.replace(/\s+2>&1\s*$/, '') : null;
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
