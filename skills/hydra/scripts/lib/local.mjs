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
async function startLocal(config) {
  const url = 'http://127.0.0.1:11435';
  if (config.url !== url) throw new Error('Managed Hydra server must use http://127.0.0.1:11435');
  if (await healthy(url, config.model)) return;
  if (!existsSync(config.server) || !existsSync(config.modelPath)) throw new Error('Hydra runtime or GGUF missing; rerun hydra-install');
  mkdirSync(home(), { recursive: true });
  const lock = path.join(home(), 'server.lock');
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
      return startLocal(config);
    }
  }
  let child;
  try {
    if (ownsLock) {
      const log = openSync(path.join(home(), 'server.log'), 'a');
      child = spawn(config.server, ['-m', config.modelPath, '--alias', config.model, '--host', '127.0.0.1', '--port', '11435', '-c', '8192', '-np', '1'], {
        detached: true, windowsHide: true, stdio: ['ignore', log, log],
      });
      closeSync(log);
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      writeFileSync(path.join(home(), 'server.pid'), String(child.pid));
      child.unref();
    }
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (await healthy(url, config.model)) return;
      if (child && child.exitCode !== null) throw new Error('llama-server exited; inspect ~/.hydra/server.log');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('llama-server did not become ready within 120s; inspect ~/.hydra/server.log');
  } catch (error) {
    if (child?.pid) { try { child.kill(); } catch {} }
    throw error;
  } finally { if (ownsLock && existsSync(lock)) unlinkSync(lock); }
}

export function stopLocal(config = localConfig()) {
  const file = path.join(home(), 'server.pid');
  if (!config.managed || !existsSync(file)) return false;
  const pid = Number(readFileSync(file, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid managed server PID');
  let executable;
  try {
    if (process.platform === 'win32') executable = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ExecutablePath`], { encoding: 'utf8', windowsHide: true }).trim();
    else if (process.platform === 'linux') executable = readlinkSync(`/proc/${pid}/exe`);
    else executable = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim();
  } catch { return false; }
  if (!executable) return false;
  if (path.resolve(executable).toLowerCase() !== path.resolve(config.server).toLowerCase()) throw new Error('Recorded PID belongs to another executable; refusing to stop it');
  process.kill(pid);
  unlinkSync(file);
  starting = undefined;
  return true;
}
