/**
 * Lightweight BM25 over in-memory documents (local, no deps).
 */

/** @param {string} text */
export function tokenize(text) {
  const raw = String(text || "");
  /** @type {string[]} */
  const out = [];
  // Word-ish tokens including identifiers
  const words = raw.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.length < 2) continue;
    out.push(lower);
    // Split camelCase / PascalCase into parts
    const parts = word.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) || [];
    for (const part of parts) {
      const p = part.toLowerCase();
      if (p.length >= 2 && p !== lower) out.push(p);
    }
    if (lower.length > 6) out.push(lower.slice(0, Math.ceil(lower.length * 0.7)));
  }
  return out;
}

/**
 * @param {Array<{ id: string, text: string }>} docs
 */
export function buildBm25(docs) {
  const N = docs.length || 1;
  /** @type {Map<string, number>} */
  const df = new Map();
  /** @type {Array<{ id: string, tf: Map<string, number>, len: number }>} */
  const postings = [];
  let totalLen = 0;

  for (const doc of docs) {
    const tokens = tokenize(doc.text);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    postings.push({ id: doc.id, tf, len: tokens.length || 1 });
    totalLen += tokens.length || 1;
  }

  const avgdl = totalLen / N;
  const k1 = 1.2;
  const b = 0.75;

  /**
   * @param {string} query
   * @param {number} limit
   */
  function search(query, limit = 20) {
    const qTokens = [...new Set(tokenize(query))];
    if (qTokens.length === 0) return [];
    /** @type {Array<{ id: string, score: number }>} */
    const scored = [];
    for (const doc of postings) {
      let score = 0;
      for (const term of qTokens) {
        const f = doc.tf.get(term) || 0;
        if (!f) continue;
        const n = df.get(term) || 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        const denom = f + k1 * (1 - b + (b * doc.len) / avgdl);
        score += idf * ((f * (k1 + 1)) / denom);
      }
      if (score > 0) scored.push({ id: doc.id, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  return { search, size: docs.length };
}
