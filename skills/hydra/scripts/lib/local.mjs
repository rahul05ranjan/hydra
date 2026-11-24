import { readFileSync, readlinkSync, existsSync, mkdirSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

export const home = () => path.resolve(process.env.HYDRA_HOME || path.join(os.homedir(), '.hydra'));
export function localConfig() {
  const file = path.join(home(), 'config.json');
  if (!existsSync(file)) return {};
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value.version !== 1) throw new Error('Unsupported Hydra config version; rerun hydra-install');
  return value;
}

// Start only the managed local installation, never an arbitrary configured endpoint.
let starting;
export function ensureLocal(config) {
  starting ??= startLocal(config).catch(error => { starting = undefined; throw error; });
  return starting;
}
async function healthy(url, model) {
  try {
    if (!(await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })).ok) return false;
    const res = await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(1000) });
    return res.ok && (await res.json()).data?.some(item => item.id === model && item.meta !== null);
  }
  catch { return false; }
}
/** The path of the program a process runs, or undefined when it cannot be read. */
function executableOf(pid) {
  try {
    if (process.platform === 'win32') return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ExecutablePath`], { encoding: 'utf8', windowsHide: true }).trim() || undefined;
    if (process.platform === 'linux') return readlinkSync(`/proc/${pid}/exe`);
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim() || undefined;
  } catch { return undefined; }
}
const sameFile = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Any local user can bind 127.0.0.1:11435 first and answer as hydra-nano:git, so a listener counts as
 * Hydra's only while server.pid names a live process of this user that runs config.server. */
export function ownServer(config, name = 'server') {
  const file = path.join(home(), `${name}.pid`);
  if (!existsSync(file)) return false;
  const pid = Number(readFileSync(file, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch { return false; } // gone, or another user's process (EPERM)
  const executable = executableOf(pid);
  return Boolean(executable) && sameFile(executable, config.server);
}

// The chat model's server. The embedding server (below) is the same program on its own port and files.
const CHAT = (config) => ({
  name: 'server', port: 11435, alias: config.model, modelPath: config.modelPath, missing: 'Hydra runtime or GGUF missing; rerun hydra-install',
  args: ['-c', '8192', '-np', '1'],
});

async function startLocal(config) {
  if (config.url !== 'http://127.0.0.1:11435') throw new Error('Managed Hydra server must use http://127.0.0.1:11435');
  return startServer(config, CHAT(config));
}

// EmbeddingGemma 2 for `hydra recall` and `hydra search --meaning`: opt-in (`hydra embed install`),
// pinned in runtime-manifest.json, served by the managed llama-server on 127.0.0.1:11436.
export const EMBED_PORT = 11436;
export const EMBED_ALIAS = 'hydra-embed';
export const embedModelPath = (sha256) => path.join(home(), 'models', `${sha256}.gguf`);
const EMBED = (config, modelPath) => ({
  name: 'embed', port: EMBED_PORT, alias: EMBED_ALIAS, modelPath, missing: 'EmbeddingGemma 2 is not installed; run `hydra embed install` (downloads about 310 MB)',
  // One 40-line chunk fits a sequence; a batch of 32 shares the context. Mean pooling per the model's config.
  args: ['--embedding', '--pooling', 'mean', '-c', '16384', '-b', '8192', '-ub', '8192', '-np', '4'],
});
let embedStarting;
export function ensureEmbed(config, modelPath) {
  if (!config.managed || !config.server) return Promise.reject(new Error('No managed Hydra runtime; run hydra-install first'));
  embedStarting ??= startServer(config, EMBED(config, modelPath)).catch(error => { embedStarting = undefined; throw error; });
  return embedStarting;
}
export function stopEmbed(config = localConfig()) { return stopServer(config, 'embed'); }

async function startServer(config, spec) {
  const url = `http://127.0.0.1:${spec.port}`;
  const notOurs = () => new Error(`127.0.0.1:${spec.port} answers, but not from the llama-server Hydra started (~/.hydra/${spec.name}.pid); stop that process and retry`);
  if (await healthy(url, spec.alias)) {
    if (ownServer(config, spec.name)) return;
    throw notOurs();
  }
  if (!existsSync(config.server) || !existsSync(spec.modelPath)) throw new Error(spec.missing);
  mkdirSync(home(), { recursive: true });
  const lock = path.join(home(), `${spec.name}.lock`);
  let ownsLock = false;
  try {
    const fd = openSync(lock, 'wx');
    writeFileSync(fd, String(process.pid)); closeSync(fd); ownsLock = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = Number(readFileSync(lock, 'utf8'));
    try { process.kill(owner, 0); }
    catch (error) {
      if (error.code !== 'ESRCH') throw error;
      unlinkSync(lock);
      return startServer(config, spec);
    }
  }
  let child;
  try {
    if (ownsLock) {
      const log = openSync(path.join(home(), `${spec.name}.log`), 'a');
      // No slot monitor (it can echo prompts), no web UI, and CORS only for localhost pages: Hydra's own
      // client is Node and needs none of them, while any web page could otherwise call this port.
      child = spawn(config.server, ['-m', spec.modelPath, '--alias', spec.alias, '--host', '127.0.0.1', '--port', String(spec.port), ...spec.args,
        '--no-slots', '--no-webui', '--cors-origins', 'localhost'], {
        detached: true, windowsHide: true, stdio: ['ignore', log, log],
      });
      closeSync(log);
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      writeFileSync(path.join(home(), `${spec.name}.pid`), String(child.pid));
      child.unref();
    }
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (await healthy(url, spec.alias)) {
        if (ownServer(config, spec.name)) return;
        throw notOurs();
      }
      if (child && child.exitCode !== null) throw new Error(`llama-server exited; inspect ~/.hydra/${spec.name}.log`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`llama-server did not become ready within 120s; inspect ~/.hydra/${spec.name}.log`);
  } catch (error) {
    if (child?.pid) { try { child.kill(); } catch {} }
    throw error;
  } finally { if (ownsLock && existsSync(lock)) unlinkSync(lock); }
}

function stopServer(config, name) {
  const file = path.join(home(), `${name}.pid`);
  if (!config.managed || !existsSync(file)) return false;
  const pid = Number(readFileSync(file, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid managed server PID');
  const executable = executableOf(pid);
  if (!executable) return false;
  if (!sameFile(executable, config.server)) throw new Error('Recorded PID belongs to another executable; refusing to stop it');
  process.kill(pid);
  unlinkSync(file);
  if (name === 'server') starting = undefined; else embedStarting = undefined;
  return true;
}

export function stopLocal(config = localConfig()) { return stopServer(config, 'server'); }
