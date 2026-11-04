import { invoke } from "@tauri-apps/api/core";
import { getWorkspaceCwd } from "./secure-storage";

export interface DirEntryInfo {
  name: string;
  path: string;
  isDir: boolean;
}

export async function listDir(path: string): Promise<DirEntryInfo[]> {
  return invoke<DirEntryInfo[]>("list_dir", { path });
}

export async function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  await invoke("write_text_file", { path, contents });
}

export async function createDir(path: string): Promise<void> {
  await invoke("create_dir", { path });
}

export async function deletePath(path: string): Promise<void> {
  await invoke("delete_path", { path });
}

export async function renamePath(from: string, to: string): Promise<void> {
  await invoke("rename_path", { from, to });
}

export async function runWorkspaceCommand(
  command: string,
  cwd?: string,
): Promise<string> {
  const root = cwd ?? (await getWorkspaceCwd());
  return invoke<string>("run_workspace_command", { command, cwd: root });
}

export function languageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    rs: "rust",
    css: "css",
    html: "html",
    py: "python",
    toml: "toml",
    yml: "yaml",
    yaml: "yaml",
    sh: "shell",
    txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}
