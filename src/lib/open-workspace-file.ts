/**
 * Open a workspace file in the editor and reveal it in the Explorer tree.
 */

import { notify } from "./ide-commands";
import { readTextFile } from "./workspace-fs";
import { useEditorTabsStore } from "../store/editorTabsStore";
import { useExplorerStore } from "../store/explorerStore";
import { useLayoutStore } from "../store/layoutStore";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function resolveWorkspacePath(
  path: string,
  workspaceRoot?: string | null,
): { abs: string; label: string } {
  const norm = normalizePath(path.trim());
  if (!norm) return { abs: path, label: path };
  const isAbs = norm.startsWith("/") || /^[A-Za-z]:\//.test(norm);
  const root = workspaceRoot ? normalizePath(workspaceRoot).replace(/\/+$/, "") : "";
  if (isAbs) {
    const label =
      root && (norm === root || norm.startsWith(`${root}/`))
        ? norm === root
          ? norm.split("/").pop() || norm
          : norm.slice(root.length + 1)
        : norm.split("/").slice(-2).join("/");
    return { abs: path, label };
  }
  const abs = root ? `${root}/${norm}` : norm;
  return { abs, label: norm };
}

export async function openAndRevealFile(
  path: string,
  opts?: { isDir?: boolean },
): Promise<void> {
  const abs = path.trim();
  if (!abs) return;
  try {
    useLayoutStore.getState().showSidebar("explorer");
    await useExplorerStore.getState().revealPath(abs);
    if (opts?.isDir) {
      const { expanded, toggleExpand } = useExplorerStore.getState();
      if (!expanded[abs]) await toggleExpand(abs);
      return;
    }
    const content = await readTextFile(abs);
    useEditorTabsStore.getState().openFile({ path: abs, content });
  } catch (err) {
    // Dropped folder path may fail as a file read — still reveal in the tree.
    try {
      await useExplorerStore.getState().revealPath(abs);
      const { expanded, toggleExpand } = useExplorerStore.getState();
      if (!expanded[abs]) await toggleExpand(abs);
    } catch {
      notify(err instanceof Error ? err.message : String(err));
    }
  }
}
