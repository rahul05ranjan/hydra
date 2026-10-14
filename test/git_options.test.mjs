import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gather } from '../skills/hydra/scripts/lib/git.mjs';
import { answer } from '../skills/hydra/scripts/lib/answer.mjs';

function fixture(t) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'hydra-git-options-'));
  t.after(() => {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(cwd));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    rmSync(cwd, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.invalid', ...args], { cwd, encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(path.join(cwd, 'index.txt'), 'initial\n');
  writeFileSync(path.join(cwd, 'staged.js'), 'initial\n');
  git('add', '.'); git('commit', '-qm', 'Initial record');
  writeFileSync(path.join(cwd, 'index.txt'), 'initial\nINDEX_ONLY\n'); git('add', 'index.txt');
  writeFileSync(path.join(cwd, 'index.txt'), 'initial\nINDEX_ONLY\nWORKTREE_ONLY\n');
  writeFileSync(path.join(cwd, 'staged.js'), 'initial\nFILENAME_EDIT\n');
  return cwd;
}

test('uncommitted patch rejects an unrequested model index flag, including index-named files', async t => {
  const cwd = fixture(t);
  const sections = await gather('Show the uncommitted patch for index.txt.', cwd,
    async () => ({ probes: [{ probe: 'diff', staged: true, path: 'index.txt' }] }));
  assert.equal(sections[0].args.staged, false);
  assert.match(sections[0].out, /\+INDEX_ONLY/);
  assert.match(sections[0].out, /\+WORKTREE_ONLY/);
});

test('explicit unstaged patch compares against the index and excludes its staged additions', async t => {
  const cwd = fixture(t);
  const sections = await gather('Show the unstaged patch for index.txt.', cwd,
    async () => ({ probes: [{ probe: 'diff', staged: true, path: 'index.txt' }] }));
  assert.equal(sections[0].args.staged, false);
  assert.match(sections[0].out, /\+WORKTREE_ONLY/);
  assert.doesNotMatch(sections[0].out, /\+INDEX_ONLY/);
});

test('staging words inside a named file do not authorize an index-only patch', async t => {
  const cwd = fixture(t);
  const sections = await gather('Show the uncommitted patch for staged.js.', cwd,
    async () => ({ probes: [{ probe: 'diff', staged: true, path: 'staged.js' }] }));
  assert.equal(sections[0].args.staged, false);
  assert.match(sections[0].out, /\+FILENAME_EDIT/);
});

test('an explicitly requested index patch retains the model staged selection', async t => {
  const cwd = fixture(t);
  for (const question of ['Show the staged patch for index.txt.', 'Show changes prepared for the next commit.', 'Show the patch held in the index.']) {
    const sections = await gather(question, cwd, async () => ({ probes: [{ probe: 'diff', staged: true }] }));
    assert.equal(sections[0].args.staged, true);
    assert.match(sections[0].out, /\+INDEX_ONLY/);
    assert.doesNotMatch(sections[0].out, /WORKTREE_ONLY/);
  }
});

test('explicit staged scope is caller-owned even when the model omits its index flag', async t => {
  const cwd = fixture(t);
  const sections = await gather('Show changes already added to the Git index.', cwd,
    async () => ({ probes: [{ probe: 'diff', staged: false }] }));
  assert.equal(sections[0].args.staged, true);
  assert.match(sections[0].out, /\+INDEX_ONLY/);
  assert.doesNotMatch(sections[0].out, /WORKTREE_ONLY/);
});

test('branch-only history counts override the model default', async t => {
  const cwd = fixture(t);
  const sections = await gather('List up to 50 branch-only history records.', cwd,
    async () => ({ probes: [{ probe: 'log', n: 15 }] }));
  assert.equal(sections[0].args.n, 50);
});

test('combined staging scopes include both index and working-copy additions', async t => {
  const cwd = fixture(t);
  for (const question of ['Show staged and unstaged changes.', 'Show both staged and un-staged changes.',
    'Show not staged and staged changes.', 'Show un staged and staged changes.',
    'Show staged changes prepared for commit and unstaged working-copy changes.']) {
    const sections = await gather(question, cwd, async () => ({ probes: [{ probe: 'diff', staged: true }] }));
    assert.equal(sections[0].args.staged, false, question);
    assert.match(sections[0].out, /\+INDEX_ONLY/, question);
    assert.match(sections[0].out, /\+WORKTREE_ONLY/, question);
  }
});

test('a named blame record is returned completely even when the model omits its author line', async () => {
  const wanted = 'cafe123 (Writer 2026-01-01 18) const uniqueProbe91 = 7;';
  const out = Array.from({ length: 35 }, (_, i) => i === 17 ? wanted : 'cafe123 (Other 2026-01-01 ' + i + ') filler_' + i + ' ' + 'x'.repeat(35)).join('\n');
  const result = await answer('Read the blame record containing uniqueProbe91 from widget.js.',
    [{ probe: 'blame', cmd: 'git blame -- widget.js', out }], async () => ({ lines: [1] }));
  assert.ok(result.text.includes(wanted));
});
