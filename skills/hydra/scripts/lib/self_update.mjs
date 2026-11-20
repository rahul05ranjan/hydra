// `hydra self-update`: reinstall Hydra from npm at the newest published version, with the options it was
// installed with. The installer records what it installed in ~/.hydra/installed.json; the only network call here
// is one GET to the npm registry for the latest version, which carries nothing about the user.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { home } from './local.mjs';

export const PACKAGE = 'hydra-nano';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
// Installer options worth replaying; --agent takes one skills CLI agent ID after it.
const FLAGS = new Set(['--runtime-only', '--no-agents', '--no-hooks']);
const AGENT = /^[a-z][a-z0-9-]*$/;

const file = () => path.join(home(), 'installed.json');

export function readInstalled() {
  try {
    const value = JSON.parse(readFileSync(file(), 'utf8'));
    return value && SEMVER.test(value.version) ? value : null;
  } catch {
    return null;
  }
}

/** Written by the installer once an install has finished. */
export function recordInstall(version, args) {
  if (!SEMVER.test(String(version))) return;
  mkdirSync(home(), { recursive: true });
  writeFileSync(file(), `${JSON.stringify({ version, args: replayArgs(args), installedAt: new Date().toISOString() }, null, 2)}\n`);
}

/** The installer options to pass again: the known flags and valid --agent IDs, nothing else. */
export function replayArgs(args = []) {
  const kept = [];
  for (let i = 0; i < args.length; i++) {
    if (FLAGS.has(args[i]) && !kept.includes(args[i])) kept.push(args[i]);
    else if (args[i] === '--agent' && AGENT.test(args[i + 1] ?? '')) kept.push('--agent', args[++i]);
  }
  return kept;
}

/** Negative when a is older than b. A prerelease sorts before its release. */
export function compare(a, b) {
  const [x, y] = [SEMVER.exec(a), SEMVER.exec(b)];
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
  if (x[4] === y[4]) return 0;
  return x[4] === undefined ? 1 : y[4] === undefined ? -1 : x[4] < y[4] ? -1 : 1;
}

/** The latest published version, from the npm registry (HYDRA_REGISTRY overrides it, for tests or a mirror). */
export async function latest(fetchImpl = fetch) {
  const registry = (process.env.HYDRA_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');
  const response = await fetchImpl(`${registry}/${PACKAGE}/latest`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`registry answered HTTP ${response.status}`);
  const { version } = await response.json();
  if (!SEMVER.test(String(version))) throw new Error('registry returned no valid version');
  return version;
}

/** What to do, given the installed and latest versions: 'current', 'update', 'ahead' or 'unknown'. */
export function decide(installed, newest) {
  if (!installed) return 'unknown';
  const order = compare(installed, newest);
  return order < 0 ? 'update' : order > 0 ? 'ahead' : 'current';
}
