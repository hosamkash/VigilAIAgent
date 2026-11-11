/** Lightweight symbol extraction for Outline / @symbol (no full LSP yet). */

export type CodeSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "enum"
  | "method"
  | "other";

export type CodeSymbol = {
  name: string;
  kind: CodeSymbolKind;
  path: string;
  line: number;
  label: string;
};

const KIND_ALIASES: Record<string, CodeSymbolKind> = {
  function: "function",
  class: "class",
  interface: "interface",
  type: "type",
  const: "const",
  enum: "enum",
  async: "function",
};

/** Parse one ripgrep definition line: path:line:source */
export function parseSymbolHit(
  raw: string,
  workspaceRoot?: string | null,
): CodeSymbol | null {
  const m = raw.trim().match(/^(.*):(\d+):(.*)$/);
  if (!m) return null;
  const path = m[1]!;
  const line = Number(m[2]);
  const src = m[3] ?? "";
  const def =
    src.match(
      /\b(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|const|enum)\s+([A-Za-z_$][\w$]*)/,
    ) ||
    src.match(/\b(fn|struct|enum|trait|impl)\s+([A-Za-z_][\w]*)/) ||
    src.match(/\b(def|class)\s+([A-Za-z_][\w]*)/);
  if (!def) return null;
  const name = (def[5] || def[2] || "").trim();
  if (!name) return null;
  const kindToken = (def[4] || def[1] || "other").toLowerCase();
  const kind = KIND_ALIASES[kindToken] || "other";
  const root = (workspaceRoot || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const norm = path.replace(/\\/g, "/");
  const label =
    root && (norm === root || norm.startsWith(`${root}/`))
      ? norm.slice(root.length + 1)
      : norm.split("/").slice(-2).join("/");
  return { name, kind, path, line, label };
}

export function scoreSymbol(symbol: CodeSymbol, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const name = symbol.name.toLowerCase();
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 50;
  if (symbol.label.toLowerCase().includes(q)) return 20;
  return 0;
}

export function rankSymbols(
  symbols: CodeSymbol[],
  query: string,
  limit = 12,
): CodeSymbol[] {
  return symbols
    .map((symbol) => ({ symbol, score: scoreSymbol(symbol, query) }))
    .filter((row) => row.score > 0 || !query.trim())
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.symbol.name.localeCompare(b.symbol.name) ||
        a.symbol.label.localeCompare(b.symbol.label),
    )
    .slice(0, limit)
    .map((row) => row.symbol);
}

/** Extract symbols from a single source file (open editors / Outline). */
export function extractSymbolsFromSource(
  content: string,
  path: string,
  workspaceRoot?: string | null,
): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const hit = parseSymbolHit(`${path}:${i + 1}:${lines[i]}`, workspaceRoot);
    if (hit) out.push(hit);
  }
  return out;
}
