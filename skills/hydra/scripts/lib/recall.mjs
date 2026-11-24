// `hydra recall` (a project's markdown notes) and `hydra search --meaning` (its source), ranked by
// EmbeddingGemma 2 and BM25 together. Read-only: files are read and an index cache is written under
// ~/.hydra/index. The result is the files' own lines with file:line; nothing is paraphrased.
import { readFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildIndex, chunkAny, embed, rank, similarities, noteDate, preferNewer, PROMPTS } from './embed.mjs';
import { bm25, fuse } from './keyword.mjs';
import { home, localConfig, ensureEmbed, embedModelPath, EMBED_PORT } from './local.mjs';
import { walk } from './files.mjs';
import { Unavailable } from './runtime.mjs';

export const manifestEmbed = () =>
  JSON.parse(readFileSync(new URL('../runtime-manifest.json', import.meta.url), 'utf8')).embed;

const NOTES = /\.(md|mdx|markdown)$/i;
const CODE = /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts|py|go|rs|java|kt|kts|rb|php|c|h|cc|cpp|cxx|hpp|cs|swift|scala|sh|bash|zsh|lua|sql|vue|svelte|dart|ex|exs|erl|hs|ml|clj|r|jl|zig|nim|pl|ps1)$/i;
const LIMITS = { notes: { bytes: 1024 * 1024, files: 2000 }, code: { bytes: 512 * 1024, files: 8000 } };

// Tracked and untracked-but-not-ignored files when the folder is a git work tree; otherwise the files
// head's walker (skips dot folders, node_modules, build output and the like).
export async function listFiles(root, kind) {
  const want = kind === 'notes' ? NOTES : CODE;
  let all;
  try {
    all = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0').filter(Boolean);
  } catch {
    all = [];
    for await (const file of walk(root)) all.push(file);
  }
  const out = [];
  for (const file of [...new Set(all)].sort()) {
    if (!want.test(file) || /(^|\/)(node_modules|vendor|dist|build)\//.test(file) || /\.min\.\w+$/.test(file)) continue;
    try { if (statSync(path.join(root, file)).size > LIMITS[kind].bytes) continue; } catch { continue; }
    out.push(file);
    if (out.length >= LIMITS[kind].files) break;
  }
  return out;
}

async function embedUrl() {
  if (process.env.HYDRA_EMBED_URL) return process.env.HYDRA_EMBED_URL.replace(/\/$/, '');
  const artifact = manifestEmbed();
  const modelPath = embedModelPath(artifact.sha256);
  if (!existsSync(modelPath)) throw new Unavailable('EmbeddingGemma 2 is not installed; run `hydra embed install` (downloads about 310 MB) or use your own search');
  try { await ensureEmbed(localConfig(), modelPath); }
  catch (error) { throw new Unavailable(error.message); }
  return `http://127.0.0.1:${EMBED_PORT}`;
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Ranked chunks for a question. kind 'notes': newer dated notes move up when about as relevant. */
export async function query(root, question, { kind = 'notes', k = kind === 'notes' ? 5 : 3, onProgress } = {}) {
  root = path.resolve(root);
  const files = await listFiles(root, kind);
  if (files.length === 0) return { files: 0, chunks: 0, hits: [], rawChars: 0 };
  const url = await embedUrl();
  const index = await buildIndex(root, files, { url, onProgress, dir: path.join(home(), 'index', sha(`${kind}:${root}`).slice(0, 16)) });

  const texts = new Map();
  const sizes = new Map();
  for (const file of files) {
    let text;
    try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    sizes.set(file, text.length);
    for (const c of chunkAny(file, text)) {
      const key = `${c.file}:${c.start}:${c.title ?? ''}`;
      if (!texts.has(key)) texts.set(key, []);
      texts.get(key).push(c.text);
    }
  }
  const seen = new Map();
  const chunkText = index.chunks.map((c) => {
    const key = `${c.file}:${c.start}:${c.title ?? ''}`;
    const i = seen.get(key) ?? 0;
    seen.set(key, i + 1);
    return texts.get(key)?.[i] ?? '';
  });
  const keyword = bm25(index.chunks.map((c, i) => `${c.title ?? c.file}\n${chunkText[i]}`));
  const [vector] = await embed([(kind === 'notes' ? PROMPTS.search : PROMPTS.code) + question], { url });
  let ranked = fuse([keyword(question, 50), rank(vector, index, 50).map((r) => r.i)], 50);
  if (kind === 'notes') ranked = preferNewer(ranked, similarities(vector, index), chunkText.map(noteDate));

  const hits = [];
  const taken = new Set();
  for (const i of ranked) {
    const c = index.chunks[i];
    const key = `${c.file}:${c.start}-${c.end}`;
    if (taken.has(key)) continue;
    taken.add(key);
    hits.push({ file: c.file, start: c.start, end: c.end, title: c.title });
    if (hits.length >= k) break;
  }
  const rawChars = [...new Set(hits.map((h) => h.file))].reduce((s, f) => s + (sizes.get(f) ?? 0), 0);
  return { files: files.length, chunks: index.chunks.length, hits, rawChars };
}

/** The hits as verbatim lines, each under a `file:start-end` header. */
export function render(root, result, { kind = 'notes' } = {}) {
  if (result.files === 0) return kind === 'notes' ? 'No markdown notes found here.' : 'No source files found here.';
  const cache = new Map();
  const lines = (file) => {
    if (!cache.has(file)) cache.set(file, readFileSync(path.join(root, file), 'utf8').split('\n'));
    return cache.get(file);
  };
  const what = kind === 'notes'
    ? `Best matches in ${result.files} note file${result.files === 1 ? '' : 's'}, best first (newer notes first when about as relevant). Lines are verbatim:`
    : `Best matches by meaning in ${result.files} source file${result.files === 1 ? '' : 's'}, best first. Lines are verbatim:`;
  const blocks = result.hits.map((h) => {
    const where = h.start === h.end ? `${h.file}:${h.start}` : `${h.file}:${h.start}-${h.end}`;
    return `${where}${h.title ? `  (${h.title})` : ''}\n${lines(h.file).slice(h.start - 1, h.end).join('\n')}`;
  });
  return [what, ...blocks].join('\n\n');
}
