#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { installRuntime, findNpx } from './lib/bootstrap.mjs';
import { ensureLocal, home } from './lib/local.mjs';
import { claudeDir, installHooks } from './lib/claude_hooks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node 18 or newer is required');
  const manifest = JSON.parse(readFileSync(path.join(here, 'runtime-manifest.json'), 'utf8'));
  if (!manifest.model) throw new Error('GGUF publication is not ready; no downloads or installation performed');
  const agentFlag = process.argv.indexOf('--agent');
  const agent = agentFlag >= 0 ? process.argv[agentFlag + 1] : 'codex';
  if (!agent || !/^[a-z][a-z0-9-]*$/.test(agent)) throw new Error('Use --agent with one skills CLI agent ID (default: codex)');
  console.log(`Hydra installs a pinned llama.cpp runtime and ${manifest.model.size} bytes of GGUF weights into ${home()}.
It then installs the hydra skill globally for ${agent} and starts a local server on port 11435.
The server stays running until stopped or the computer restarts. Download time depends on your connection.`);
  if (!process.argv.includes('--runtime-only')) {
    const npx = findNpx();
    if (!npx) throw new Error('Cannot locate npm npx-cli.js; install Node with npm or use --runtime-only');
    execFileSync(process.execPath, [npx, '--yes', '--package=skills', 'skills', 'add', path.resolve(here, '..'), '--skill', 'hydra', '--agent', agent, '--global', '--yes'], { stdio: 'inherit' });
  }
  const config = await installRuntime(manifest);
  await ensureLocal(config);
  // Claude Code: register the hooks that route test/build runs and git questions to Hydra.
  const skill = path.join(claudeDir(), 'skills', 'hydra', 'scripts');
  if (agent === 'claude-code' && !process.argv.includes('--runtime-only') && !process.argv.includes('--no-hooks')
      && existsSync(path.join(skill, 'hooks', 'route-tests.mjs'))) {
    const file = installHooks(skill);
    console.log(`Added Hydra's Claude Code hooks to ${file} (your other settings are kept; the original is saved as settings.json.before-hydra).
Test and build runs now go through Hydra, and new sessions are told to ask Hydra about git history.
Remove them with: node "${path.join(skill, 'hydra.mjs')}" hooks remove`);
  }
  console.log('Hydra skill and local runtime ready. Run the installed scripts/hydra.mjs doctor to verify.');
} catch (error) { console.error(`hydra-install: ${error.message}`); process.exitCode = 2; }
