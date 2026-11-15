/**
 * OS “Open with Vigil”: launch args + Explorer/Finder while the app is running.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseVigilDeepLink } from "./cloud/deep-link";

let lastOpened = "";

function normalizeFolder(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

export async function openWorkspaceFromOs(raw: string): Promise<void> {
  const path = normalizeFolder(raw);
  if (!path || path === lastOpened) return;
  const { useExplorerStore } = await import("../store/explorerStore");
  const current = useExplorerStore.getState().root;
  const { shouldReuseVigilWindow } = await import("./open-window-policy");
  if (!shouldReuseVigilWindow(current, path)) {
    try {
      await invoke("open_folder_in_new_window", { path });
      return;
    } catch {
      /* fall through — reuse this window */
    }
  }
  lastOpened = path;
  await useExplorerStore.getState().openWorkspace(path);
}

export async function bootOpenFolderFromOs(): Promise<() => void> {
  const unsubs: Array<() => void> = [];
  try {
    const un = await listen<string>("vigil://open-folder", (ev) => {
      void openWorkspaceFromOs(String(ev.payload || ""));
    });
    unsubs.push(un);
  } catch {
    /* browser preview */
  }
  return () => {
    for (const u of unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
  };
}

export async function takeLaunchOpenPath(): Promise<string | null> {
  try {
    const path = await invoke<string | null>("take_launch_open_path");
    return path ? String(path) : null;
  } catch {
    return null;
  }
}

export function folderPathFromDeepLink(raw: string): string | null {
  const parsed = parseVigilDeepLink(raw);
  if (parsed?.kind === "open" && parsed.path) return parsed.path;
  return null;
}
