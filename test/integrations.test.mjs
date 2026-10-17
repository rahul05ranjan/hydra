import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/hydra/scripts');

/** A fake home with each tool's settings as a user might already have them. */
function fakeHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'hydra-tools-'));
  const put = (file, text) => { mkdirSync(path.dirname(path.join(home, file)), { recursive: true }); writeFileSync(path.join(home, file), text); };
  put('.codex/config.toml', 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "other"\n');
  put('.cursor/mcp.json', JSON.stringify({ mcpServers: { other: { command: 'other' } } }));
  put('.config/opencode/opencode.json', JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { other: { type: 'local', command: ['other'] } } }));
  put('.gemini/settings.json', JSON.stringify({ hooks: { BeforeTool: [{ matcher: '*', hooks: [{ name: 'mem', type: 'command', command: 'mem hook' }] }] } }));
  put('.gemini/antigravity/mcp_config.json', JSON.stringify({ mcpServers: { other: { command: 'other' } } }));
  return home;
}

async function withHome(home, body) {
  const prior = { tools: process.env.HYDRA_TOOLS_HOME, hydra: process.env.HYDRA_HOME };
  process.env.HYDRA_TOOLS_HOME = home;
  process.env.HYDRA_HOME = path.join(home, '.hydra');
  try {
    const integrations = await import(`../skills/hydra/scripts/lib/integrations.mjs?${Math.random()}`);
    return await body(integrations);
  } finally {
    for (const [key, name] of [['tools', 'HYDRA_TOOLS_HOME'], ['hydra', 'HYDRA_HOME']]) {
      if (prior[key] === undefined) delete process.env[name]; else process.env[name] = prior[key];
    }
  }
}

test('every tool gets Hydra beside its own settings, twice without duplicates, and loses only Hydra on removal', async () => {
  const home = fakeHome();
  const read = file => readFileSync(path.join(home, file), 'utf8');
  const files = ['.codex/config.toml', '.cursor/mcp.json', '.config/opencode/opencode.json', '.gemini/settings.json', '.gemini/antigravity/mcp_config.json'];
  const original = Object.fromEntries(files.map(file => [file, read(file)]));
  await withHome(home, async integrations => {
    const scripts = integrations.installSharedScripts(SCRIPTS);
    assert.ok(existsSync(path.join(scripts, 'mcp.mjs')));
    const ids = integrations.detected(scripts);
    assert.deepEqual(ids.sort(), ['antigravity', 'codex', 'cursor', 'gemini-cli', 'opencode']);
    integrations.apply(ids, 'install', { scripts });
    const results = integrations.apply(ids, 'install', { scripts });
    assert.ok(results.every(result => !result.manual.length));
    assert.match(results.find(result => result.id === 'codex').note, /\/hooks/);

    const toml = read('.codex/config.toml');
    assert.equal(toml.match(/\[mcp_servers\.hydra\]/g).length, 1);
    assert.match(toml, /\[mcp_servers\.other\]\ncommand = "other"/);
    assert.equal(JSON.parse(read('.codex/hooks.json')).hooks.PreToolUse[0].matcher, 'Bash');
    assert.deepEqual(Object.keys(JSON.parse(read('.cursor/mcp.json')).mcpServers), ['other', 'hydra']);
    assert.equal(JSON.parse(read('.cursor/hooks.json')).version, 1);
    assert.deepEqual(JSON.parse(read('.config/opencode/opencode.json')).mcp.hydra.type, 'local');
    const gemini = JSON.parse(read('.gemini/settings.json'));
    assert.deepEqual(gemini.hooks.BeforeTool.map(group => group.matcher), ['*', 'run_shell_command']);
    assert.ok(gemini.mcpServers.hydra.args[0].endsWith('mcp.mjs'));
    assert.ok(JSON.parse(read('.gemini/antigravity/mcp_config.json')).mcpServers.hydra);
    assert.ok(integrations.status(scripts).filter(row => row.present).every(row => row.mcp));

    integrations.apply(ids, 'remove', { scripts });
    for (const file of files) {
      if (file.endsWith('.toml')) assert.equal(read(file), original[file], file);
      else assert.deepEqual(JSON.parse(read(file)), JSON.parse(original[file]), file);
    }
    assert.equal(existsSync(path.join(home, '.config/opencode/plugins/hydra.js')), false);
    assert.equal(read('.codex/config.toml.before-hydra'), original['.codex/config.toml']);
  });
});

test('a settings file with comments is left alone and the entry to add is reported', async () => {
  const home = fakeHome();
  const file = path.join(home, '.config/opencode/opencode.json');
  writeFileSync(file, '{\n  // my servers\n  "mcp": {}\n}\n');
  await withHome(home, async integrations => {
    const [result] = integrations.apply(['opencode'], 'install', { scripts: integrations.installSharedScripts(SCRIPTS) });
    assert.match(result.manual[0], /has comments[\s\S]*"hydra"/);
    assert.equal(readFileSync(file, 'utf8'), '{\n  // my servers\n  "mcp": {}\n}\n');
  });
});

test('each tool hook answers in its own protocol', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'hydra-hook-home-'));
  const hook = (format, input) => execFileSync(process.execPath, [path.join(SCRIPTS, 'hooks', 'route-tests.mjs'), '--format', format],
    { input: JSON.stringify(input), env: { ...process.env, HYDRA_HOME: home } }).toString();
  assert.equal(JSON.parse(hook('codex', { tool_input: { command: 'npm test' } })).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(hook('codex', { tool_input: { command: 'ls' } }), '');
  const gemini = JSON.parse(hook('gemini', { tool_name: 'run_shell_command', tool_input: { command: 'pytest -q' } }));
  assert.equal(gemini.decision, 'deny');
  assert.match(gemini.reason, /hydra_run/);
  assert.deepEqual(JSON.parse(hook('gemini', { tool_input: { command: 'ls' } })), { decision: 'allow' });
  assert.equal(JSON.parse(hook('cursor', { command: 'cargo test' })).permission, 'deny');
  assert.deepEqual(JSON.parse(hook('cursor', { command: 'git status' })), { permission: 'allow' });
  assert.deepEqual(JSON.parse(hook('cursor', 'not json')), { permission: 'allow' });
  const guide = JSON.parse(execFileSync(process.execPath, [path.join(SCRIPTS, 'hooks', 'session-guide.mjs'), '--format', 'cursor'],
    { input: '{}', env: { ...process.env, HYDRA_HOME: home } }).toString());
  assert.match(guide.additional_context, /hydra_git/);
});

test('the OpenCode plugin stops a test run and lets other commands through', async () => {
  const home = fakeHome();
  await withHome(home, async integrations => {
    const scripts = integrations.installSharedScripts(SCRIPTS);
    integrations.apply(['opencode'], 'install', { scripts });
    const { Hydra } = await import(pathToFileURL(path.join(home, '.config/opencode/plugins/hydra.js')).href);
    const hooks = await Hydra({});
    await assert.rejects(hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'npm test' } }), /hydra_run/);
    await hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'ls -la' } });
    await hooks['tool.execute.before']({ tool: 'read' }, { args: { filePath: 'a' } });
  });
});
