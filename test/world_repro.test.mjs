import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildWorld } from '../train/world.mjs';

test('development worlds reproduce despite different caller timestamps', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hydra-world-repro-'));
  const prior = process.env.GIT_COMMITTER_DATE;
  const read = (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  try {
    process.env.GIT_COMMITTER_DATE = '2030-01-01T00:00:00Z';
    const first = buildWorld(path.join(root, 'first'), 6100);
    process.env.GIT_COMMITTER_DATE = '2040-01-01T00:00:00Z';
    const second = buildWorld(path.join(root, 'second'), 6100);
    assert.equal(read(first.repo, ['rev-parse', 'HEAD']), read(second.repo, ['rev-parse', 'HEAD']));
    assert.equal(read(first.repo, ['log', '--all', '--format=%H']), read(second.repo, ['log', '--all', '--format=%H']));
    assert.equal(read(first.repo, ['stash', 'list', '--format=%H']), read(second.repo, ['stash', 'list', '--format=%H']));
  } finally {
    if (prior === undefined) delete process.env.GIT_COMMITTER_DATE;
    else process.env.GIT_COMMITTER_DATE = prior;
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  }
});
