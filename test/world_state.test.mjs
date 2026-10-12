import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildWorld } from '../train/world.mjs';

test('development worlds retain all advertised dirty/staged edits after sync setup', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hydra-world-state-'));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  try {
    for (const seed of [6100, 6101]) {
      const world = buildWorld(path.join(root, String(seed)), seed);
      const status = git(world.repo, 'status', '--short');
      const unstaged = git(world.repo, 'diff');
      const staged = git(world.repo, 'diff', '--cached', '--name-only');
      for (const edit of world.unstaged) {
        assert.ok(status.includes(edit.file), `${seed}: status must contain ${edit.file}`);
        assert.ok(unstaged.includes(edit.token), `${seed}: unstaged token must survive ${world.sync.state} setup`);
      }
      for (const file of world.staged) assert.ok(staged.includes(file), `${seed}: staged ${file} must survive sync setup`);
      for (const file of world.untracked) assert.ok(status.includes(`?? ${file}`));
      for (const entry of world.history) {
        assert.ok(readFileSync(path.join(world.repo, entry.file), 'utf8').includes(entry.token), `${seed}: advertised blame token ${entry.token} must exist after sync setup`);
      }
    }
  } finally {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe cleanup path');
    rmSync(root, { recursive: true, force: true });
  }
});
