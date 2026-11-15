/** Deepen Monaco TS/JS with workspace tsconfig + extra models for cross-file checks. */

import type { Monaco } from "@monaco-editor/react";
import { isTsJsPath } from "./editor-diagnostics";
import { pathToFileUri } from "./monaco-file-uri";
import { readTextFile } from "./workspace-fs";
import { useWorkspaceIndexStore } from "../store/workspaceIndexStore";

/** Hard RAM budget — neighborhood + open tabs stay inside this cap. */
export const MAX_EXTRA_MODELS = 220;

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function languageForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) {
    return "typescript";
  }
  if (lower.endsWith(".jsx")) return "javascript";
  return "javascript";
}

function toFileUri(path: string): string {
  return pathToFileUri(path);
}

function normPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function relToRoot(absOrRel: string, root: string): string {
  const p = normPath(absOrRel);
  const r = normPath(root).replace(/\/+$/, "");
  if (p === r) return "";
  if (p.startsWith(`${r}/`)) return p.slice(r.length + 1);
  return p.replace(/^\.\//, "");
}

function absFromRoot(path: string, root: string): string {
  const p = normPath(path);
  if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) return p;
  return `${normPath(root).replace(/\/+$/, "")}/${p.replace(/^\.\//, "")}`;
}

/**
 * Prefer open-tab seeds + 1-hop import neighbors over a blind first-N file slice.
 * Exported for unit tests.
 */
export function pickTsModelPaths(opts: {
  workspaceRoot: string;
  indexedTsJsPaths: string[];
  seedPaths: string[];
  neighborPaths: string[];
  maxModels?: number;
}): string[] {
  const root = normPath(opts.workspaceRoot).replace(/\/+$/, "");
  const max = opts.maxModels ?? MAX_EXTRA_MODELS;
  const indexAbs = new Map<string, string>();
  for (const p of opts.indexedTsJsPaths) {
    if (!isTsJsPath(p)) continue;
    const abs = absFromRoot(p, root);
    indexAbs.set(normPath(abs).toLowerCase(), abs);
  }

  const picked: string[] = [];
  const seen = new Set<string>();

  function add(raw: string) {
    if (picked.length >= max) return;
    const abs = absFromRoot(raw, root);
    if (!isTsJsPath(abs)) return;
    const key = normPath(abs).toLowerCase();
    if (seen.has(key)) return;
    const resolved = indexAbs.get(key) ?? abs;
    seen.add(key);
    picked.push(resolved);
  }

  for (const seed of opts.seedPaths) add(seed);
  for (const n of opts.neighborPaths) add(n);

  if (picked.length < max) {
    for (const p of opts.indexedTsJsPaths) {
      add(p);
      if (picked.length >= max) break;
    }
  }
  return picked;
}

/** Apply compiler options from the nearest tsconfig.json when present. */
export async function applyWorkspaceTsConfig(
  monaco: Monaco,
  workspaceRoot: string,
): Promise<boolean> {
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const candidates = [
    `${root}/tsconfig.json`,
    `${root}/tsconfig.app.json`,
    `${root}/jsconfig.json`,
  ];
  for (const path of candidates) {
    try {
      const raw = await readTextFile(path);
      const parsed = JSON.parse(stripJsonComments(raw)) as {
        compilerOptions?: Record<string, unknown>;
      };
      const opts = parsed.compilerOptions || {};
      const next = {
        ...monaco.languages.typescript.typescriptDefaults.getCompilerOptions(),
        allowJs: true,
        checkJs: opts.checkJs === true,
        jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
        esModuleInterop: opts.esModuleInterop !== false,
        allowSyntheticDefaultImports: true,
        moduleResolution:
          monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        strict: opts.strict === true,
      };
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions(next);
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions(next);
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/**
 * Create Monaco models for open TS/JS tabs + import-graph neighbors
 * (capped) so F12 / rename resolve beyond the active buffer.
 */
export async function ensureProjectTsModels(
  monaco: Monaco,
  workspaceRoot: string | null,
  seedPaths: string[] = [],
): Promise<number> {
  const root = (workspaceRoot || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return 0;

  await applyWorkspaceTsConfig(monaco, root);

  const indexed = useWorkspaceIndexStore
    .getState()
    .files.filter((f) => isTsJsPath(f.path))
    .map((f) => f.path);

  const relSeeds = seedPaths
    .filter((p) => isTsJsPath(p))
    .map((p) => relToRoot(p, root))
    .filter(Boolean);

  let neighborPaths: string[] = [];
  try {
    const { fetchImportNeighborPaths } = await import("./cline-engine");
    neighborPaths = await fetchImportNeighborPaths(relSeeds);
  } catch {
    neighborPaths = [];
  }

  const files = pickTsModelPaths({
    workspaceRoot: root,
    indexedTsJsPaths: indexed,
    seedPaths,
    neighborPaths,
  });

  let created = 0;
  for (const filePath of files) {
    const uri = monaco.Uri.parse(toFileUri(filePath));
    if (monaco.editor.getModel(uri)) continue;
    try {
      const content = await readTextFile(filePath);
      monaco.editor.createModel(content, languageForPath(filePath), uri);
      created += 1;
    } catch {
      /* skip unreadable */
    }
  }
  return created;
}
