import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { run } from './exec.mjs';
import { Unavailable } from './ollama.mjs';

const SKIP = new Set(['node_modules', 'dist', 'build', 'target', 'vendor', 'venv', '__pycache__', 'coverage']);
const STOP = new Set(
  'where what which when does this that with from have file files code function defined used using find show list about into the and for are how'.split(
    ' ',
  ),
);
const MAX_TERMS = 5;
const PER_TERM = 40;
const PER_FILE = 3;
const MAX_PATHS = 20;
const MAX_COLUMNS = 200;
const MAX_BYTES = 512 * 1024;
// Generated files repeat every identifier and answer nothing.
const NOISE = /(^|\/)(package-lock\.json|CHANGELOG[^/]*|[^/]*\.(lock|map)|[^/]*\.min\.js)$/i;
const PROSE = /\.(md|mdx|txt|rst)$/i;

const TERMS_SCHEMA = {
  type: 'object',
  properties: { terms: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_TERMS } },
  required: ['terms'],
};

const TERMS_SYSTEM = `You turn a question about a codebase into search terms.
Give 1 to ${MAX_TERMS} literal strings likely to appear in the code or file names that answer it: identifiers, file names, config keys.
Each term is one word or identifier, never a sentence.`;

const tidy = list =>
  [
    ...new Set(
      (Array.isArray(list) ? list : [])
        .filter(t => typeof t === 'string')
        .map(t => t.trim())
        .filter(t => t.length >= 3 && t.length <= 60),
    ),
  ].slice(0, MAX_TERMS);

const lines = text => text.split('\n').filter(Boolean);
const tidyPath = line => line.replace(/^\.[\\/]/, '').replaceAll('\\', '/');

async function scanWithRg(cwd, terms) {
  // rg only skips these when a .gitignore says so; the trailing "." stops it reading stdin when run without a terminal.
  const where = ['--sort', 'path', ...[...SKIP].flatMap(name => ['--glob', `!${name}`]), '.'];
  const grep = term =>
    run(
      'rg',
      ['-n', '-F', '-i', '--no-heading', '--color', 'never', '--max-count', String(PER_FILE),
        '--max-columns', String(MAX_COLUMNS), '--max-columns-preview', '-e', term, ...where],
      cwd,
    );
  const [listed, ...found] = await Promise.all([run('rg', ['--files', ...where], cwd), ...terms.map(grep)]);
  return {
    files: lines(listed.out).map(tidyPath),
    hits: new Map(terms.map((term, i) => [term, lines(found[i].out).map(tidyPath)])),
  };
}

async function* walk(dir, root = dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, root);
    else if (entry.isFile()) yield tidyPath(path.relative(root, full));
  }
}

// Same result shape as rg, for machines without it.
async function scanWithWalk(cwd, terms) {
  const files = [];
  const hits = new Map(terms.map(term => [term, []]));
  for await (const file of walk(cwd)) {
    files.push(file);
    const full = path.join(cwd, file);
    if ((await stat(full)).size > MAX_BYTES) continue;
    const text = await readFile(full, 'utf8').catch(() => '');
    if (text.includes('\0')) continue;
    const rows = text.split('\n');
    for (const term of terms) {
      const want = term.toLowerCase();
      const bucket = hits.get(term);
      let inFile = 0;
      for (let i = 0; i < rows.length && inFile < PER_FILE; i++) {
        if (!rows[i].toLowerCase().includes(want)) continue;
        bucket.push(`${file}:${i + 1}:${rows[i].slice(0, MAX_COLUMNS)}`);
        inFile++;
      }
    }
  }
  return { files, hits };
}

const DEF_PATTERNS = [
  /\b(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/i,
  /\b(?:export\s+)?(?:class|interface|type|enum|struct|trait)\s+([a-zA-Z0-9_$]+)/i,
  /\b(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/i,
  /\b(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(/i,
  /\b(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/i,
  /\bfunc\s+(?:\([^)]*\)\s+)?([a-zA-Z0-9_]+)\s*\(/i,
];

function scoreHit(hit, term) {
  const colon1 = hit.indexOf(':');
  const colon2 = hit.indexOf(':', colon1 + 1);
  if (colon1 === -1 || colon2 === -1) return 0;
  const file = hit.slice(0, colon1);
  const line = hit.slice(colon2 + 1).trim();

  if (NOISE.test(file)) return -100;
  if (PROSE.test(file)) return -1;

  // Import lines get low rank
  if (/^(?:import\s+|const\s+.*\s*=\s*require\(|from\s+.*\s+import|include\b|use\s+)/.test(line)) {
    return 0;
  }

  // Definition lines get highest rank
  const termLower = term.toLowerCase();
  for (const pat of DEF_PATTERNS) {
    const m = pat.exec(line);
    if (m && m[1].toLowerCase() === termLower) {
      return 10;
    }
  }

  return 2;
}

// Definitions first, code second, imports third, prose last.
function ranked(found, term = '') {
  const fileOf = hit => hit.slice(0, hit.indexOf(':'));
  const kept = found.filter(hit => !NOISE.test(fileOf(hit)));
  return [...kept]
    .sort((a, b) => scoreHit(b, term) - scoreHit(a, term))
    .slice(0, PER_TERM);
}

export async function scan(cwd, terms, useRg) {
  useRg ??= (await run('rg', ['--version'], cwd)).ok;
  const { files, hits } = await (useRg ? scanWithRg : scanWithWalk)(cwd, terms);
  return {
    files: files.filter(file => !NOISE.test(file)),
    hits: new Map([...hits].map(([term, found]) => [term, ranked(found, term)])),
  };
}

export async function gather(question, cwd, chat) {
  let terms = [];
  try {
    terms = tidy((await chat({ system: TERMS_SYSTEM, user: question, schema: TERMS_SCHEMA })).terms);
  } catch (e) {
    if (e instanceof Unavailable) throw e;
  }
  if (!terms.length) terms = tidy(question.split(/[^\w.-]+/).filter(word => !STOP.has(word.toLowerCase())));

  const { files, hits } = await scan(cwd, terms);
  const sections = [];
  const named = files.filter(file => terms.some(term => file.toLowerCase().includes(term.toLowerCase())));
  if (named.length) {
    sections.push({ cmd: `files named like ${terms.join(', ')}`, out: named.slice(0, MAX_PATHS).join('\n') });
  }
  for (const term of terms) {
    if (hits.get(term).length) sections.push({ cmd: `search "${term}"`, out: hits.get(term).join('\n') });
  }
  if (!sections.length) sections.push({ cmd: `search ${terms.join(', ')}`, out: '(no matches)' });
  return sections;
}
