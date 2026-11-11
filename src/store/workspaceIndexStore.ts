import { create } from "zustand";
import {
  buildIndexedFiles,
  listWorkspaceFiles,
  rankIndexedFiles,
  type IndexedFile,
} from "../lib/workspace-index";
import {
  parseSymbolHit,
  rankSymbols,
  type CodeSymbol,
} from "../lib/symbol-extract";
import { runWorkspaceCommand } from "../lib/workspace-fs";
import {
  ensureLocalCodeIndex,
  getLocalCodeIndexStatus,
  updateLocalCodeIndexFile,
  type CodeIndexSummary,
} from "../lib/cline-engine";

const SYMBOL_RG =
  "rg -n --color never " +
  "-g '*.ts' -g '*.tsx' -g '*.js' -g '*.jsx' -g '*.mjs' -g '*.cjs' -g '*.py' -g '*.rs' " +
  "-g '!node_modules/**' -g '!dist/**' -g '!build/**' -g '!.git/**' " +
  "\"\\\\b(export\\\\s+)?(default\\\\s+)?(async\\\\s+)?(function|class|interface|type|const|enum)\\\\s+[A-Za-z_$][\\\\w$]*\" " +
  ". || true";

interface WorkspaceIndexState {
  root: string | null;
  files: IndexedFile[];
  symbols: CodeSymbol[];
  indexing: boolean;
  semanticIndexing: boolean;
  semantic: CodeIndexSummary | null;
  error: string | null;
  lastIndexedAt: number | null;
  rebuild: (root: string | null) => Promise<void>;
  clear: () => void;
  queryFiles: (query: string, limit?: number) => IndexedFile[];
  querySymbols: (query: string, limit?: number) => CodeSymbol[];
  symbolsForPath: (path: string) => CodeSymbol[];
  touchSemanticFile: (absPath: string, content: string) => Promise<void>;
  refreshSemanticStatus: () => Promise<void>;
}

export const useWorkspaceIndexStore = create<WorkspaceIndexState>((set, get) => ({
  root: null,
  files: [],
  symbols: [],
  indexing: false,
  semanticIndexing: false,
  semantic: null,
  error: null,
  lastIndexedAt: null,
  clear: () =>
    set({
      root: null,
      files: [],
      symbols: [],
      indexing: false,
      semanticIndexing: false,
      semantic: null,
      error: null,
      lastIndexedAt: null,
    }),
  rebuild: async (root) => {
    const trimmed = (root || "").trim();
    if (!trimmed) {
      get().clear();
      return;
    }
    set({ indexing: true, error: null, root: trimmed });
    try {
      const paths = await listWorkspaceFiles(trimmed);
      const files = buildIndexedFiles(paths, trimmed);
      let symbols: CodeSymbol[] = [];
      try {
        const raw = await runWorkspaceCommand(SYMBOL_RG, trimmed);
        const seen = new Set<string>();
        for (const line of raw.split("\n")) {
          const hit = parseSymbolHit(line, trimmed);
          if (!hit) continue;
          const key = `${hit.path}:${hit.name}:${hit.line}`;
          if (seen.has(key)) continue;
          seen.add(key);
          symbols.push(hit);
          if (symbols.length >= 8_000) break;
        }
      } catch {
        symbols = [];
      }
      set({
        files,
        symbols,
        indexing: false,
        lastIndexedAt: Date.now(),
        error: null,
      });
    } catch (err) {
      set({
        indexing: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Local BM25 code index (sidecar) — best-effort, does not block @mentions.
    set({ semanticIndexing: true });
    try {
      const semantic = await ensureLocalCodeIndex(false);
      set({
        semantic,
        semanticIndexing: false,
      });
    } catch (err) {
      set({
        semanticIndexing: false,
        error:
          get().error ||
          (err instanceof Error ? err.message : String(err)),
      });
    }
  },
  queryFiles: (query, limit = 12) =>
    rankIndexedFiles(get().files, query, limit),
  querySymbols: (query, limit = 12) =>
    rankSymbols(get().symbols, query, limit),
  symbolsForPath: (path) => {
    const norm = path.replace(/\\/g, "/");
    return get().symbols.filter((s) => s.path.replace(/\\/g, "/") === norm);
  },
  refreshSemanticStatus: async () => {
    try {
      const semantic = await getLocalCodeIndexStatus();
      set({ semantic });
    } catch {
      /* best-effort */
    }
  },
  touchSemanticFile: async (absPath, content) => {
    const root = get().root;
    if (!root) return;
    const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    const normPath = absPath.replace(/\\/g, "/");
    if (normPath !== normRoot && !normPath.startsWith(`${normRoot}/`)) return;
    const rel = normPath.slice(normRoot.length).replace(/^\//, "");
    if (!rel) return;
    try {
      await updateLocalCodeIndexFile(rel, content);
      await get().refreshSemanticStatus();
    } catch {
      /* best-effort */
    }
  },
}));
