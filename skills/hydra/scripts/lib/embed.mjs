// Meaning-based search over a folder of source or notes, using an embedding model served by llama.cpp
// (`llama-server --embedding`). Read-only: files are read, chunked and ranked; nothing is written
// except the index cache under ~/.hydra/index. Results are the files' own lines, verbatim.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { home } from './local.mjs';

// EmbeddingGemma 2 prompts (google/embeddinggemma-2 config_sentence_transformers.json).
export const PROMPTS = {
  code: 'task: code retrieval | query: ',
  search: 'task: search result | query: ',
  document: (title) => `title: ${title || 'none'} | text: `,
};
export const EMBED_URL = (process.env.HYDRA_EMBED_URL ?? 'http://127.0.0.1:11436').replace(/\/$/, '');
const VERSION = 1;
const MAX_CHARS = 4000;

const sha = (data) => createHash('sha256').update(data).digest('hex');

// Overlapping line windows. Plain windows keep this language-agnostic; a chunk never exceeds MAX_CHARS,
// so a minified line cannot blow past the model's context.
export function chunk(file, text, { lines = 40, step = 30 } = {}) {
  const all = text.split('\n');
  const out = [];
  for (let start = 0; start < all.length; start += step) {
    const body = all.slice(start, start + lines).join('\n');
    if (body.trim()) out.push({ file, start: start + 1, end: Math.min(all.length, start + lines), text: body.slice(0, MAX_CHARS) });
    if (start + lines >= all.length) break;
  }
  return out;
}

// Notes (markdown): one chunk per paragraph, list item or table, carrying its heading path, so one long
// Log line is one memory and a heading tells the model where it sits. Items longer than `max` are split
// at sentence ends; every piece keeps the item's line range.
export function chunkMarkdown(file, text, { max = MAX_CHARS } = {}) {
  const lines = text.split('\n');
  const heads = [];
  const out = [];
  let block = null;
  let fence = false;
  const flush = () => {
    if (!block) return;
    const body = block.lines.join('\n').trim();
    const title = heads.filter(Boolean).join(' > ');
    if (body) {
      const pieces = [];
      let rest = body;
      while (rest.length > max) {
        const cut = Math.max(rest.lastIndexOf('. ', max), rest.lastIndexOf('\n', max), max / 2);
        pieces.push(rest.slice(0, cut + 1));
        rest = rest.slice(cut + 1).trimStart();
      }
      pieces.push(rest);
      for (const piece of pieces) out.push({ file, start: block.start, end: block.end, title, text: piece });
    }
    block = null;
  };
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence;
    const heading = !fence && /^(#{1,6})\s+(.*)/.exec(line);
    if (heading) {
      flush();
      heads.length = heading[1].length - 1;
      heads.push(heading[2].trim());
      return;
    }
    const starts = !fence && (/^([-*+]|\d+\.)\s/.test(line) || (/^\|/.test(line) && !/^\|/.test(lines[i - 1] ?? '')));
    if (!fence && !line.trim()) { flush(); return; }
    if (starts || !block) { flush(); block = { start: i + 1, end: i + 1, lines: [] }; }
    block.lines.push(line);
    block.end = i + 1;
  });
  flush();
  return out;
}

const chunkerFor = (file) => /\.(md|markdown|mdx)$/i.test(file) ? 'md1' : 'lines1';
export const chunkAny = (file, text) => chunkerFor(file) === 'md1' ? chunkMarkdown(file, text) : chunk(file, text);

function unit(vector) {
  let n = 0;
  for (const x of vector) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(vector, (x) => x / n);
}

export async function embed(texts, { url = EMBED_URL, batch = 32, timeoutMs = 120000 } = {}) {
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    const res = await fetch(url + '/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: texts.slice(i, i + batch) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`embedding server answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { data } = await res.json();
    for (const row of data.sort((a, b) => a.index - b.index)) out.push(unit(row.embedding));
  }
  return out;
}

// Index for one root. Files whose content hash is unchanged keep their vectors, so re-indexing after an
// edit only embeds the edited files. Stored as JSON metadata plus one Float32 file.
export async function buildIndex(root, files, { url, dir, onProgress } = {}) {
  dir ??= path.join(home(), 'index', sha(path.resolve(root)).slice(0, 16));
  mkdirSync(dir, { recursive: true });
  const metaPath = path.join(dir, 'meta.json');
  const vecPath = path.join(dir, 'vectors.f32');
  let old = { files: {}, chunks: [] };
  let oldVectors = new Float32Array(0);
  if (existsSync(metaPath) && existsSync(vecPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (meta.version === VERSION) { old = meta; const buf = readFileSync(vecPath); oldVectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4); }
    } catch { /* rebuild */ }
  }
  const dim = old.dim ?? 0;
  const keep = new Map();
  old.chunks.forEach((c, i) => { if (!keep.has(c.file)) keep.set(c.file, []); keep.get(c.file).push(i); });
  const chunks = [];
  const vectors = [];
  const pending = [];
  const fileHashes = {};
  for (const file of files) {
    let text;
    try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    // The chunker id is part of the key, so changing how a kind of file is cut re-embeds it.
    const hash = chunkerFor(file) + ':' + sha(text);
    fileHashes[file] = hash;
    if (old.files[file] === hash && keep.has(file) && dim) {
      for (const i of keep.get(file)) { chunks.push(old.chunks[i]); vectors.push(oldVectors.subarray(i * dim, (i + 1) * dim)); }
      continue;
    }
    for (const c of chunkAny(file, text)) {
      chunks.push({ file: c.file, start: c.start, end: c.end, ...(c.title ? { title: c.title } : {}) });
      vectors.push(null);
      pending.push({ at: vectors.length - 1, text: PROMPTS.document(c.title ? `${file} > ${c.title}` : file) + c.text });
    }
  }
  for (let i = 0; i < pending.length; i += 256) {
    const part = pending.slice(i, i + 256);
    const got = await embed(part.map((p) => p.text), { url });
    part.forEach((p, j) => { vectors[p.at] = got[j]; });
    onProgress?.(Math.min(i + 256, pending.length), pending.length);
  }
  const d = vectors[0]?.length ?? dim;
  const flat = new Float32Array(vectors.length * d);
  vectors.forEach((v, i) => flat.set(v, i * d));
  writeFileSync(vecPath + '.tmp', Buffer.from(flat.buffer));
  writeFileSync(metaPath + '.tmp', JSON.stringify({ version: VERSION, root: path.resolve(root), dim: d, files: fileHashes, chunks }));
  renameSync(vecPath + '.tmp', vecPath);
  renameSync(metaPath + '.tmp', metaPath);
  return { dir, dim: d, chunks, vectors: flat, embedded: pending.length };
}

// Cosine ranking (vectors are unit length). Returns chunk indices with scores, best first.
export function rank(query, index, k = 10) {
  const { chunks } = index;
  const scores = similarities(query, index);
  return [...scores.keys()].sort((a, b) => scores[b] - scores[a]).slice(0, k).map((i) => ({ i, score: scores[i], ...chunks[i] }));
}

// A note's date: an ISO date at the start of the note (a Log line `- 2026-11-24: ...`, an IMPROVEMENTS
// entry `- **2026-11-20. ...`), else none. Dates later in the text are references, not the note's own.
export function noteDate(text) {
  return /^\s*(?:[-*+]\s+)?(?:\*\*)?(20\d\d-\d\d-\d\d)\b/.exec(text)?.[1] ?? null;
}

// Memory holds several versions of one fact. When a newer dated note is about as relevant to the query as
// an older one above it (query similarity within `delta`), the newer one moves up past it. Undated notes,
// and notes clearly more relevant than any newer one, keep their place.
export function preferNewer(ids, score, date, { delta = 0.03 } = {}) {
  const out = [...ids];
  for (let b = 1; b < out.length; b++) {
    const j = out[b];
    if (!date[j]) continue;
    let to = b;
    for (let a = b - 1; a >= 0; a--) {
      const i = out[a];
      if (date[i] && date[i] < date[j] && score[j] >= score[i] - delta) to = a;
    }
    if (to < b) { out.splice(b, 1); out.splice(to, 0, j); }
  }
  return out;
}

// Query similarity for every chunk, for re-ranking a list made another way (keyword or fused).
export function similarities(query, index) {
  const { dim, vectors, chunks } = index;
  const scores = new Float32Array(chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    let s = 0;
    const o = i * dim;
    for (let j = 0; j < dim; j++) s += query[j] * vectors[o + j];
    scores[i] = s;
  }
  return scores;
}

export async function search(query, index, { k = 10, mode = 'code', url } = {}) {
  const [q] = await embed([PROMPTS[mode] + query], { url });
  return rank(q, index, k);
}
