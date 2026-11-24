// Development benchmark: does meaning-based search find the right code where keyword search does not?
// Corpus: the development-split files of each pinned source release (one "repository" per language).
// Questions: evals/semantic/questions.json (hand-written, no function names). Holdout files are never read.
// Needs `llama-server --embedding` with EmbeddingGemma 2 at HYDRA_EMBED_URL.
// Usage: node evals/semantic/run.mjs [--k 5]
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, chunk, embed, rank, PROMPTS } from '../../skills/hydra/scripts/lib/embed.mjs';
import { bm25, fuse } from '../../skills/hydra/scripts/lib/keyword.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(os.homedir(), '.hydra/quality-sources/files');
const K = Number(process.argv[process.argv.indexOf('--k') + 1]) || 5;
const inventory = JSON.parse(readFileSync(path.join(ROOT, 'evals/suite/source-inventory.json'), 'utf8'));
const { questions } = JSON.parse(readFileSync(path.join(ROOT, 'evals/semantic/questions.json'), 'utf8'));

const devFiles = {};
const decl = new Map();
for (const d of inventory.declarations) {
  if (d.split !== 'development') continue;
  const [release, ...rest] = d.source.split('/');
  (devFiles[release] ??= new Set()).add(rest.join('/'));
  decl.set(d.source + '#' + d.name + '#' + d.line, d);
}

// Gold span: the declaration plus its leading doc comment. Python has endLine; braces give it elsewhere.
function gold(q) {
  const [release, ...rest] = q.source.split('/');
  const file = rest.join('/');
  const ds = [...decl.values()].filter((d) => d.source === q.source && d.name === q.name);
  if (ds.length === 0) throw new Error(`no development declaration ${q.source} ${q.name}`);
  const d = ds[0];
  const lines = readFileSync(path.join(SRC, q.source), 'utf8').split('\n');
  let end = d.endLine;
  if (!end) {
    let depth = 0, seen = false;
    for (let j = d.line - 1; j < Math.min(lines.length, d.line + 200); j++) {
      const t = lines[j].replace(/"(?:\\.|[^"\\])*"|\/\/.*/g, '');
      for (const ch of t) { if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--; }
      if (seen && depth <= 0) { end = j + 1; break; }
    }
    end ??= d.line;
  }
  let start = d.line;
  while (start > 1 && /^\s*(\/\/|\*|\/\*|#\[|@)/.test(lines[start - 2])) start--;
  if (new RegExp(`\\b${q.name.replace(/[$]/g, '\\$')}\\b`).test(q.question)) throw new Error(`question names its function: ${q.name}`);
  return { release, file, start, end };
}


const methods = ['keyword', 'embedding', 'hybrid'];
const rows = [];
const corpora = {};
const started = Date.now();
for (const release of Object.keys(devFiles).sort()) {
  const qs = questions.filter((q) => q.source.startsWith(release + '/'));
  if (qs.length === 0) continue;
  const root = path.join(SRC, release);
  const files = [...devFiles[release]].sort();
  const t0 = Date.now();
  const index = await buildIndex(root, files, { dir: path.join(os.homedir(), '.hydra/index', 'semantic-dev-' + release),
    onProgress: (n, total) => process.stderr.write(`\r${release}: embedded ${n}/${total}   `) });
  process.stderr.write('\n');
  const texts = new Map();
  for (const f of files) for (const c of chunk(f, readFileSync(path.join(root, f), 'utf8'))) texts.set(`${c.file}:${c.start}`, c.text);
  const chunkTexts = index.chunks.map((c) => texts.get(`${c.file}:${c.start}`) ?? '');
  const keyword = bm25(index.chunks.map((c, i) => c.file + '\n' + chunkTexts[i]));
  corpora[release] = { files: files.length, chunks: index.chunks.length, embedded: index.embedded, indexSeconds: (Date.now() - t0) / 1000 };
  const qv = await embed(qs.map((q) => PROMPTS.code + q.question));
  qs.forEach((q, n) => {
    const g = gold(q);
    const lists = { keyword: keyword(q.question, 50), embedding: rank(qv[n], index, 50).map((r) => r.i) };
    lists.hybrid = fuse([lists.keyword, lists.embedding], 50);
    const row = { source: q.source, name: q.name, question: q.question, gold: g };
    for (const m of methods) {
      const hits = lists[m].map((i) => index.chunks[i]);
      const at = hits.findIndex((c) => c.file === g.file && c.start <= g.end && c.end >= g.start);
      const fileAt = hits.findIndex((c) => c.file === g.file);
      const returned = lists[m].slice(0, K).reduce((s, i) => s + chunkTexts[i].length, 0);
      row[m] = { rank: at < 0 ? null : at + 1, fileRank: fileAt < 0 ? null : fileAt + 1, returnedTokens: Math.round(returned / 4),
        top: hits.slice(0, 3).map((c) => `${c.file}:${c.start}-${c.end}`) };
    }
    rows.push(row);
  });
}

const summary = {};
for (const m of methods) {
  const r = rows.map((x) => x[m]);
  const at = (k) => r.filter((x) => x.rank && x.rank <= k).length;
  summary[m] = { hit1: at(1), hit5: at(K), hit10: at(10), file5: r.filter((x) => x.fileRank && x.fileRank <= K).length,
    mrr: +(r.reduce((s, x) => s + (x.rank && x.rank <= 10 ? 1 / x.rank : 0), 0) / r.length).toFixed(3),
    meanReturnedTokens: Math.round(r.reduce((s, x) => s + x.returnedTokens, 0) / r.length) };
}
const byLanguage = {};
for (const release of Object.keys(corpora)) {
  const rs = rows.filter((x) => x.source.startsWith(release + '/'));
  byLanguage[release] = Object.fromEntries(methods.map((m) => [m, `${rs.filter((x) => x[m].rank && x[m].rank <= K).length}/${rs.length}`]));
}
const result = { suite: 'semantic-dev', model: 'embeddinggemma-2 Q8_0 (2188ac1d)', k: K, tasks: rows.length, seconds: (Date.now() - started) / 1000,
  note: `hitK = the gold function's lines are inside one of the top ${K} chunks (40-line windows); file5 = the gold file is among them.`,
  summary, byLanguage, corpora, rows };
writeFileSync(path.join(ROOT, 'evals/results/semantic.json'), JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify({ tasks: rows.length, k: K, summary, byLanguage, corpora }, null, 1));
