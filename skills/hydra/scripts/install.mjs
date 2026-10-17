#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { installRuntime, findNpx } from './lib/bootstrap.mjs';
import { ensureLocal, home } from './lib/local.mjs';
import { claudeDir, installHooks } from './lib/claude_hooks.mjs';
import * as integrations from './lib/integrations.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node 18 or newer is required');
  const manifest = JSON.parse(readFileSync(path.join(here, 'runtime-manifest.json'), 'utf8'));
  if (!manifest.model) throw new Error('GGUF publication is not ready; no downloads or installation performed');
  // Install for the agents named with --agent, or else for every agent found on this machine.
  const named = process.argv.flatMap((arg, i) => arg === '--agent' ? [process.argv[i + 1]] : []);
  // The skill goes where an agent has no hook to route it: Claude Code (plus its hooks), Codex and Antigravity.
  // Other tools get the MCP server and a hook instead (below), so their context does not carry both.
  const found = [['claude-code', claudeDir()], ['codex', path.join(os.homedir(), '.codex')], ['antigravity', path.join(os.homedir(), '.gemini', 'antigravity')]]
    .filter(([, dir]) => existsSync(dir)).map(([id]) => id);
  const agents = named.length ? named : found;
  if (!process.argv.includes('--runtime-only')) {
    if (!agents.length) throw new Error('No Claude Code (~/.claude) or Codex (~/.codex) found; name one with --agent <skills CLI agent ID>');
    if (agents.some(agent => !agent || !/^[a-z][a-z0-9-]*$/.test(agent))) throw new Error('--agent takes a skills CLI agent ID such as claude-code or codex');
  }
  console.log(`Hydra installs a pinned llama.cpp runtime and ${manifest.model.size} bytes of GGUF weights into ${home()}.
It then installs the hydra skill for ${agents.join(' and ') || 'no agent (runtime only)'} and starts a local server on port 11435.
The server stays running until stopped or the computer restarts. Download time depends on your connection.`);
  if (!process.argv.includes('--runtime-only')) {
    const npx = findNpx();
    if (!npx) throw new Error('Cannot locate npm npx-cli.js; install Node with npm or use --runtime-only');
    for (const agent of agents) {
      execFileSync(process.execPath, [npx, '--yes', '--package=skills', 'skills', 'add', path.resolve(here, '..'), '--skill', 'hydra', '--agent', agent, '--global', '--yes'], { stdio: 'inherit' });
    }
  }
  const config = await installRuntime(manifest);
  await ensureLocal(config);
  // Claude Code: register the hooks that route test/build runs and git questions to Hydra.
  const skill = path.join(claudeDir(), 'skills', 'hydra', 'scripts');
  if (agents.includes('claude-code') && !process.argv.includes('--runtime-only') && !process.argv.includes('--no-hooks')
      && existsSync(path.join(skill, 'hooks', 'route-tests.mjs'))) {
    const file = installHooks(skill);
    console.log(`Added Hydra's Claude Code hooks to ${file} (your other settings are kept; the original is saved as settings.json.before-hydra).
Test and build runs now go through Hydra, and new sessions are told to ask Hydra about git history.
Remove them with: node "${path.join(skill, 'hydra.mjs')}" hooks remove`);
  }
  // Every other coding tool found here: Hydra's MCP server, plus its test/build hook where the tool has hooks.
  if (!process.argv.includes('--runtime-only') && !process.argv.includes('--no-agents')) {
    const scripts = integrations.installSharedScripts(here);
    const tools = integrations.detected(scripts);
    if (tools.length) {
      console.log(`Registering Hydra's MCP server${process.argv.includes('--no-hooks') ? '' : ' and test/build hook'} in ${tools.join(', ')} ` +
        `(each edited file is backed up once as <file>.before-hydra; skip with --no-agents):`);
      for (const result of integrations.apply(tools, 'install', { scripts, hooks: !process.argv.includes('--no-hooks') })) {
        console.log(`  ${result.id}: ${result.changes.join('; ') || 'nothing changed'}`);
        for (const message of result.manual) console.log(`    ${message.replace(/\n/g, '\n    ')}`);
        if (result.note) console.log(`    ${result.note}`);
      }
      console.log(`  Remove them with: node "${path.join(scripts, 'hydra.mjs')}" agents remove`);
    }
  }
  console.log('Hydra skill and local runtime ready. Run the installed scripts/hydra.mjs doctor to verify.');
} catch (error) { console.error(`hydra-install: ${error.message}`); process.exitCode = 2; }
