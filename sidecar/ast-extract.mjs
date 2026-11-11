/**
 * Lightweight multi-language symbol / import extraction (no tree-sitter dep).
 * Tuned for TS/JS/Python/Rust/Go — good enough for deep local indexing.
 */

const IMPORT_RE = [
  // JS/TS
  /^\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/,
  /^\s*export\s+(?:type\s+)?\*\s+from\s+['"]([^'"]+)['"]/,
  /^\s*const\s+\w+\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/,
  // Python
  /^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/,
  // Rust
  /^\s*use\s+([a-zA-Z0-9_:{}\s,*]+);/,
  // Go
  /^\s*import\s+(?:\(\s*)?["']([^"']+)["']/,
];

const SYMBOL_PATTERNS = [
  {
    kind: "function",
    re: /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "class",
    re: /\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "interface",
    re: /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "type",
    re: /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/,
  },
  {
    kind: "enum",
    re: /\b(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "const",
    re: /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
  },
  // Arrow / assigned function
  {
    kind: "function",
    re: /\b(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
  },
  // Python
  {
    kind: "function",
    re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/,
  },
  {
    kind: "class",
    re: /^\s*class\s+([A-Za-z_][\w]*)\s*[:(]/,
  },
  // Rust
  {
    kind: "function",
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*[<(]/,
  },
  {
    kind: "struct",
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_][\w]*)/,
  },
  {
    kind: "enum",
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_][\w]*)/,
  },
  // Go
  {
    kind: "function",
    re: /^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z_][\w]*)\s*\(/,
  },
  {
    kind: "type",
    re: /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface|func)/,
  },
];

const METHOD_RE =
  /^\s+(?:public\s+|private\s+|protected\s+|async\s+|static\s+)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/;

/**
 * @param {string} line
 * @returns {string | null}
 */
export function extractImportTarget(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) return null;
  for (const re of IMPORT_RE) {
    const m = trimmed.match(re);
    if (!m) continue;
    const raw = (m[1] || m[2] || "").trim();
    if (!raw) continue;
    // Rust use foo::bar::{Baz, Qux} → foo::bar
    if (raw.includes("::")) {
      return raw.split("{")[0].replace(/::$/, "").trim();
    }
    return raw.replace(/;+$/, "");
  }
  return null;
}

/**
 * Resolve relative import to a normalized project-relative path guess (no ext).
 * @param {string} fromFile
 * @param {string} spec
 */
export function resolveImportSpec(fromFile, spec) {
  const s = String(spec || "").trim();
  if (!s || !(s.startsWith("./") || s.startsWith("../"))) return null;
  const dir = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/"))
    : "";
  const parts = `${dir}/${s}`.split("/");
  /** @type {string[]} */
  const stack = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  return stack.join("/");
}

/**
 * @param {string} relPath
 * @param {string} content
 */
export function extractFileFacts(relPath, content) {
  const lines = String(content || "").split(/\r?\n/);
  /** @type {string[]} */
  const imports = [];
  /** @type {string[]} */
  const importSpecs = [];
  /** @type {Array<{ line: number, title: string, kind: string, signature: string }>} */
  const symbols = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const imp = extractImportTarget(line);
    if (imp) {
      importSpecs.push(imp);
      const resolved = resolveImportSpec(relPath, imp);
      if (resolved) imports.push(resolved);
      else imports.push(imp);
    }

    for (const pat of SYMBOL_PATTERNS) {
      const m = line.match(pat.re);
      if (!m) continue;
      const title = m[1];
      const key = `${pat.kind}:${title}:${i + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({
        line: i + 1,
        title,
        kind: pat.kind,
        signature: line.trim().slice(0, 160),
      });
      break;
    }

    // Class methods (indent) — only if we already saw a class above
    if (symbols.some((s) => s.kind === "class" && s.line < i + 1)) {
      const mm = line.match(METHOD_RE);
      if (
        mm &&
        !/^(if|for|while|switch|catch|return|function|class)\b/.test(mm[1])
      ) {
        const title = mm[1];
        const key = `method:${title}:${i + 1}`;
        if (!seen.has(key) && title.length > 1) {
          seen.add(key);
          symbols.push({
            line: i + 1,
            title,
            kind: "method",
            signature: line.trim().slice(0, 160),
          });
        }
      }
    }
  }

  return {
    imports: [...new Set(imports)].slice(0, 40),
    importSpecs: [...new Set(importSpecs)].slice(0, 40),
    symbols: symbols.slice(0, 200),
    lineCount: lines.length,
    lines,
  };
}

/**
 * Build condensed searchable text for a symbol/window chunk.
 */
export function buildChunkText({
  relPath,
  title,
  kind,
  signature,
  body,
  imports,
  pathTokens,
}) {
  const parts = [
    relPath,
    pathTokens || "",
    `${kind} ${title}`,
    signature || "",
    (imports || []).slice(0, 12).join(" "),
    body || "",
  ];
  return parts.filter(Boolean).join("\n");
}

/** Path tokens help BM25/embeddings match folder intent (auth, billing, …). */
export function pathTokens(relPath) {
  return String(relPath || "")
    .replace(/\.[^.]+$/, "")
    .split(/[\\/_.-]+/)
    .filter((p) => p.length > 1)
    .join(" ");
}
