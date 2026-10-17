// Hydra in every coding tool: the MCP server (mcp.mjs) for tools, and a shell-command hook that sends
// test/build runs through Hydra wherever the tool has one. Claude Code keeps its skill and hooks
// (claude_hooks.mjs) and gets no MCP entry, since that would duplicate the same tools.
//
//   tool         MCP entry                                    hook
//   codex        ~/.codex/config.toml [mcp_servers.hydra]     ~/.codex/hooks.json PreToolUse + SessionStart (trust with /hooks)
//   cursor       ~/.cursor/mcp.json mcpServers.hydra          ~/.cursor/hooks.json beforeShellExecution + sessionStart
//   opencode     ~/.config/opencode/opencode.json(c) mcp.hydra ~/.config/opencode/plugins/hydra.js tool.execute.before
//   gemini-cli   ~/.gemini/settings.json mcpServers.hydra     same file, hooks.BeforeTool on run_shell_command
//   antigravity  ~/.gemini/antigravity/mcp_config.json        none known; the MCP server's instructions guide it
//   antigravity-ide ~/.gemini/config/mcp_config.json          none known; the skill in ~/.gemini/config/skills/hydra guides it
//
// Antigravity IDE (com.google.antigravity-ide, data in ~/.gemini/antigravity-ide) is a different app from
// the older Antigravity (~/.gemini/antigravity): it reads MCP servers and skills from ~/.gemini/config.
//
// Every file Hydra edits is backed up once as <file>.before-hydra, written atomically, and only
// Hydra's own entries are added or removed. A file Hydra cannot edit safely (JSON with comments, or
// invalid) is left alone and the entry to add by hand is reported instead.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = () => process.env.HYDRA_TOOLS_HOME || os.homedir();
const OURS = /[\\/](?:\.hydra[\\/]scripts|skills[\\/]hydra[\\/]scripts)[\\/]/;
const BEGIN = '# >>> hydra (managed by Hydra; remove with: hydra agents remove codex) >>>';
const END = '# <<< hydra <<<';

/** Hydra's own copy of its scripts, which every tool's MCP entry and hook points at. */
export const sharedScripts = () => path.join(process.env.HYDRA_HOME ?? path.join(os.homedir(), '.hydra'), 'scripts');

/** Copy the skill's scripts to sharedScripts(), so registrations never point into an npx cache.
 * Its SKILL.md goes beside them, for tools that load skills from a folder of their own. */
export function installSharedScripts(from) {
  const target = sharedScripts();
  if (path.resolve(from) === path.resolve(target)) return target; // Already running from the shared copy.
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(`${target}.hydra-tmp`, { recursive: true, force: true });
  cpSync(from, `${target}.hydra-tmp`, { recursive: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(`${target}.hydra-tmp`, target);
  const skill = path.join(from, '..', 'SKILL.md');
  if (existsSync(skill)) copyFileSync(skill, path.join(path.dirname(target), 'SKILL.md'));
  return target;
}

const quote = value => JSON.stringify(value);
const node = () => process.execPath;
const hookCommand = (scripts, name, format) => `${quote(node())} ${quote(path.join(scripts, 'hooks', name))} --format ${format}`;

function backup(file) {
  if (existsSync(file) && !existsSync(`${file}.before-hydra`)) copyFileSync(file, `${file}.before-hydra`);
}

function write(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  backup(file);
  writeFileSync(`${file}.hydra-tmp`, text);
  renameSync(`${file}.hydra-tmp`, file);
}

class Manual extends Error {
  constructor(file, snippet, why) { super(`${file} ${why}; add this by hand:\n${snippet}`); this.manual = true; }
}

/** Read a JSON settings file Hydra may rewrite. Comments would be lost on rewrite, so they stop it. */
function loadJson(file, snippet) {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  const withoutStrings = text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  if (/\/\/|\/\*/.test(withoutStrings)) throw new Manual(file, snippet, 'has comments that a rewrite would drop');
  let value;
  try { value = JSON.parse(text); } catch { value = null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Manual(file, snippet, 'is not valid JSON');
  return value;
}

const saveJson = (file, value) => write(file, `${JSON.stringify(value, null, 2)}\n`);
const mentionsOurs = value => OURS.test(JSON.stringify(value ?? ''));

/** Add or remove Hydra's entry in a JSON object of named servers, such as mcpServers. */
function jsonServer(file, key, entry) {
  return {
    install() {
      const snippet = JSON.stringify({ [key]: { hydra: entry } }, null, 2);
      const settings = loadJson(file, snippet);
      settings[key] = { ...(settings[key] ?? {}), hydra: entry };
      saveJson(file, settings);
      return `${file}: ${key}.hydra`;
    },
    remove() {
      if (!existsSync(file)) return null;
      const settings = loadJson(file, '');
      if (!settings[key]?.hydra || !mentionsOurs(settings[key].hydra)) return null;
      delete settings[key].hydra;
      if (!Object.keys(settings[key]).length) delete settings[key];
      saveJson(file, settings);
      return `${file}: ${key}.hydra`;
    },
    status: () => existsSync(file) && (() => { try { return mentionsOurs(loadJson(file, '')[key]?.hydra); } catch { return false; } })(),
  };
}

/** Claude-style hook lists ({event: [{matcher, hooks: [{type, command}]}]}) under `root` in a JSON file. */
function jsonHooks(file, events, { root = 'hooks', extra = {} } = {}) {
  const without = settings => {
    for (const [event, groups] of Object.entries(settings[root] ?? {})) {
      if (!Array.isArray(groups)) continue;
      const kept = groups.map(group => (group.hooks ? { ...group, hooks: group.hooks.filter(hook => !OURS.test(hook.command ?? '')) } : group))
        .filter(group => (group.hooks ? group.hooks.length : !OURS.test(group.command ?? '')));
      if (kept.length) settings[root][event] = kept; else delete settings[root][event];
    }
    if (settings[root] && !Object.keys(settings[root]).length) delete settings[root];
    return settings;
  };
  return {
    install() {
      const snippet = JSON.stringify({ ...extra, [root]: events }, null, 2);
      const settings = without(loadJson(file, snippet));
      Object.assign(settings, Object.fromEntries(Object.entries(extra).filter(([k]) => settings[k] === undefined)));
      settings[root] ??= {};
      for (const [event, groups] of Object.entries(events)) (settings[root][event] ??= []).push(...groups);
      saveJson(file, settings);
      return `${file}: ${Object.keys(events).join(', ')}`;
    },
    remove() {
      if (!existsSync(file)) return null;
      const settings = loadJson(file, '');
      const before = JSON.stringify(settings);
      without(settings);
      if (JSON.stringify(settings) === before) return null;
      saveJson(file, settings);
      return `${file}: hooks`;
    },
    status: () => existsSync(file) && OURS.test(readFileSync(file, 'utf8')),
  };
}

/** Codex keeps MCP servers in TOML; Hydra's table sits between marker comments it alone writes. */
function tomlServer(file, scripts) {
  const block = `${BEGIN}\n[mcp_servers.hydra]\ncommand = ${quote(node())}\nargs = [${quote(path.join(scripts, 'mcp.mjs'))}]\nstartup_timeout_sec = 20\ntool_timeout_sec = 1800\n${END}\n`;
  // Install appends "\n" + block to text ending in a newline, so removing "\n" + block restores it exactly.
  const strip = text => text.replace(new RegExp(`\\n?${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}\\n?`), '');
  return {
    install() {
      const text = existsSync(file) ? strip(readFileSync(file, 'utf8')) : '';
      if (/^\[mcp_servers\.hydra\]/m.test(text)) throw new Manual(file, block, 'already has an [mcp_servers.hydra] table that Hydra did not write');
      // Appended at the end: a TOML table runs until the next header, so nothing after it is captured.
      write(file, `${text.replace(/\s*$/, '\n')}\n${block}`);
      return `${file}: [mcp_servers.hydra]`;
    },
    remove() {
      if (!existsSync(file)) return null;
      const text = readFileSync(file, 'utf8');
      if (!text.includes(BEGIN)) return null;
      write(file, strip(text));
      return `${file}: [mcp_servers.hydra]`;
    },
    status: () => existsSync(file) && readFileSync(file, 'utf8').includes(BEGIN),
  };
}

/** OpenCode loads every file in its plugins folder; Hydra's is one small file that imports the shared scripts. */
function opencodePlugin(file, scripts) {
  const url = name => quote(new URL(`file://${path.join(scripts, name).replace(/\\/g, '/')}`).href);
  const source = `// Hydra (managed by Hydra; remove with: hydra agents remove opencode): send test/build runs through Hydra.
import { testRun } from ${url('lib/claude_hooks.mjs')};
import { record } from ${url('lib/ledger.mjs')};

export const Hydra = async () => ({
  'tool.execute.before': async (input, output) => {
    if (input.tool !== 'bash') return;
    const command = String(output.args?.command ?? '');
    const run = testRun(command);
    if (!run) return;
    record({ ts: new Date().toISOString(), kind: 'hook', hook: 'route-tests', agent: 'opencode', decision: 'deny',
      command: command.slice(0, 300), run, ...(input.sessionID ? { session: input.sessionID } : {}) });
    throw new Error('Test/build runs go through Hydra so the full log stays out of context. Run it as: ' +
      'node ' + ${quote(JSON.stringify(path.join(scripts, 'hydra.mjs')))} + ' run -- ' + run + ', or call the hydra_run tool with that command. ' +
      'If you truly need the raw log, prefix the original command with HYDRA_RAW=1.');
  },
});
`;
  return {
    install() { write(file, source); return file; },
    remove() {
      if (!existsSync(file) || !readFileSync(file, 'utf8').includes('managed by Hydra')) return null;
      rmSync(file);
      if (existsSync(`${file}.before-hydra`)) rmSync(`${file}.before-hydra`);
      return file;
    },
    status: () => existsSync(file) && readFileSync(file, 'utf8').includes('managed by Hydra'),
  };
}

/** The hydra skill folder (SKILL.md and the scripts it names) in a tool's own skills folder.
 * An older hydra skill there is replaced; a folder that is not the hydra skill is left alone. */
function skillFolder(dir, scripts) {
  const skillFile = path.join(dir, 'SKILL.md');
  const ours = () => existsSync(skillFile) && /^name:\s*hydra\s*$/m.test(readFileSync(skillFile, 'utf8'));
  return {
    install() {
      const source = path.join(path.dirname(scripts), 'SKILL.md');
      if (!existsSync(source)) throw new Manual(dir, 'npx github:rahul05ranjan/hydra', `needs the hydra skill, but ${source} is missing; run the installer again`);
      if (existsSync(dir) && !ours()) throw new Manual(dir, `the hydra skill folder (SKILL.md and scripts/) from ${path.dirname(scripts)}`, 'exists and is not the hydra skill');
      rmSync(`${dir}.hydra-tmp`, { recursive: true, force: true });
      mkdirSync(`${dir}.hydra-tmp`, { recursive: true });
      copyFileSync(source, path.join(`${dir}.hydra-tmp`, 'SKILL.md'));
      cpSync(scripts, path.join(`${dir}.hydra-tmp`, 'scripts'), { recursive: true });
      rmSync(dir, { recursive: true, force: true });
      renameSync(`${dir}.hydra-tmp`, dir);
      return `${dir}: skill`;
    },
    remove() {
      if (!ours()) return null;
      rmSync(dir, { recursive: true, force: true });
      return `${dir}: skill`;
    },
    status: () => ours() && existsSync(path.join(dir, 'scripts', 'hydra.mjs')),
  };
}

const opencodeConfig = dir => ['opencode.json', 'opencode.jsonc'].map(name => path.join(dir, name)).find(existsSync) ?? path.join(dir, 'opencode.json');

/** Every tool Hydra can join, with where it lives and what Hydra registers there. */
export function tools(scripts = sharedScripts()) {
  const h = home();
  const mcp = { command: node(), args: [path.join(scripts, 'mcp.mjs')] };
  const codex = path.join(h, '.codex');
  const cursor = path.join(h, '.cursor');
  const opencode = path.join(h, '.config', 'opencode');
  const gemini = path.join(h, '.gemini');
  return {
    codex: { dir: codex, parts: {
      mcp: tomlServer(path.join(codex, 'config.toml'), scripts),
      hooks: jsonHooks(path.join(codex, 'hooks.json'), {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: hookCommand(scripts, 'route-tests.mjs', 'codex'), timeout: 10 }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: hookCommand(scripts, 'session-guide.mjs', 'codex'), timeout: 10 }] }] }) },
      note: 'Codex runs new hooks only after you trust them: open Codex and run /hooks.' },
    cursor: { dir: cursor, parts: {
      mcp: jsonServer(path.join(cursor, 'mcp.json'), 'mcpServers', mcp),
      hooks: jsonHooks(path.join(cursor, 'hooks.json'), {
        beforeShellExecution: [{ command: hookCommand(scripts, 'route-tests.mjs', 'cursor'), timeout: 10 }],
        sessionStart: [{ command: hookCommand(scripts, 'session-guide.mjs', 'cursor'), timeout: 10 }] }, { extra: { version: 1 } }) } },
    opencode: { dir: opencode, parts: {
      mcp: jsonServer(opencodeConfig(opencode), 'mcp', { type: 'local', command: [mcp.command, ...mcp.args], enabled: true, timeout: 1_800_000 }),
      hooks: opencodePlugin(path.join(opencode, 'plugins', 'hydra.js'), scripts) } },
    'gemini-cli': { dir: path.join(gemini, 'settings.json'), parts: {
      mcp: jsonServer(path.join(gemini, 'settings.json'), 'mcpServers', { ...mcp, timeout: 1_800_000 }),
      hooks: jsonHooks(path.join(gemini, 'settings.json'), {
        BeforeTool: [{ matcher: 'run_shell_command', hooks: [{ name: 'hydra', type: 'command', command: hookCommand(scripts, 'route-tests.mjs', 'gemini'), timeout: 10_000 }] }] }) } },
    antigravity: { dir: path.join(gemini, 'antigravity'), parts: {
      mcp: jsonServer(path.join(gemini, 'antigravity', 'mcp_config.json'), 'mcpServers', mcp) } },
    'antigravity-ide': { dir: path.join(gemini, 'antigravity-ide'), parts: {
      mcp: jsonServer(path.join(gemini, 'config', 'mcp_config.json'), 'mcpServers', mcp),
      skill: skillFolder(path.join(gemini, 'config', 'skills', 'hydra'), scripts) } },
  };
}

/** The tools whose folders exist on this machine. */
export const detected = (scripts) => Object.entries(tools(scripts)).filter(([, tool]) => existsSync(tool.dir)).map(([id]) => id);

/** Register (or with remove, take out) Hydra for each tool; one tool failing never stops the others. */
export function apply(ids, action, { scripts = sharedScripts(), hooks = true } = {}) {
  const all = tools(scripts);
  return ids.map(id => {
    const tool = all[id];
    if (!tool) return { id, error: `unknown tool; known: ${Object.keys(all).join(', ')}` };
    const changes = [];
    const manual = [];
    for (const [name, part] of Object.entries(tool.parts)) {
      if (action === 'install' && name === 'hooks' && !hooks) continue;
      try {
        const change = part[action]();
        if (change) changes.push(change);
      } catch (error) {
        if (!error.manual) throw error;
        manual.push(error.message);
      }
    }
    return { id, changes, manual, ...(action === 'install' && tool.note && tool.parts.hooks && hooks ? { note: tool.note } : {}) };
  });
}

export function status(scripts = sharedScripts()) {
  return Object.entries(tools(scripts)).map(([id, tool]) => ({ id, present: existsSync(tool.dir),
    ...Object.fromEntries(Object.entries(tool.parts).map(([name, part]) => [name, Boolean(part.status())])) }));
}
