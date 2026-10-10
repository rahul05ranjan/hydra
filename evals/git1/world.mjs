import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// mulberry32: small, seeded, and the same on every machine.
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

// None of these names, paths or hashes appear in the examples inside the head's own prompt.
const AUTHORS = [
  'Priya Nair', 'Kenji Mori', 'Lena Vogel', 'Tomas Silva', 'Amara Okafor', 'Noor Haddad', 'Ivan Petrov', 'Mei Lin',
  'Diego Ramos', 'Sofia Greco', 'Arjun Mehta', 'Hana Kim', 'Omar Farouk', 'Elsa Berg', 'Luca Conti', 'Zainab Ali',
].map(name => ({ name, first: name.split(' ')[0], email: `${name.split(' ')[0].toLowerCase()}@example.com` }));

const FLAVORS = [
  ['package.json', 'src/server.ts', 'src/routes/users.ts', 'src/routes/orders.ts', 'src/db/client.ts', 'src/middleware/auth.ts', 'src/config.ts', 'test/users.test.ts', 'test/orders.test.ts', 'README.md', 'docs/api.md'],
  ['pyproject.toml', 'src/pkg/__init__.py', 'src/pkg/parser.py', 'src/pkg/cache.py', 'src/pkg/cli.py', 'tests/test_parser.py', 'tests/test_cache.py', 'docs/usage.md', 'README.md', 'Makefile'],
  ['go.mod', 'cmd/server/main.go', 'internal/store/store.go', 'internal/queue/worker.go', 'internal/http/handler.go', 'internal/http/router.go', 'deploy/Dockerfile', 'deploy/k8s.yaml', 'README.md'],
  ['Cargo.toml', 'src/main.rs', 'src/args.rs', 'src/render.rs', 'src/fetch.rs', 'tests/cli.rs', 'README.md', 'docs/install.md'],
  ['package.json', 'app/page.tsx', 'app/layout.tsx', 'components/Header.tsx', 'components/Cart.tsx', 'lib/api.ts', 'lib/price.ts', 'styles/main.css', 'README.md'],
  ['requirements.txt', 'pipeline/extract.py', 'pipeline/transform.py', 'pipeline/load.py', 'sql/schema.sql', 'sql/report.sql', 'config/settings.yaml', 'README.md'],
];

const VERBS = ['Add', 'Fix', 'Refactor', 'Remove', 'Speed up', 'Document', 'Rename', 'Guard', 'Cache', 'Validate', 'Log', 'Retry', 'Simplify', 'Test'];
const OBJECTS = [
  'pagination cursor', 'retry backoff', 'session expiry', 'rate limiter', 'invoice totals', 'timezone parsing',
  'upload size check', 'health endpoint', 'webhook signature', 'cache eviction', 'search ranking', 'password reset',
  'export format', 'feature flag lookup', 'connection pool', 'error envelope', 'currency rounding', 'batch importer',
  'audit trail', 'email template', 'locale fallback', 'thumbnail resize', 'queue visibility timeout',
  'schema migration', 'token refresh', 'request tracing', 'coupon validation', 'shipping estimate',
  'duplicate detection', 'graceful shutdown', 'config loader', 'metrics exporter', 'slug generator',
  'permission check', 'archive cleanup', 'sitemap builder', 'dark mode toggle', 'avatar upload', 'tax calculation',
  'report scheduler',
];
const TAILS = ['', '', '', ' for large inputs', ' on startup', ' under load', ' in the worker', ' behind a flag', ' with clearer errors', ' for empty input', ' in the admin view'];
const PREFIXES = ['', '', '', 'fix: ', 'feat: ', 'chore: ', 'refactor: '];
const TRUNKS = ['main', 'main', 'main', 'master', 'develop', 'trunk'];
const FEATURE_BRANCHES = [
  'feat/bulk-export', 'fix/login-redirect', 'feat/usage-dashboard', 'fix/stale-cache', 'chore/upgrade-deps',
  'feat/webhook-retries', 'fix/timezone-offset', 'refactor/storage-layer', 'feat/api-keys', 'fix/flaky-upload-test',
  'perf/query-batching', 'docs/onboarding',
];
const OTHER_BRANCHES = ['staging', 'release/2.3', 'hotfix/null-total', 'experiment/new-parser', 'feat/sso', 'fix/csv-quotes', 'chore/ci-cache', 'spike/graphql'];
const STASH_NOTES = ['half-done retry logic', 'try smaller batch size', 'debug prints for upload', 'parking the schema change', 'experiment with cache keys', 'unfinished validation'];
const UNTRACKED = ['TODO.txt', 'scratch.py', 'debug.log', 'notes.md', 'plan.txt', 'bench.out', 'query.sql', 'sample.json'];
const SYNC_STATES = ['none', 'synced', 'ahead', 'behind'];
const SIZES = [[8, 15], [20, 40], [60, 110]];

// Builds one repository whose every hash follows from the seed: fixed identities, fixed dates, no user config.
export function buildWorld(root, seed) {
  const r = rng(seed);
  const repo = path.join(root, 'repo');
  mkdirSync(repo, { recursive: true });

  const authors = r.sample(AUTHORS, r.int(3, 5));
  const files = r.pick(FLAVORS);
  const trunk = r.pick(TRUNKS);
  let author = authors[0];
  let clock = Date.UTC(2026, 0, 5, 9) / 1000 + seed * 977;
  let serial = 0;
  const subjects = new Set();

  // Background maintenance is off so nothing repacks the repository while it is being written.
  const git = (...args) =>
    execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
        GIT_AUTHOR_DATE: `${clock} +0000`,
        GIT_COMMITTER_DATE: `${clock} +0000`,
      },
    }).trim();

  const edit = (file, label) => {
    const token = `${label.replaceAll(' ', '_')}_${++serial}`;
    appendFileSync(path.join(repo, file), `${token} = ${r.int(1, 999)}\n`);
    return token;
  };

  const commit = () => {
    clock += r.int(1, 30) * 3600;
    author = r.pick(authors);
    let subject, object;
    do {
      object = r.pick(OBJECTS);
      const prefix = r.pick(PREFIXES);
      const verb = r.pick(VERBS);
      subject = `${prefix}${prefix ? verb.toLowerCase() : verb} ${object}${r.pick(TAILS)}`;
    } while (subjects.has(subject));
    subjects.add(subject);
    const lines = r.sample(files, r.int(1, 2)).map(file => ({ file, token: edit(file, object) }));
    git('commit', '-q', '-a', '-m', subject);
    return { object, lines, author };
  };

  for (const file of files) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), `# ${file}\n`);
  }
  git('init', '-q', '-b', trunk);
  git('add', '-A');
  git('commit', '-q', '-m', 'Initial project layout');

  const history = [];
  const [least, most] = SIZES[seed % SIZES.length];
  for (let i = r.int(least, most); i > 0; i--) history.push(commit());

  git('init', '-q', '--bare', path.join(root, 'origin.git'));
  git('remote', 'add', 'origin', path.join(root, 'origin.git'));
  git('push', '-q', 'origin', trunk);

  const others = r.sample(OTHER_BRANCHES, r.int(1, 4));
  for (const name of others) {
    git('checkout', '-q', '-b', name, `${trunk}~${r.int(0, 5)}`);
    commit();
    if (r.next() < 0.5) git('push', '-q', 'origin', name);
  }

  const branch = r.pick(FEATURE_BRANCHES);
  const sync = { state: SYNC_STATES[seed % SYNC_STATES.length], by: r.int(1, 3) };
  git('checkout', '-q', '-b', branch, trunk);
  for (let i = r.int(1, 5); i > 0; i--) history.push(commit());
  if (sync.state === 'behind') for (let i = sync.by; i > 0; i--) history.push(commit());
  if (sync.state !== 'none') git('push', '-q', '-u', 'origin', branch);
  if (sync.state === 'ahead') for (let i = sync.by; i > 0; i--) history.push(commit());
  if (sync.state === 'behind') {
    git('reset', '-q', '--hard', `HEAD~${sync.by}`);
    history.length -= sync.by;
  }

  const stashes = r.sample(STASH_NOTES, seed % 5 < 2 ? 0 : r.int(1, 2));
  for (const note of stashes) {
    clock += 600;
    edit(r.pick(files), 'stash');
    git('stash', 'push', '-q', '-m', note);
  }

  const worktrees = r.sample(others, r.int(0, Math.min(2, others.length))).map(name => {
    const dir = `wt-${name.replaceAll('/', '-')}`;
    git('worktree', 'add', '-q', path.join(root, dir), name);
    return { dir, branch: name };
  });

  const [unstagedCount, stagedCount] = [r.int(1, 2), r.int(1, 2)];
  const touched = r.sample(files, unstagedCount + stagedCount);
  const unstaged = touched.slice(0, unstagedCount).map(file => ({ file, token: edit(file, 'wip') }));
  const staged = touched.slice(unstagedCount).map(file => {
    edit(file, 'wip');
    git('add', file);
    return file;
  });
  const untracked = r.sample(UNTRACKED, r.int(1, 2));
  for (const name of untracked) writeFileSync(path.join(repo, name), 'scratch\n');

  return { repo, files, trunk, branch, sync, others, stashes, worktrees, unstaged, staged, untracked, history };
}
