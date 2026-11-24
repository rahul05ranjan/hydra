// Development benchmark: can an agent recall the right note from this repository's own memory files
// (TRACKER.md and friends) without reading them whole? Compares keyword BM25, EmbeddingGemma 2 and their
// fusion on the same markdown chunks, and the tokens returned against reading the files.
// Needs `llama-server --embedding` with EmbeddingGemma 2 at HYDRA_EMBED_URL.
// Usage: node evals/memory/run.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, chunkMarkdown, embed, rank, noteDate, preferNewer, similarities, PROMPTS } from '../../skills/hydra/scripts/lib/embed.mjs';
import { bm25, fuse } from '../../skills/hydra/scripts/lib/keyword.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SET = process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : 'questions';
const DELTA = Number(process.env.HYDRA_RECALL_DELTA ?? 0.03);
const { files, questions } = JSON.parse(readFileSync(path.join(ROOT, `evals/memory/${SET}.json`), 'utf8'));
const started = Date.now();

const all = files.flatMap((f) => chunkMarkdown(f, readFileSync(path.join(ROOT, f), 'utf8')));
const fileTokens = Math.round(files.reduce((s, f) => s + readFileSync(path.join(ROOT, f), 'utf8').length, 0) / 4);
for (const q of questions) {
  for (const phrase of [q.gold, ...(q.also ?? [])]) if (!all.some((c) => c.text.includes(phrase))) throw new Error(`phrase not in the notes: ${phrase}`);
  q.goldChunks = all.filter((c) => c.text.includes(q.gold)).length;
}
const answers = (q, text, strict) => text.includes(q.gold) || (!strict && (q.also ?? []).some((p) => text.includes(p)));

const t0 = Date.now();
const index = await buildIndex(ROOT, files, { dir: path.join(os.homedir(), '.hydra/index', 'memory-dev-hydra') });
const indexSeconds = (Date.now() - t0) / 1000;
const key = (c) => `${c.file}:${c.start}:${c.title ?? ''}`;
const byKey = new Map();
for (const c of all) { if (!byKey.has(key(c))) byKey.set(key(c), []); byKey.get(key(c)).push(c.text); }
const seen = new Map();
const texts = index.chunks.map((c) => { const k = key(c); const i = seen.get(k) ?? 0; seen.set(k, i + 1); return byKey.get(k)?.[i] ?? ''; });
const keyword = bm25(index.chunks.map((c, i) => (c.title ?? '') + '\n' + texts[i]));

const modes = { search: PROMPTS.search, qa: 'task: question answering | query: ' };
const vectors = {};
for (const [m, prefix] of Object.entries(modes)) vectors[m] = await embed(questions.map((q) => prefix + q.question));
const dates = texts.map(noteDate);
const methods = ['keyword', 'embedding-search', 'embedding-qa', 'hybrid', 'hybrid-newer'];
const rows = questions.map((q, n) => {
  const lists = {
    keyword: keyword(q.question, 30),
    'embedding-search': rank(vectors.search[n], index, 30).map((r) => r.i),
    'embedding-qa': rank(vectors.qa[n], index, 30).map((r) => r.i),
  };
  lists.hybrid = fuse([lists.keyword, lists['embedding-search']], 30);
  lists['hybrid-newer'] = preferNewer(lists.hybrid, similarities(vectors.search[n], index), dates, { delta: DELTA });
  const row = { question: q.question, gold: q.gold, goldChunks: q.goldChunks };
  for (const m of methods) {
    const at = lists[m].findIndex((i) => answers(q, texts[i], false));
    const strict = lists[m].findIndex((i) => answers(q, texts[i], true));
    row[m] = { rank: at < 0 ? null : at + 1, strictRank: strict < 0 ? null : strict + 1, top: lists[m].slice(0, 2).map((i) => `${index.chunks[i].file}:${index.chunks[i].start}`),
      tokens3: Math.round(lists[m].slice(0, 3).reduce((s, i) => s + texts[i].length, 0) / 4),
      tokens5: Math.round(lists[m].slice(0, 5).reduce((s, i) => s + texts[i].length, 0) / 4) };
  }
  return row;
});

const summary = {};
for (const m of methods) {
  const r = rows.map((x) => x[m]);
  const at = (k) => r.filter((x) => x.rank && x.rank <= k).length;
  summary[m] = { hit1: at(1), hit3: at(3), hit5: at(5), hit10: at(10), strictHit5: r.filter((x) => x.strictRank && x.strictRank <= 5).length,
    mrr: +(r.reduce((s, x) => s + (x.rank && x.rank <= 10 ? 1 / x.rank : 0), 0) / r.length).toFixed(3),
    meanTokensTop3: Math.round(r.reduce((s, x) => s + x.tokens3, 0) / r.length),
    meanTokensTop5: Math.round(r.reduce((s, x) => s + x.tokens5, 0) / r.length) };
}
const result = { suite: 'memory-dev', set: SET, delta: DELTA, datedChunks: dates.filter(Boolean).length, model: 'embeddinggemma-2 Q8_0 (2188ac1d)', tasks: rows.length, files, chunks: index.chunks.length,
  fileTokens, indexSeconds, seconds: (Date.now() - started) / 1000,
  note: 'hitK = a chunk containing the gold phrase is among the top K. Tokens are characters / 4; fileTokens is reading every file whole.',
  summary, rows };
writeFileSync(path.join(ROOT, `evals/results/memory${SET === 'questions' ? '' : '-' + SET}.json`), JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify({ tasks: rows.length, chunks: index.chunks.length, fileTokens, indexSeconds, summary }, null, 1));
