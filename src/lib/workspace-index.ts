/** Local workspace file index for @ mentions and agent codebase search. */

import { invoke } from "@tauri-apps/api/core";
import { relativeWorkspaceLabel } from "./explorer-dnd";
import { basename } from "./workspace-fs";

export type IndexedFile = {
  path: string;
  name: string;
  label: string;
};

export async function listWorkspaceFiles(
  root: string,
  maxFiles = 20_000,
): Promise<string[]> {
  return invoke<string[]>("list_workspace_files", {
    root,
    maxFiles,
  });
}

export function buildIndexedFiles(
  paths: string[],
  workspaceRoot: string | null,
): IndexedFile[] {
  return paths.map((path) => ({
    path,
    name: basename(path),
    label: relativeWorkspaceLabel(path, workspaceRoot),
  }));
}

export function scoreIndexedFile(file: IndexedFile, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const nameL = file.name.toLowerCase();
  const labelL = file.label.toLowerCase();
  if (nameL === q) return 100;
  if (nameL.startsWith(q)) return 80;
  if (labelL.endsWith(`/${q}`) || labelL === q) return 70;
  if (nameL.includes(q)) return 50;
  if (labelL.includes(q)) return 30;
  let i = 0;
  for (const ch of labelL) {
    if (ch === q[i]) i += 1;
    if (i >= q.length) return 15;
  }
  return 0;
}

export function rankIndexedFiles(
  files: IndexedFile[],
  query: string,
  limit = 12,
): IndexedFile[] {
  return files
    .map((file) => ({ file, score: scoreIndexedFile(file, query) }))
    .filter((row) => row.score > 0 || !query.trim())
    .sort(
      (a, b) =>
        b.score - a.score || a.file.label.localeCompare(b.file.label),
    )
    .slice(0, limit)
    .map((row) => row.file);
}
