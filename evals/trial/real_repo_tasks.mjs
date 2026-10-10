import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const REPOS = {
  vasuki: path.join(os.homedir(), 'Desktop/code/vasuki'),
  dhruv: path.join(os.homedir(), 'Desktop/code/dhruv-cli'),
};
// Fixed before any Hydra/model evaluation. These are real source functions, not generated examples.
export const CASES = [
  { id: 'python_cast', repo: 'vasuki', file: 'src/vasuki/expr.py', symbol: 'cast_value' },
  { id: 'python_join', repo: 'vasuki', file: 'src/vasuki/ops.py', symbol: '_join' },
  { id: 'typescript_config', repo: 'dhruv', file: 'src/commands/health.ts', symbol: 'checkConfiguration' },
  { id: 'typescript_ingestion', repo: 'dhruv', file: 'src/core/committed-range.ts', symbol: 'ingestCommittedRange' },
];
export const sha = text => createHash('sha256').update(text).digest('hex');
export const SCHEMA = {
  type: 'object', properties: { file: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' }, source: { type: 'string' } },
  required: ['file', 'startLine', 'endLine', 'source'], additionalProperties: false,
};

function sourceFiles(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const relative = path.join(prefix, entry.name), full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return entry.name.startsWith('.') || ['__pycache__', 'node_modules'].includes(entry.name) ? [] : sourceFiles(full, relative);
    return entry.isFile() && /\.(py|ts|tsx|js|mjs)$/.test(entry.name) ? [relative] : [];
  });
}

function pythonGold(full, symbol) {
  // Python's parser supplies boundaries independently of Hydra's reader.
  const script = 'import ast,json,pathlib,sys\np=pathlib.Path(sys.argv[1]);s=p.read_text();n=next(n for n in ast.parse(s).body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name==sys.argv[2]);print(json.dumps({"startLine":n.lineno,"endLine":n.end_lineno,"source":"\\n".join(s.splitlines()[n.lineno-1:n.end_lineno])}))';
  return JSON.parse(execFileSync('python3', ['-c', script, full, symbol], { encoding: 'utf8' }));
}

function typescriptGold(full, symbol) {
  const require = createRequire(path.join(REPOS.dhruv, 'package.json'));
  const ts = require('typescript');
  const text = readFileSync(full, 'utf8');
  const sourceFile = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true);
  const declaration = sourceFile.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === symbol);
  if (!declaration) throw new Error(`Missing TypeScript function ${symbol}`);
  const start = declaration.getStart(sourceFile), end = declaration.getEnd();
  return { startLine: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
    endLine: sourceFile.getLineAndCharacterOfPosition(end - 1).line + 1, source: text.slice(start, end).replace(/\r\n/g, '\n') };
}

export function prepareSources(directory) {
  const snapshots = path.join(directory, 'sources');
  const provenance = {};
  for (const [name, root] of Object.entries(REPOS)) {
    const selected = sourceFiles(path.join(root, 'src'));
    provenance[name] = { originalRoot: root, files: [], totalLines: 0 };
    for (const file of selected) {
      const full = path.join(root, 'src', file), relative = path.join('src', file);
      const bytes = readFileSync(full);
      const to = path.join(snapshots, name, relative);
      mkdirSync(path.dirname(to), { recursive: true }); writeFileSync(to, bytes);
      const lines = bytes.toString().split('\n').length;
      provenance[name].totalLines += lines;
      provenance[name].files.push({ file: relative, bytes: bytes.length, lines, sha256: sha(bytes) });
    }
    try { provenance[name].head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); }
    catch { provenance[name].head = null; }
  }
  const tasks = CASES.map(c => {
    const full = path.join(snapshots, c.repo, c.file);
    const text = readFileSync(full, 'utf8');
    const expected = { file: c.file, ...(c.file.endsWith('.py') ? pythonGold(full, c.symbol) : typescriptGold(full, c.symbol)) };
    return { ...c, schema: SCHEMA, expected, sourceFileHash: sha(text), sourceFileLines: text.split('\n').length,
      request: `Locate the definition of ${c.symbol} in this project's source. Return its repository-relative filename, 1-based first and last source line numbers, and complete function source exactly as written. Start at the def/async/function declaration (include export if present), omit decorators and comments before that declaration, include every nested function, body comment and docstring, and stop at the function's last body line/closing brace. Preserve indentation and blank lines inside the function. Use LF line separators, no code fences and no trailing newline.` };
  });
  writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify(provenance, null, 2));
  return { snapshots, tasks, provenance };
}

export function copyWorkspace(snapshot, to) {
  cpSync(snapshot, to, { recursive: true });
  // A repo boundary prevents discovering project skills from parent directories.
  execFileSync('git', ['init', '-q', '--initial-branch=trial'], { cwd: to });
  writeFileSync(path.join(to, '.git/info/exclude'), '.claude/\n');
}

export function unchanged(workspace, provenance) {
  return provenance.files.every(f => { try {
    const full = path.join(workspace, f.file);
    return statSync(full).isFile() && sha(readFileSync(full)) === f.sha256;
  } catch { return false; } });
}

export function treeDigest(dir) {
  const walk = root => readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e =>
    e.isDirectory() ? walk(path.join(root, e.name)) : e.isFile() ? [[path.relative(dir, path.join(root, e.name)), sha(readFileSync(path.join(root, e.name)))]] : []);
  return sha(JSON.stringify(walk(dir)));
}
