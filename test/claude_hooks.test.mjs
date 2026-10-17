import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { hookStatus, installHooks, removeHooks, testRun } from '../skills/hydra/scripts/lib/claude_hooks.mjs';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/hydra/scripts');
const temp = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'hydra-hooks-')), 'settings.json');

test('test and build runs are recognised in every common form, and nothing else is', () => {
  for (const command of ['npm test', 'cd web && pnpm run test:unit 2>&1 | tail -40', 'CI=1 npx vitest run a.test.ts',
    'python -m pytest -q', '.venv/bin/python -m unittest discover -s tests', 'uv run pytest -x', 'cargo test --lib',
    'go test ./...', './gradlew :app:test', 'mvn -B test', 'dotnet test', 'node --test', 'make check'])
    assert.ok(testRun(command), `missed ${command}`);
  for (const command of ['git status', 'ls -la', 'npm install', 'pip install pytest', 'python app.py', 'node script.js',
    'grep -r pytest .', 'echo done', './gradlew tasks', `node "${SCRIPTS}/hydra.mjs" run -- npm test`, 'HYDRA_RAW=1 npm test'])
    assert.equal(testRun(command), null, `wrongly caught ${command}`);
  assert.equal(testRun('cd web && pnpm run test:unit 2>&1 | tail -40'), 'pnpm run test:unit');
});

test('installing hooks keeps every other setting and never duplicates on a second install', () => {
  const file = temp();
  const original = { model: 'opus', permissions: { allow: ['Bash(git *)'] },
    hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'prettier --write' }] }] } };
  writeFileSync(file, JSON.stringify(original));
  installHooks(SCRIPTS, file);
  installHooks(SCRIPTS, file);
  const settings = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(settings.model, 'opus');
  assert.deepEqual(settings.permissions, original.permissions);
  assert.deepEqual(settings.hooks.PreToolUse[0], original.hooks.PreToolUse[0]);
  assert.equal(hookStatus(file).length, 2);
  assert.deepEqual(JSON.parse(readFileSync(`${file}.before-hydra`, 'utf8')), original);
  assert.ok(removeHooks(file));
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), original);
  assert.equal(removeHooks(file), false);
});

test('a settings file that is not valid JSON is left untouched', () => {
  const file = temp();
  writeFileSync(file, '{ "model": "opus", ');
  assert.throws(() => installHooks(SCRIPTS, file), /not valid JSON/);
  assert.equal(readFileSync(file, 'utf8'), '{ "model": "opus", ');
  assert.equal(existsSync(`${file}.before-hydra`), false);
});

test('the hook scripts answer Claude Code in its hook format', () => {
  const run = (name, input) => execFileSync(process.execPath, [path.join(SCRIPTS, 'hooks', name)], { input }).toString();
  const denied = JSON.parse(run('route-tests.mjs', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } })));
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /hydra\.mjs" run -- npm test/);
  assert.equal(run('route-tests.mjs', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } })), '');
  const guide = JSON.parse(run('session-guide.mjs', '{}'));
  assert.equal(guide.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(guide.hookSpecificOutput.additionalContext, /ask --head git/);
});
