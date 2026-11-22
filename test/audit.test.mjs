import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/hydra/scripts/hydra.mjs');

/** Every file under a folder with its mtime, to prove the audit writes nothing. */
const snapshot = dir => readdirSync(dir, { recursive: true }).sort().map(name => `${name}:${statSync(path.join(dir, name)).mtimeMs}`);

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hydra-audit-'));
  const put = (file, text, mode = 0o644) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); chmodSync(path.join(root, file), mode); };
  put('.codex/config.toml', 'model = "gpt-5"\n\n# >>> hydra (managed by Hydra; remove with: hydra agents remove codex) >>>\n[mcp_servers.hydra]\ncommand = "node"\nargs = ["/x/.hydra/scripts/mcp.mjs"]\n# <<< hydra <<<\n', 0o644);
  put('.codex/config.toml.before-hydra', 'model = "gpt-5"\n', 0o600);
  put('.hydra/ledger.jsonl', `${JSON.stringify({ v: 2, kind: 'call', head: 'test', agent: 'opencode', ts: '2026-10-24T09:10:00.000Z', raw: 10, returned: 2 })}\n`, 0o600);
  put('.hydra/config.json', JSON.stringify({ version: 1, backend: 'llamacpp', managed: true, url: 'http://127.0.0.1:11435', model: 'hydra-nano:git' }));
  return root;
}

const run = (root, env = {}) => spawnSync(process.execPath, [CLI, 'audit', '--json'], { encoding: 'utf8',
  env: { ...process.env, HYDRA_HOME: path.join(root, '.hydra'), HYDRA_TOOLS_HOME: root, CLAUDE_CONFIG_DIR: path.join(root, '.claude'), HYDRA_TELEMETRY: '0', ...env } });

test('hydra audit lists what Hydra touched, warns about a widened Codex config, and writes nothing', () => {
  const root = fixture();
  const before = snapshot(root);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const codex = report.files.find(f => f.tool === 'codex' && f.part === 'mcp');
  assert.equal(codex.mode, '644');
  assert.equal(codex.hydra, true);
  assert.match(codex.backup, /config\.toml\.before-hydra$/);
  assert.ok(report.warnings.some(w => /config\.toml is 644, but its original was 600/.test(w)), report.warnings.join('\n'));
  assert.equal(report.usage.opencode.calls, 1);
  assert.equal(report.server.loopback, true);
  assert.equal(report.telemetry.leavesMachine, false);
  assert.ok(report.network.every(n => n.to.length));
  assert.deepEqual(snapshot(root), before, 'the audit must not write');
});

test('hydra audit warns when the model server is not on this machine', () => {
  const report = JSON.parse(run(fixture(), { HYDRA_LLAMA_URL: 'http://gpu-box.example:8080' }).stdout);
  assert.equal(report.server.loopback, false);
  assert.ok(report.warnings.some(w => /gpu-box\.example:8080 is not this machine/.test(w)));
});

test('hydra audit prints a readable report', () => {
  const result = spawnSync(process.execPath, [CLI, 'audit'], { encoding: 'utf8',
    env: { ...process.env, HYDRA_HOME: path.join(fixture(), '.hydra'), HYDRA_TELEMETRY: '0' } });
  assert.equal(result.status, 0, result.stderr);
  for (const heading of ['Files Hydra registered itself in', 'Model server:', 'Network:', 'Telemetry:', 'What the MCP server can do:']) assert.ok(result.stdout.includes(heading), heading);
});
