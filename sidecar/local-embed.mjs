/**
 * Local dense embeddings via IDF-weighted feature hashing (no model download).
 * Hybrid with BM25 for deep codebase search on large repos.
 */

import { createHash } from "node:crypto";
import { tokenize } from "./bm25.mjs";

export const EMBED_DIM = 96;

/**
 * @param {string} term
 * @param {number} dim
 */
function hashBucket(term, dim) {
  const digest = createHash("sha1").update(term).digest();
  const bucket = digest.readUInt32BE(0) % dim;
  const sign = digest[4] & 1 ? 1 : -1;
  return { bucket, sign };
}

/**
 * Build corpus IDF from tokenized docs.
 * @param {string[][]} tokenDocs
 */
export function buildIdf(tokenDocs) {
  const N = tokenDocs.length || 1;
  /** @type {Map<string, number>} */
  const df = new Map();
  for (const tokens of tokenDocs) {
    const uniq = new Set(tokens);
    for (const t of uniq) df.set(t, (df.get(t) || 0) + 1);
  }
  /** @type {Map<string, number>} */
  const idf = new Map();
  for (const [t, n] of df) {
    idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }
  return idf;
}

/**
 * @param {string} text
 * @param {Map<string, number>} idf
 * @param {number} [dim]
 * @returns {Float32Array}
 */
export function embedText(text, idf, dim = EMBED_DIM) {
  const tokens = tokenize(text);
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const vec = new Float32Array(dim);
  for (const [term, count] of tf) {
    const w = (1 + Math.log(count)) * (idf.get(term) ?? 1.2);
    const { bucket, sign } = hashBucket(term, dim);
    vec[bucket] += sign * w;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return vec;
}

/** Quantize to Int8 for disk. */
export function quantizeVec(vec) {
  /** @type {number[]} */
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round(vec[i] * 127)));
  }
  return out;
}

/** @param {number[] | Float32Array} q */
export function dequantizeVec(q) {
  const vec = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) vec[i] = Number(q[i]) / 127;
  // re-normalize after quantization noise
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/**
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
export function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * @param {Array<{ id: string, text: string, vec?: number[] }>} chunks
 * @param {string} query
 * @param {number} limit
 * @param {Map<string, number> | null} [idf]
 */
export function searchVectors(chunks, query, limit, idf = null) {
  const effectiveIdf = idf || buildIdf(chunks.map((c) => tokenize(c.text)));
  const qVec = embedText(query, effectiveIdf);
  /** @type {Array<{ id: string, score: number }>} */
  const scored = [];
  for (const chunk of chunks) {
    if (!chunk.vec || !chunk.vec.length) continue;
    const score = cosine(qVec, dequantizeVec(chunk.vec));
    if (score > 0.05) scored.push({ id: chunk.id, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Merge BM25 + vector ranks with symbol/path boosts.
 * @param {object} opts
 */
export function hybridRank({
  chunks,
  bm25Hits,
  vectorHits,
  query,
  importNeighbors,
  limit = 20,
}) {
  const q = String(query || "").trim().toLowerCase();
  const byId = new Map(chunks.map((c) => [c.id, c]));
  /** @type {Map<string, { bm25: number, vec: number }>} */
  const scores = new Map();

  const maxBm = Math.max(1e-6, ...bm25Hits.map((h) => h.score), 1e-6);
  for (const h of bm25Hits) {
    const row = scores.get(h.id) || { bm25: 0, vec: 0 };
    row.bm25 = h.score / maxBm;
    scores.set(h.id, row);
  }
  const maxVec = Math.max(1e-6, ...vectorHits.map((h) => h.score), 1e-6);
  for (const h of vectorHits) {
    const row = scores.get(h.id) || { bm25: 0, vec: 0 };
    row.vec = h.score / maxVec;
    scores.set(h.id, row);
  }

  /** @type {Array<{ id: string, score: number, bm25: number, vec: number }>} */
  const merged = [];
  for (const [id, parts] of scores) {
    const chunk = byId.get(id);
    if (!chunk) continue;
    let score = 0.55 * parts.bm25 + 0.45 * parts.vec;
    if (chunk.title?.toLowerCase() === q) score += 0.35;
    else if (chunk.title?.toLowerCase().includes(q)) score += 0.15;
    if (chunk.path?.toLowerCase().includes(q)) score += 0.1;
    if (chunk.kind === "function" || chunk.kind === "class") score += 0.03;
    if (importNeighbors?.has?.(chunk.path)) score += 0.08;
    merged.push({
      id,
      score,
      bm25: parts.bm25,
      vec: parts.vec,
    });
  }

  return merged
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => {
      const chunk = byId.get(row.id);
      return { ...chunk, score: row.score, bm25: row.bm25, vec: row.vec };
    });
}
