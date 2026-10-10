import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// mulberry32 seeded PRNG
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = list => list[int(0, list.length - 1)];
  const sample = (list, k) => {
    const pool = [...list];
    const out = [];
    while (out.length < k && pool.length) out.push(pool.splice(int(0, pool.length - 1), 1)[0]);
    return out;
  };
  return { next, int, pick, sample };
}

// Separate author names strictly disjoint from git1
const AUTHORS = [
  'Aarav Sharma', 'Chloe Dubois', 'Mateo Rossi', 'Yuki Tanaka', 'Fatima Zahra',
  'Liam O\'Connor', 'Ananya Gupta', 'Lukas Schneider', 'Camila Torres', 'David Chen',
  'Siddharth Roy', 'Freja Nielsen', 'Tariq Mansour', 'Elena Popova', 'Gabriel Santos',
  'Kavita Patel', 'Milo Vance', 'Soraya Hadid', 'Viktor Horvat', 'Chen Wei',
].map(name => ({ name, first: name.split(' ')[0], email: `${name.split(' ')[0].toLowerCase()}@example.org` }));

// Separate file flavor templates disjoint from git1
const FLAVORS = [
  ['deno.json', 'src/main.ts', 'src/services/billing.ts', 'src/services/auth.ts', 'src/db/pool.ts', 'src/handlers/api.ts', 'tests/billing_test.ts', 'README.md', 'CHANGELOG.md'],
  ['pom.xml', 'src/main/java/App.java', 'src/main/java/Service.java', 'src/main/java/Config.java', 'src/test/java/AppTest.java', 'README.md', 'mvnw'],
  ['composer.json', 'src/Kernel.php', 'src/Controller/IndexController.php', 'src/Entity/User.php', 'tests/UserTest.php', 'README.md', 'artisan'],
  ['Gemfile', 'app/models/account.rb', 'app/controllers/accounts_controller.rb', 'config/routes.rb', 'spec/models/account_spec.rb', 'README.md'],
  ['CMakeLists.txt', 'src/core.cpp', 'src/engine.cpp', 'include/engine.h', 'tests/test_core.cpp', 'README.md', 'build.sh'],
  ['mix.exs', 'lib/router.ex', 'lib/accounts.ex', 'lib/repo.ex', 'test/router_test.exs', 'README.md'],
];

const VERBS = ['Implement', 'Update', 'Clean up', 'Drop', 'Optimize', 'Revise', 'Harden', 'Tune', 'Check', 'Track', 'Isolate', 'Streamline', 'Test', 'Port'];
const OBJECTS = [
  'jwt validation', 'cors policy', 'sql connection timeout', 'dead letter queue', 'profile picture crop',
  'stripe webhook', 'pdf generator', 'user invitation', 'sms dispatch', 'session store',
  'api rate bucket', 'distributed lock', 'event bus', 'telemetry ping', 'markdown parser',
  'oauth callback', 's3 bucket sync', 'database index', 'health probe', 'cookie parser',
  'password hashing', 'two factor challenge', 'payload compressor', 'csv exporter', 'cdn cache purge',
  'ip allowlist', 'memory leak fix', 'json parser benchmark', 'geo ip lookup', 'alert notification',
];
const TAILS = ['', '', '', ' for mobile clients', ' on cold start', ' when throttled', ' in background', ' using mutex', ' with debug logs', ' for edge runtime'];
const PREFIXES = ['', '', '', 'fix: ', 'feat: ', 'chore: ', 'refactor: '];
const TRUNKS = ['main', 'main', 'trunk', 'master'];
const FEATURE_BRANCHES = [
  'feat/oauth2-flow', 'fix/cors-header', 'feat/csv-stream', 'fix/db-leak', 'chore/update-certs',
  'feat/push-notifications', 'fix/jwt-expiration', 'refactor/billing-engine', 'feat/audit-log',
  'fix/upload-timeout', 'perf/redis-caching', 'docs/quickstart',
];
const OTHER_BRANCHES = ['production', 'beta/1.1', 'hotfix/500-error', 'experiment/rust-wasm', 'feat/saml', 'fix/null-pointer', 'chore/deps-update'];
const STASH_NOTES = ['wip jwt middleware', 'temporary db fix', 'benchmark profiling code', 'stashing router rewrite', 'work on audit logger'];
const UNTRACKED = ['scratch.ts', 'dump.sql', 'test.log', 'ideas.txt', 'profile.cpuprofile', 'temp.json'];
const SYNC_STATES = ['none', 'synced', 'ahead', 'behind'];
const SIZES = [[10, 18], [25, 45], [50, 90]];

export function buildWorld(root, seed) {
  const r = rng(seed);
  const repo = path.join(root, 'repo');
  const remote = path.join(root, 'remote.git');
  mkdirSync(repo, { recursive: true });

  const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
  const write = (rel, body) => {
    const full = path.join(repo, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  const append = (rel, body) => {
    const full = path.join(repo, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    appendFileSync(full, body);
  };

  const trunk = r.pick(TRUNKS);
  const branch = r.pick(FEATURE_BRANCHES);
  const flavor = r.pick(FLAVORS);
  const [minCommits, maxCommits] = r.pick(SIZES);
  const totalCommits = r.int(minCommits, maxCommits);
  const branchAt = r.int(Math.floor(totalCommits * 0.4), Math.floor(totalCommits * 0.7));

  run(repo, 'init', '-b', trunk);
  run(repo, 'config', 'user.name', 'Hydra Seed');
  run(repo, 'config', 'user.email', 'seed@hydra.local');
  run(repo, 'config', 'commit.gpgsign', 'false');

  flavor.forEach((f, i) => write(f, `// ${f} initial seed ${seed}\nexport const item_${i} = ${i};\n`));
  run(repo, 'add', '.');
  const baseEpoch = 1750000000 + (seed % 100000) * 3600;
  const stamp = offset => new Date((baseEpoch + offset * 1800) * 1000).toISOString();

  run(repo, 'commit', '-m', 'Initial commit', '--date', stamp(0));

  const history = [];
  let commitCount = 1;

  for (let i = 1; i < totalCommits; i++) {
    if (i === branchAt) {
      run(repo, 'checkout', '-b', branch);
    }
    const author = r.pick(AUTHORS);
    const file = r.pick(flavor.filter(f => !f.endsWith('.md')));
    const verb = r.pick(VERBS);
    const obj = r.pick(OBJECTS);
    const msg = `${r.pick(PREFIXES)}${verb} ${obj}${r.pick(TAILS)}`;
    const token = `val_${seed}_${i}`;
    append(file, `\n// ${msg}\nexport const ${token} = ${i * 42};\n`);
    run(repo, 'add', file);
    run(repo, 'commit', '-m', msg, '--author', `${author.name} <${author.email}>`, '--date', stamp(i));
    history.push({ file, token, author: author.name, object: obj });
    commitCount++;
  }

  // Other branches
  const others = r.sample(OTHER_BRANCHES, r.int(1, 3));
  for (const b of others) {
    run(repo, 'branch', b, trunk);
  }

  // Stashes
  const stashes = [];
  const stashCount = r.int(0, 2);
  for (let s = 0; s < stashCount; s++) {
    const f = r.pick(flavor);
    append(f, `\n// stash edit ${s}\n`);
    const note = r.pick(STASH_NOTES);
    run(repo, 'stash', 'push', '-m', note);
    stashes.push(`stash@{${s}}: WIP on ${branch}: ${note}`);
  }

  // Worktrees
  const worktrees = [{ dir: repo, branch }];
  const wtDir = path.join(root, 'wt');
  if (r.next() < 0.4) {
    try {
      const wtBranch = r.pick(others);
      run(repo, 'worktree', 'add', wtDir, wtBranch);
      worktrees.push({ dir: wtDir, branch: wtBranch });
    } catch {}
  }

  // Unstaged & Staged changes
  const unstaged = [];
  const staged = [];
  const editFile1 = r.pick(flavor);
  const editToken = `unstaged_${seed}`;
  append(editFile1, `\n// unstaged edit\nexport const ${editToken} = 'dirty';\n`);
  unstaged.push({ file: editFile1, token: editToken });

  if (r.next() < 0.6) {
    const editFile2 = r.pick(flavor.filter(f => f !== editFile1));
    append(editFile2, `\n// staged edit\n`);
    run(repo, 'add', editFile2);
    staged.push(editFile2);
  }

  // Untracked files
  const untracked = r.sample(UNTRACKED, r.int(1, 3));
  for (const u of untracked) {
    write(u, `sample untracked ${u}\n`);
  }

  // Remote & Sync state
  const syncState = r.pick(SYNC_STATES);
  let sync = { state: syncState, by: 0 };
  if (syncState !== 'none') {
    run(repo, 'init', '--bare', remote);
    run(repo, 'remote', 'add', 'origin', remote);
    run(repo, 'push', '-u', 'origin', branch);
    if (syncState === 'ahead') {
      const by = r.int(1, 3);
      for (let k = 0; k < by; k++) {
        append(flavor[0], `\n// ahead commit ${k}\n`);
        run(repo, 'add', flavor[0]);
        run(repo, 'commit', '-m', `Local ahead commit ${k}`);
      }
      sync.by = by;
    } else if (syncState === 'behind') {
      const by = r.int(1, 3);
      run(repo, 'reset', '--hard', `HEAD~${by}`);
      sync.by = by;
    }
  }

  return {
    repo,
    trunk,
    branch,
    flavor,
    unstaged,
    staged,
    untracked,
    stashes,
    worktrees,
    others,
    history,
    sync,
    files: flavor,
  };
}
