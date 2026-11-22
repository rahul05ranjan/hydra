// `hydra audit`: everything Hydra has put on this machine and everything it can do, in one read-only report a
// reviewer can keep. It reads files only: no network call, no model call, nothing written.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeDir, hookStatus, settingsFile } from './claude_hooks.mjs';
import * as integrations from './integrations.mjs';
import { rows, usageByTool } from './ledger.mjs';
import { home, localConfig } from './local.mjs';
import { currentVersion, readInstalled } from './self_update.mjs';

const MANIFEST = fileURLToPath(new URL('../runtime-manifest.json', import.meta.url));

const mode = file => { try { return (statSync(file).mode & 0o777).toString(8).padStart(3, '0'); } catch { return null; } };
const backupOf = file => (existsSync(`${file}.before-hydra`) ? `${file}.before-hydra` : null);
const loopback = url => { try { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname); } catch { return false; } };

/** The managed server's process, if the pid file names a live one. */
function serverPid() {
  try {
    const pid = Number(readFileSync(path.join(home(), 'server.pid'), 'utf8'));
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function audit() {
  const config = (() => { try { return localConfig(); } catch { return {}; } })();
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const installHosts = [...new Set(JSON.stringify(manifest).match(/https:\/\/[a-zA-Z0-9.-]+/g) ?? [])].map(url => url.slice(8)).sort();
  const usage = usageByTool();

  // Every file Hydra registers itself in, per tool, whether Hydra's entry is there now, its mode and its backup.
  const files = [];
  for (const [id, tool] of Object.entries(integrations.tools())) {
    for (const [part, spec] of Object.entries(tool.parts)) {
      if (!existsSync(tool.dir) && !existsSync(spec.file)) continue;
      files.push({ tool: id, part, file: spec.file, exists: existsSync(spec.file), hydra: Boolean(spec.status()), mode: mode(spec.file), backup: backupOf(spec.file) });
    }
  }
  const claudeSettings = settingsFile();
  files.push({ tool: 'claude-code', part: 'hooks', file: claudeSettings, exists: existsSync(claudeSettings), hydra: hookStatus().length > 0, mode: mode(claudeSettings), backup: backupOf(claudeSettings) });
  for (const dir of [path.join(claudeDir(), 'skills', 'hydra'), path.join(path.dirname(claudeDir()), '.agents', 'skills', 'hydra')]) {
    if (existsSync(dir)) files.push({ tool: dir.includes('.agents') ? 'skills CLI' : 'claude-code', part: 'skill', file: dir, exists: true, hydra: true, mode: mode(dir), backup: null });
  }
  files.push({ tool: 'hydra', part: 'scripts', file: path.join(home(), 'scripts'), exists: existsSync(path.join(home(), 'scripts')), hydra: true, mode: mode(path.join(home(), 'scripts')), backup: null });

  const ledger = path.join(home(), 'ledger.jsonl');
  const llamaUrl = process.env.HYDRA_LLAMA_URL ?? config.url ?? 'http://127.0.0.1:8080';
  const refused = Object.values(usage).reduce((sum, u) => sum + u.refused, 0);
  const report = {
    version: currentVersion(),
    installed: readInstalled(),
    home: home(),
    files,
    usage,
    server: {
      url: llamaUrl, loopback: loopback(llamaUrl), managed: Boolean(config.managed), pid: serverPid(),
      binary: config.server ?? null, model: config.modelPath ?? null, modelSha256: manifest.model?.sha256 ?? null,
    },
    network: [
      { when: 'install and hydra self-update reinstalls', to: [...installHosts, 'registry.npmjs.org (the skills CLI and the hydra-nano package)'] },
      { when: 'hydra self-update and self-update --check', to: [process.env.HYDRA_REGISTRY ? new URL(process.env.HYDRA_REGISTRY).host : 'registry.npmjs.org'] },
      { when: 'every other command, hook and MCP call', to: [`the model server at ${llamaUrl}`] },
    ],
    telemetry: {
      enabled: process.env.HYDRA_TELEMETRY !== '0', file: ledger, exists: existsSync(ledger), mode: mode(ledger),
      rows: existsSync(ledger) ? rows().length : 0, leavesMachine: false,
    },
    mcp: {
      hydraRun: 'one recognised test or build command per call (npm test, pytest, cargo test, go test, tsc and similar); no shell operators, redirection or env prefix; paths and code-loading flags must stay inside cwd',
      folders: "cwd must sit inside the client's MCP roots, else the folder the server started in, or HYDRA_MCP_ROOTS",
      refusedSoFar: refused,
      otherTools: 'hydra_git, hydra_os, hydra_smell, hydra_refactor and hydra_design only read',
    },
  };
  report.warnings = [
    // Codex keeps credentials beside its MCP table; Hydra's older installers widened it (fixed in 0.3.2).
    ...files.filter(f => f.tool === 'codex' && f.part === 'mcp' && f.exists && f.mode && f.mode !== '600' && mode(`${f.file}.before-hydra`) === '600')
      .map(f => `${f.file} is ${f.mode}, but its original was 600; restore with: chmod 600 "${f.file}"`),
    ...(report.server.loopback ? [] : [`the model server address ${llamaUrl} is not this machine; prompts with command output go there`]),
    ...(report.telemetry.exists && report.telemetry.mode !== '600' ? [`${ledger} is ${report.telemetry.mode}, not owner-only`] : []),
  ];
  return report;
}

/** The report as plain text. */
export function render(report) {
  const out = [];
  const row = (a, b) => out.push(`  ${a.padEnd(22)} ${b}`);
  out.push(`Hydra audit (${report.version ? `hydra ${report.version}` : 'version not recorded'}, ${report.home})`);
  if (report.installed) out.push(`  installed ${report.installed.installedAt?.slice(0, 10)} with options: ${report.installed.args.join(' ') || '(defaults)'}`);
  out.push('', 'Files Hydra registered itself in (mode, backup of the original):');
  for (const f of report.files) {
    if (!f.exists) continue;
    row(`${f.tool} ${f.part}`, `${f.file}  ${f.hydra ? '' : '(no Hydra entry now) '}${f.mode ?? ''}${f.backup ? `  backup: ${path.basename(f.backup)}` : ''}`);
  }
  out.push('', 'Use, from the local ledger (registered is not used):');
  for (const [id, u] of Object.entries(report.usage)) {
    if (!report.files.some(f => f.tool === id && f.exists && f.hydra)) continue;
    row(id, u.calls ? `${u.calls} calls, last ${u.last?.slice(0, 10)}${u.refused ? `, ${u.refused} folders refused` : ''}` : `never called${u.refused ? `, ${u.refused} folders refused` : ''}`);
  }
  out.push('', 'Model server:');
  row('address', `${report.server.url}${report.server.loopback ? ' (this machine only)' : ' (NOT this machine)'}`);
  row('process', report.server.pid ? `running, pid ${report.server.pid}` : 'not running (starts on the next call)');
  if (report.server.model) row('model', `${report.server.model} (pinned SHA-256 ${report.server.modelSha256?.slice(0, 12)}…)`);
  out.push('', 'Network:');
  for (const n of report.network) out.push(`  ${n.when}:`, `    ${n.to.join(', ')}`);
  out.push('', 'Telemetry:');
  row('ledger', `${report.telemetry.file} ${report.telemetry.mode ?? ''}, ${report.telemetry.rows} rows, ${report.telemetry.enabled ? 'on' : 'off (HYDRA_TELEMETRY=0)'}; it never leaves this machine`);
  out.push('', 'What the MCP server can do:');
  row('hydra_run', report.mcp.hydraRun);
  row('folders', `${report.mcp.folders}; ${report.mcp.refusedSoFar} refused so far`);
  row('everything else', report.mcp.otherTools);
  out.push('', report.warnings.length ? `Warnings:\n${report.warnings.map(w => `  - ${w}`).join('\n')}` : 'Warnings: none');
  out.push('', 'Undo everything: hydra agents remove; hydra hooks remove; hydra stop; then delete the folders above.');
  return out.join('\n');
}
