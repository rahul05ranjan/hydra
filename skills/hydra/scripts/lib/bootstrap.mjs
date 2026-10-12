import { createReadStream, createWriteStream, existsSync, realpathSync, mkdirSync, readdirSync, statSync, renameSync, chmodSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { home, localConfig, stopLocal } from './local.mjs';

export function findNpx(dirs = [path.dirname(process.execPath), ...(process.env.PATH || '').split(path.delimiter)]) {
  for (const dir of dirs) {
    for (const relative of ['node_modules/npm/bin/npx-cli.js', '../lib/node_modules/npm/bin/npx-cli.js', '../share/nodejs/npm/bin/npx-cli.js', 'npx']) {
      const file = path.resolve(dir, relative);
      if (existsSync(file)) {
        const resolved = realpathSync(file);
        if (resolved.endsWith('npx-cli.js')) return resolved;
      }
    }
  }
}

export function platformArtifact(platform = process.platform, arch = process.arch) {
  const prefix = { win32: 'win-cpu', darwin: 'macos', linux: 'ubuntu' }[platform];
  if (!prefix || !['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported platform ${platform}/${arch}; install llama-server manually`);
  return `${prefix}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
}
export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function download(artifact, target) {
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size <= 0) throw new Error('Invalid artifact manifest');
  if (existsSync(target) && statSync(target).size === artifact.size && await sha256(target) === artifact.sha256) return;
  mkdirSync(path.dirname(target), { recursive: true });
  const response = await fetch(artifact.url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} (${artifact.url})`);
  const partial = target + '.part';
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  if (statSync(partial).size !== artifact.size || await sha256(partial) !== artifact.sha256) throw new Error('Artifact size/SHA-256 mismatch; installation stopped');
  renameSync(partial, target);
}
function findServer(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { const found = findServer(file); if (found) return found; }
    else if (entry.name === (process.platform === 'win32' ? 'llama-server.exe' : 'llama-server')) return file;
  }
}
export async function installRuntime(manifest) {
  if (!manifest.model) throw new Error('No published GGUF configured; model publication is required before installation');
  const key = platformArtifact();
  const artifact = manifest.llama.artifacts[key];
  if (!artifact) throw new Error(`No runtime artifact for ${key}`);
  const archive = path.join(home(), 'downloads', path.basename(new URL(artifact.url).pathname));
  console.log(`Downloading/verifying llama.cpp ${manifest.llama.tag} (${artifact.size} bytes)...`);
  await download(artifact, archive);
  // Release Windows executable locks and avoid reusing the previous model alias.
  const previous = localConfig();
  if (previous.managed) stopLocal(previous);
  const dest = path.join(home(), 'runtime', `${manifest.llama.tag}-${process.platform}-${process.arch}`);
  mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(dest)} -Force`], { windowsHide: true, stdio: 'inherit' });
  } else execFileSync('tar', ['-xzf', archive, '-C', dest], { stdio: 'inherit' });
  const server = findServer(dest);
  if (!server) throw new Error('Runtime archive did not contain llama-server');
  if (process.platform !== 'win32') chmodSync(server, 0o755);
  const modelPath = path.join(home(), 'models', manifest.model.sha256 + '.gguf');
  console.log(`Downloading/verifying Hydra Nano Git GGUF (${manifest.model.size} bytes)...`);
  await download(manifest.model, modelPath);
  const config = { version: 1, backend: 'llamacpp', managed: true, url: 'http://127.0.0.1:11435', server, modelPath, model: 'hydra-nano:git' };
  const temp = path.join(home(), 'config.json.tmp');
  writeFileSync(temp, JSON.stringify(config, null, 2) + '\n');
  renameSync(temp, path.join(home(), 'config.json'));
  return config;
}
