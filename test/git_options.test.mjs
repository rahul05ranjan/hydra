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

test('"git add" wording is a staging request and keeps the index-only patch', async t => {
  const cwd = fixture(t);
  const sections = await gather('Which edits did I put in place with git add?', cwd,
    async () => ({ probes: [{ probe: 'diff', staged: true }] }));
  assert.equal(sections[0].args.staged, true);
  assert.match(sections[0].out, /\+INDEX_ONLY/);
  assert.doesNotMatch(sections[0].out, /WORKTREE_ONLY/);
});

test('a staging question gets the staged patch even when the model plans a commit', async t => {
  const cwd = fixture(t);
  const sections = await gather('Which files sit in the index waiting for the next commit?', cwd,
    async () => ({ probes: [{ probe: 'show' }] }));
  assert.ok(sections.some(section => section.probe === 'diff' && section.args.staged), sections.map(s => s.cmd).join(', '));
});

test('a current-branch question gets status even when the model plans a commit', async t => {
  const cwd = fixture(t);
  const sections = await gather('What branch is HEAD on right now?', cwd, async () => ({ probes: [{ probe: 'show' }] }));
  assert.ok(sections.some(section => section.probe === 'status'), sections.map(s => s.cmd).join(', '));
  const listing = await gather('Which branches exist locally right now?', cwd, async () => ({ probes: [{ probe: 'branches' }] }));
  assert.deepEqual(listing.map(section => section.probe), ['branches']);
});

test('pending edits to a named file since HEAD get its diff, and HEAD is never a log base', async t => {
  const cwd = fixture(t);
  const sections = await gather('What was edited in staged.js since HEAD?', cwd,
    async () => ({ probes: [{ probe: 'log', path: 'staged.js', base: 'HEAD' }] }));
  const diff = sections.find(section => section.probe === 'diff');
  assert.ok(diff, sections.map(s => s.cmd).join(', '));
  assert.equal(diff.args.path, 'staged.js');
  assert.match(diff.out, /\+FILENAME_EDIT/);
  assert.ok(sections.every(section => !section.cmd.includes('HEAD..HEAD')), sections.map(s => s.cmd).join(', '));
});

test('a subject term named in the question becomes the log message filter', async t => {
  const cwd = fixture(t);
  const sections = await gather('Show up to two commits with Initial in their subjects.', cwd,
    async () => ({ probes: [{ probe: 'log', n: 2 }] }));
  assert.equal(sections[0].args.grep, 'Initial');
  assert.match(sections[0].cmd, /--grep=Initial/);
});

test('pending edits take the file named in the question when the model plans a commit', async t => {
  const cwd = fixture(t);
  writeFileSync(path.join(cwd, 'Makefile'), 'all:\n');
  execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.invalid', 'add', 'Makefile'], { cwd });
  execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.invalid', 'commit', '-qm', 'Add build file', '--', 'Makefile'], { cwd });
  writeFileSync(path.join(cwd, 'Makefile'), 'all:\n\tMAKE_EDIT\n');
  for (const [question, file, edit] of [['What was edited in staged.js since HEAD?', 'staged.js', /\+FILENAME_EDIT/],
    ['Which uncommitted lines does Makefile have?', 'Makefile', /\+\tMAKE_EDIT/]]) {
    const sections = await gather(question, cwd, async () => ({ probes: [{ probe: 'show' }] }));
    const diff = sections.find(section => section.probe === 'diff');
    assert.equal(diff?.args.path, file, question);
    assert.match(diff.out, edit);
    assert.ok(sections.every(section => section.probe !== 'show'), sections.map(s => s.cmd).join(', '));
  }
});

test('branch-only commit lists are not cut to the default fifteen', async t => {
  const cwd = fixture(t);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.invalid', ...args], { cwd });
  git('branch', 'trunk');
  const sections = await gather('Which commits does this branch have that trunk lacks?', cwd, async () => ({ probes: [{ probe: 'log', base: 'trunk' }] }));
  assert.equal(sections[0].args.n, 50);
  const counted = await gather('Show 4 commits this branch has that trunk lacks.', cwd, async () => ({ probes: [{ probe: 'log', base: 'trunk' }] }));
  assert.equal(counted[0].args.n, 4);
});

test('scope phrases the model misses still reach the right probe', async t => {
  const cwd = fixture(t);
  const probes = async (question, plan) => (await gather(question, cwd, async () => ({ probes: plan }))).map(section => section.cmd);
  // next commit = staging
  assert.ok((await probes('Which files are going into the next commit?', [{ probe: 'diff', staged: true }])).includes('git diff --staged'));
  // file history = log of that path
  assert.ok((await probes('Which commits modified staged.js?', [{ probe: 'show' }])).some(cmd => cmd.startsWith('git log') && cmd.endsWith('-- staged.js')));
  // most recent commit = show
  assert.ok((await probes('What did the most recent commit change?', [{ probe: 'log', n: 1 }])).includes('git show HEAD'));
  // remote tracking state = status
  assert.ok((await probes('Is this branch behind its remote?', [{ probe: 'remotes' }])).includes('git status --short --branch'));
  // never-added files = status, and "git add" here is not a staging request
  const fresh = await probes('Which files would git add . treat as brand new?', [{ probe: 'diff', staged: true }]);
  assert.ok(fresh.includes('git status --short --branch'), fresh.join(', '));
  assert.ok(!fresh.includes('git diff --staged'), fresh.join(', '));
  // a file against the last commit = its pending diff
  assert.ok((await probes('Diff staged.js against the last commit.', [{ probe: 'show' }])).includes('git diff HEAD -- staged.js'));
  assert.ok((await probes("What did I change in staged.js that isn't committed?", [{ probe: 'show' }])).includes('git diff HEAD -- staged.js'));
});

test('an author the model files under the wrong argument is still used as the author', async t => {
  const cwd = fixture(t);
  const sections = await gather('commits from Dev?', cwd, async () => ({ probes: [{ probe: 'log', base: 'Dev' }] }));
  assert.equal(sections[0].args.author, 'Dev');
});

test('an unusable model base falls back to the one branch the question names', async t => {
  const cwd = fixture(t);
  execFileSync('git', ['branch', 'trunk'], { cwd });
  const sections = await gather('Which commits would land in trunk from here?', cwd, async () => ({ probes: [{ probe: 'log', base: 'here' }] }));
  assert.equal(sections[0].args.base, 'trunk');
  const none = await gather('Which commits are new here?', cwd, async () => ({ probes: [{ probe: 'log', base: 'here' }] }));
  assert.equal(none[0].args.base, undefined);
});
