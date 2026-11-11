/** Deepen Monaco TS/JS with workspace tsconfig + extra models for cross-file checks. */

import type { Monaco } from "@monaco-editor/react";
import { isTsJsPath } from "./editor-diagnostics";
import { readTextFile } from "./workspace-fs";
import { useWorkspaceIndexStore } from "../store/workspaceIndexStore";

/** More models = better cross-file TS checks on large projects (capped for RAM). */
const MAX_EXTRA_MODELS = 220;

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
  const norm = path.replace(/\\/g, "/");
  if (norm.startsWith("file:")) return norm;
  return `file://${norm.startsWith("/") ? "" : "/"}${norm}`;
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
 * Create Monaco models for a capped set of TS/JS workspace files so the
 * language service can resolve imports beyond the active buffer.
 */
export async function ensureProjectTsModels(
  monaco: Monaco,
  workspaceRoot: string | null,
): Promise<number> {
  const root = (workspaceRoot || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return 0;

  await applyWorkspaceTsConfig(monaco, root);

  const files = useWorkspaceIndexStore
    .getState()
    .files.filter((f) => isTsJsPath(f.path))
    .slice(0, MAX_EXTRA_MODELS);

  let created = 0;
  for (const file of files) {
    const uri = monaco.Uri.parse(toFileUri(file.path));
    if (monaco.editor.getModel(uri)) continue;
    try {
      const content = await readTextFile(file.path);
      monaco.editor.createModel(content, languageForPath(file.path), uri);
      created += 1;
    } catch {
      /* skip unreadable */
    }
  }
  return created;
}
