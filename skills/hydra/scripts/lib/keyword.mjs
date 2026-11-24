// Keyword ranking (BM25) over chunks, identifiers split on
// case and underscores. `fuse` is reciprocal-rank fusion. Used by `hydra recall` and `hydra search --meaning`.
const STOP = new Set('a an the of to in on for and or is are be it its as at by with from that this which what where how when does do i we our there into than then so if not without one each any can given only all over off up down out has have was were use used using get set why who whom'.split(' '));

export const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)
  .filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

export function bm25(texts) {
  const docs = texts.map((text) => { const tf = new Map(); const ws = words(text); for (const w of ws) tf.set(w, (tf.get(w) ?? 0) + 1); return { tf, len: ws.length }; });
  const df = new Map();
  for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length;
  return (query, k) => {
    const qs = [...new Set(words(query))];
    const scores = docs.map((d) => qs.reduce((s, w) => {
      const f = d.tf.get(w); if (!f) return s;
      const idf = Math.log(1 + (docs.length - df.get(w) + 0.5) / (df.get(w) + 0.5));
      return s + idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * d.len / avg));
    }, 0));
    return [...scores.keys()].sort((a, b) => scores[b] - scores[a]).slice(0, k);
  };
}

export const fuse = (lists, k) => {
  const s = new Map();
  for (const list of lists) list.forEach((i, r) => s.set(i, (s.get(i) ?? 0) + 1 / (60 + r)));
  return [...s.keys()].sort((a, b) => s.get(b) - s.get(a)).slice(0, k);
};
