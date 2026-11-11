/**
 * Deep local code index: AST-ish chunks + BM25 + hashed embeddings + import graph.
 * Persisted under .vigil/code-index.json (version 2).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildBm25 } from "./bm25.mjs";
import { tokenize } from "./bm25.mjs";
import {
  extractFileFacts,
  buildChunkText,
  pathTokens,
  resolveImportSpec,
} from "./ast-extract.mjs";
import {
  EMBED_DIM,
  buildIdf,
  embedText,
  quantizeVec,
  searchVectors,
  hybridRank,
} from "./local-embed.mjs";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "out",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".vigil-agent",
  "Pods",
  "DerivedData",
]);

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".cs",
  ".md",
  ".json",
]);

const INDEX_DIR = ".vigil";
const INDEX_FILE = "code-index.json";
const INDEX_VERSION = 2;
const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_CHUNKS = 60_000;
const MAX_FILE_BYTES = 350_000;
const BODY_PREVIEW_LINES = 48;

/** @typedef {{ id: string, path: string, startLine: number, endLine: number, kind: string, title: string, text: string, hash: string, vec?: number[], imports?: string[] }} IndexChunk */

/**
 * @typedef {{
 *   cwd: string,
 *   index: object,
 *   bm25: ReturnType<typeof buildBm25> | null,
 *   idf: Map<string, number> | null,
 * }} Memory
 */

/** @type {Memory | null} */
let memory = null;

function indexPath(cwd) {
  return path.join(cwd, INDEX_DIR, INDEX_FILE);
}

function contentHash(content) {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

function shouldIndexFile(filePath) {
  return CODE_EXT.has(path.extname(filePath).toLowerCase());
}

function normRel(rel) {
  return String(rel || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

async function walkFiles(dir, out, maxFiles) {
  if (out.length >= maxFiles) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const dirs = [];
  const files = [];
  for (const entry of entries) {
    const name = entry.name;
    if (name === ".DS_Store") continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      if (name.startsWith(".") && name !== ".vigil" && name !== ".github") continue;
      dirs.push(path.join(dir, name));
    } else if (entry.isFile() && shouldIndexFile(name)) {
      files.push(path.join(dir, name));
    }
  }
  files.sort();
  for (const file of files) {
    if (out.length >= maxFiles) break;
    out.push(file);
  }
  dirs.sort();
  for (const d of dirs) {
    if (out.length >= maxFiles) break;
    await walkFiles(d, out, maxFiles);
  }
}

/**
 * Split a source file into rich symbol-aware chunks.
 * @param {string} relPath
 * @param {string} content
 * @returns {{ chunks: IndexChunk[], edges: Array<[string, string]> }}
 */
export function chunkSource(relPath, content) {
  const rel = normRel(relPath);
  const facts = extractFileFacts(rel, content);
  const lines = facts.lines;
  const tokens = pathTokens(rel);
  /** @type {Array<[string, string]>} */
  const edges = [];
  for (const spec of facts.importSpecs) {
    const resolved = resolveImportSpec(rel, spec);
    if (resolved) edges.push([rel, resolved]);
  }

  /** @type {IndexChunk[]} */
  const chunks = [];
  const pushChunk = (startLine, endLine, kind, title, signature) => {
    const body = lines
      .slice(startLine - 1, Math.min(endLine, startLine - 1 + BODY_PREVIEW_LINES))
      .join("\n");
    if (!String(body).trim() && !signature) return;
    const text = buildChunkText({
      relPath: rel,
      title,
      kind,
      signature,
      body,
      imports: facts.imports,
      pathTokens: tokens,
    });
    chunks.push({
      id: `${rel}:${startLine}-${endLine}:${title}`,
      path: rel,
      startLine,
      endLine,
      kind,
      title,
      text,
      hash: contentHash(text),
      imports: facts.imports.slice(0, 16),
    });
  };

  if (facts.symbols.length === 0) {
    const window = 40;
    for (let i = 0; i < lines.length; i += window) {
      const start = i + 1;
      const end = Math.min(lines.length, i + window);
      pushChunk(start, end, "window", path.basename(rel), "");
    }
  } else {
    for (let i = 0; i < facts.symbols.length; i++) {
      const sym = facts.symbols[i];
      const start = sym.line;
      const next = facts.symbols[i + 1];
      const end = next ? Math.max(start, next.line - 1) : lines.length;
      const cappedEnd = Math.min(end, start + 120);
      pushChunk(start, cappedEnd, sym.kind, sym.title, sym.signature);
    }
  }

  // File overview + import bag for folder/topic hits
  pushChunk(
    1,
    Math.min(36, lines.length),
    "file",
    path.basename(rel),
    `imports: ${facts.importSpecs.slice(0, 10).join(", ")}`,
  );

  return { chunks, edges };
}

/**
 * Attach quantized embedding vectors using corpus IDF.
 * @param {IndexChunk[]} chunks
 */
export function attachEmbeddings(chunks) {
  const tokenDocs = chunks.map((c) => tokenize(c.text));
  const idf = buildIdf(tokenDocs);
  for (let i = 0; i < chunks.length; i++) {
    const vec = embedText(chunks[i].text, idf, EMBED_DIM);
    chunks[i].vec = quantizeVec(vec);
  }
  return idf;
}

function setMemory(cwd, index, idf = null) {
  const chunks = Array.isArray(index?.chunks) ? index.chunks : [];
  const computedIdf =
    idf ||
    (chunks.length
      ? buildIdf(chunks.map((c) => tokenize(c.text)))
      : null);
  memory = {
    cwd: path.resolve(cwd),
    index,
    bm25:
      chunks.length > 0
        ? buildBm25(chunks.map((c) => ({ id: c.id, text: c.text })))
        : null,
    idf: computedIdf,
  };
}

function clearMemory(cwd) {
  if (!cwd || (memory && memory.cwd === path.resolve(cwd))) memory = null;
}

function trimChunks(chunks, maxChunks) {
  if (chunks.length <= maxChunks) return chunks;
  // Prefer symbol chunks over windows/files when capping
  const ranked = [...chunks].sort((a, b) => {
    const rank = (k) =>
      k === "function" || k === "class" || k === "interface"
        ? 0
        : k === "method" || k === "type"
          ? 1
          : k === "file"
            ? 2
            : 3;
    return rank(a.kind) - rank(b.kind);
  });
  return ranked.slice(0, maxChunks);
}

/**
 * @param {string} cwd
 * @param {{ maxFiles?: number, maxChunks?: number, onProgress?: (p: object) => void }} [opts]
 */
export async function buildCodeIndex(cwd, opts = {}) {
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxChunks = opts.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const root = path.resolve(cwd);
  /** @type {string[]} */
  const files = [];
  await walkFiles(root, files, maxFiles);

  /** @type {IndexChunk[]} */
  let chunks = [];
  /** @type {Record<string, { hash: string }>} */
  const fileMap = {};
  /** @type {Array<[string, string]>} */
  const edges = [];
  let indexedFiles = 0;

  for (const abs of files) {
    let content = "";
    try {
      content = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    if (content.length > MAX_FILE_BYTES) continue;
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const hash = contentHash(content);
    fileMap[rel] = { hash };
    const built = chunkSource(rel, content);
    chunks.push(...built.chunks);
    edges.push(...built.edges);
    indexedFiles += 1;
    if (opts.onProgress && indexedFiles % 100 === 0) {
      opts.onProgress({ files: indexedFiles, chunks: chunks.length });
    }
  }

  chunks = trimChunks(chunks, maxChunks);
  const idf = attachEmbeddings(chunks);

  const payload = {
    version: INDEX_VERSION,
    embedDim: EMBED_DIM,
    cwd: root,
    builtAt: Date.now(),
    fileCount: indexedFiles,
    chunkCount: chunks.length,
    files: fileMap,
    edges: edges.slice(0, 80_000),
    chunks,
  };

  const out = indexPath(root);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(payload), "utf8");
  setMemory(root, payload, idf);
  return payload;
}

/**
 * Incremental sync: only rechunk files whose content hash changed.
 * @param {string} cwd
 * @param {{ maxFiles?: number, maxChunks?: number, force?: boolean }} [opts]
 */
export async function syncCodeIndex(cwd, opts = {}) {
  if (opts.force) return buildCodeIndex(cwd, opts);

  const root = path.resolve(cwd);
  const existing = await loadCodeIndex(root);
  if (!existing || existing.version !== INDEX_VERSION) {
    return buildCodeIndex(cwd, opts);
  }

  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxChunks = opts.maxChunks ?? DEFAULT_MAX_CHUNKS;
  /** @type {string[]} */
  const absFiles = [];
  await walkFiles(root, absFiles, maxFiles);

  /** @type {Map<string, string>} rel → content */
  const current = new Map();
  /** @type {Record<string, { hash: string }>} */
  const fileMap = {};
  for (const abs of absFiles) {
    let content = "";
    try {
      content = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    if (content.length > MAX_FILE_BYTES) continue;
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const hash = contentHash(content);
    fileMap[rel] = { hash };
    current.set(rel, content);
  }

  const prevFiles = existing.files || {};
  const changed = [];
  const removed = new Set(Object.keys(prevFiles));
  for (const [rel, meta] of Object.entries(fileMap)) {
    removed.delete(rel);
    if (!prevFiles[rel] || prevFiles[rel].hash !== meta.hash) {
      changed.push(rel);
    }
  }

  if (changed.length === 0 && removed.size === 0) {
    // Touch builtAt lightly? keep as-is; refresh memory
    setMemory(root, existing);
    return existing;
  }

  // If too many files changed, full rebuild is cheaper/cleaner
  if (changed.length > Math.max(80, Object.keys(prevFiles).length * 0.25)) {
    return buildCodeIndex(cwd, opts);
  }

  let chunks = (existing.chunks || []).filter(
    (c) => !removed.has(normRel(c.path)) && !changed.includes(normRel(c.path)),
  );
  let edges = (existing.edges || []).filter(
    ([from]) => !removed.has(from) && !changed.includes(from),
  );

  /** @type {IndexChunk[]} */
  const freshChunks = [];
  for (const rel of changed) {
    const content = current.get(rel);
    if (content == null) continue;
    const built = chunkSource(rel, content);
    freshChunks.push(...built.chunks);
    edges.push(...built.edges);
  }
  chunks.push(...freshChunks);

  chunks = trimChunks(chunks, maxChunks);
  // Reuse prior IDF when possible; only embed fresh (+ any missing) chunks.
  const idf =
    memory?.cwd === root && memory.idf
      ? memory.idf
      : buildIdf(chunks.map((c) => tokenize(c.text)));
  const freshIds = new Set(freshChunks.map((c) => c.id));
  for (const chunk of chunks) {
    if (freshIds.has(chunk.id) || !chunk.vec?.length) {
      chunk.vec = quantizeVec(embedText(chunk.text, idf, EMBED_DIM));
    }
  }
  const payload = {
    version: INDEX_VERSION,
    embedDim: EMBED_DIM,
    cwd: root,
    builtAt: Date.now(),
    fileCount: Object.keys(fileMap).length,
    chunkCount: chunks.length,
    files: fileMap,
    edges: edges.slice(0, 80_000),
    chunks,
  };
  const out = indexPath(root);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(payload), "utf8");
  setMemory(root, payload, idf);
  return payload;
}

/** @param {string} cwd */
export async function loadCodeIndex(cwd) {
  const root = path.resolve(cwd);
  if (memory?.cwd === root && memory.index) return memory.index;
  const file = indexPath(root);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (
      (parsed?.version === INDEX_VERSION || parsed?.version === 1) &&
      Array.isArray(parsed.chunks)
    ) {
      // Upgrade v1 on the fly for search (no vec → BM25 only until rebuild)
      setMemory(root, parsed);
      return parsed;
    }
  } catch {
    /* missing */
  }
  return null;
}

/**
 * @param {string} cwd
 * @param {{ force?: boolean, maxAgeMs?: number }} [opts]
 */
export async function ensureCodeIndex(cwd, opts = {}) {
  const force = !!opts.force;
  if (force) return buildCodeIndex(cwd);
  const existing = await loadCodeIndex(cwd);
  if (!existing) return buildCodeIndex(cwd);
  if (existing.version !== INDEX_VERSION) return buildCodeIndex(cwd);
  // Prefer incremental sync over blind age rebuild
  return syncCodeIndex(cwd);
}

/**
 * @param {string} cwd
 * @param {string} relPath
 * @param {string | null} content
 */
export async function upsertIndexedFile(cwd, relPath, content) {
  const root = path.resolve(cwd);
  const rel = normRel(relPath);
  let index = await loadCodeIndex(root);
  if (!index || index.version !== INDEX_VERSION) {
    index = await buildCodeIndex(root);
  }

  let nextChunks = (index.chunks || []).filter((c) => normRel(c.path) !== rel);
  let nextEdges = (index.edges || []).filter(([from]) => from !== rel);
  const files = { ...(index.files || {}) };

  /** @type {IndexChunk[]} */
  let fresh = [];
  if (content != null && shouldIndexFile(rel) && content.length <= MAX_FILE_BYTES) {
    const built = chunkSource(rel, content);
    fresh = built.chunks;
    nextChunks.push(...fresh);
    nextEdges.push(...built.edges);
    files[rel] = { hash: contentHash(content) };
  } else {
    delete files[rel];
  }

  nextChunks = trimChunks(nextChunks, DEFAULT_MAX_CHUNKS);
  // Fast path: reuse corpus IDF and only embed the new file's chunks.
  const idf =
    memory?.cwd === root && memory.idf
      ? memory.idf
      : buildIdf(nextChunks.map((c) => tokenize(c.text)));
  for (const chunk of fresh) {
    chunk.vec = quantizeVec(embedText(chunk.text, idf, EMBED_DIM));
  }
  // Ensure trimmed-in chunks without vectors still get one
  for (const chunk of nextChunks) {
    if (!chunk.vec?.length) {
      chunk.vec = quantizeVec(embedText(chunk.text, idf, EMBED_DIM));
    }
  }
  const payload = {
    ...index,
    version: INDEX_VERSION,
    embedDim: EMBED_DIM,
    builtAt: Date.now(),
    fileCount: Object.keys(files).length,
    chunkCount: nextChunks.length,
    files,
    edges: nextEdges.slice(0, 80_000),
    chunks: nextChunks,
  };
  const out = indexPath(root);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(payload), "utf8");
  setMemory(root, payload, idf);
  return {
    ok: true,
    path: rel,
    chunkCount: nextChunks.filter((c) => c.path === rel).length,
    totalChunks: nextChunks.length,
  };
}

/** @param {string} cwd */
export async function getCodeIndexStatus(cwd) {
  const root = path.resolve(cwd);
  const file = indexPath(root);
  try {
    const st = await fs.stat(file);
    const index = await loadCodeIndex(root);
    const withVec = (index?.chunks || []).filter((c) => c.vec?.length).length;
    return {
      ok: true,
      ready: !!index,
      path: file,
      version: index?.version ?? null,
      builtAt: index?.builtAt ?? null,
      fileCount: index?.fileCount ?? 0,
      chunkCount: index?.chunkCount ?? 0,
      vectorCount: withVec,
      edgeCount: Array.isArray(index?.edges) ? index.edges.length : 0,
      sizeBytes: st.size,
      ageMs: index?.builtAt ? Date.now() - Number(index.builtAt) : null,
      deep: index?.version === INDEX_VERSION && withVec > 0,
    };
  } catch {
    return {
      ok: true,
      ready: false,
      path: file,
      version: null,
      builtAt: null,
      fileCount: 0,
      chunkCount: 0,
      vectorCount: 0,
      edgeCount: 0,
      sizeBytes: 0,
      ageMs: null,
      deep: false,
    };
  }
}

/**
 * Neighbor files via import graph (1-hop).
 * @param {object} index
 * @param {string[]} seedPaths
 */
export function importNeighbors(index, seedPaths) {
  /** @type {Set<string>} */
  const out = new Set();
  const seeds = new Set(seedPaths.map(normRel));
  const edges = index?.edges || [];
  for (const edge of edges) {
    const [from, to] = edge;
    if (seeds.has(from)) out.add(to);
    if (seeds.has(to)) out.add(from);
    // also match prefix (resolved without extension)
    for (const seed of seeds) {
      if (to.startsWith(seed) || seed.startsWith(to)) {
        out.add(from);
        out.add(to);
      }
    }
  }
  return out;
}

/**
 * Hybrid BM25 + vector + symbol + import-graph search.
 * @param {object} index
 * @param {string} query
 * @param {number} [limit]
 */
export function searchCodeIndex(index, query, limit = 20) {
  const chunks = Array.isArray(index?.chunks) ? index.chunks : [];
  if (chunks.length === 0) {
    return { hits: [], note: "Index empty", mode: "empty" };
  }

  let bm25 = memory?.index === index ? memory.bm25 : null;
  if (!bm25) {
    bm25 = buildBm25(chunks.map((c) => ({ id: c.id, text: c.text })));
  }
  const idf =
    memory?.index === index && memory.idf
      ? memory.idf
      : buildIdf(chunks.map((c) => tokenize(c.text)));

  const bm25Hits = bm25.search(query, limit * 3);
  const hasVectors = chunks.some((c) => c.vec?.length);
  const vectorHits = hasVectors
    ? searchVectors(chunks, query, limit * 3, idf)
    : [];

  // Seed import-neighborhood from top lexical hits
  const seedPaths = bm25Hits
    .slice(0, 8)
    .map((h) => chunks.find((c) => c.id === h.id)?.path)
    .filter(Boolean);
  const neighbors = importNeighbors(index, seedPaths);

  const hits = hybridRank({
    chunks,
    bm25Hits,
    vectorHits,
    query,
    importNeighbors: neighbors,
    limit,
  });

  const mode = hasVectors ? "hybrid-bm25-vector" : "bm25";
  return {
    hits,
    note: `Deep local index (${mode}) · ${index.fileCount || 0} files · ${index.chunkCount || chunks.length} chunks · ${Array.isArray(index.edges) ? index.edges.length : 0} import edges`,
    mode,
  };
}

/** Compact project orientation map for the agent. */
export function formatProjectMap(index, limit = 40) {
  const files = Object.keys(index?.files || {}).sort();
  if (files.length === 0 && Array.isArray(index?.chunks)) {
    const set = new Set(index.chunks.map((c) => c.path));
    files.push(...[...set].sort());
  }
  const top = files.slice(0, limit);
  const lines = [
    `### Project map (${files.length} indexed files, showing ${top.length})`,
    ...top.map((f) => `- ${f}`),
  ];
  if (files.length > top.length) {
    lines.push(`- … +${files.length - top.length} more`);
  }
  return lines.join("\n");
}

/** Format hits for the agent. */
export function formatIndexHits(query, result) {
  const lines = [
    `### Deep local search for "${query}"`,
    result.note || "",
    "",
  ];
  if (!result.hits?.length) {
    lines.push("(no index hits)");
    return lines.join("\n");
  }
  for (const hit of result.hits) {
    const preview = String(hit.text || "")
      .split("\n")
      .slice(2, 10)
      .join("\n")
      .slice(0, 450);
    const mix =
      hit.bm25 != null || hit.vec != null
        ? ` · bm25=${(hit.bm25 ?? 0).toFixed(2)} vec=${(hit.vec ?? 0).toFixed(2)}`
        : "";
    lines.push(
      `#### ${hit.title} (${hit.kind}) · ${hit.path}:${hit.startLine}-${hit.endLine} · score=${hit.score.toFixed(3)}${mix}`,
    );
    if (hit.imports?.length) {
      lines.push(`imports: ${hit.imports.slice(0, 8).join(", ")}`);
    }
    lines.push("```");
    lines.push(preview || hit.text.slice(0, 300));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

export { clearMemory, shouldIndexFile, INDEX_VERSION, DEFAULT_MAX_FILES };
