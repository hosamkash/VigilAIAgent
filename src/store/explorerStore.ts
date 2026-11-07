import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  clearLastWorkspace,
  readLastWorkspace,
  rememberProject,
} from "../lib/recent-projects";
import { ensureProjectRules } from "../lib/project-rules";
import { listDir, type DirEntryInfo } from "../lib/workspace-fs";
import { useEditorTabsStore } from "./editorTabsStore";

interface ExplorerState {
  root: string | null;
  extraRoots: string[];
  expanded: Record<string, boolean>;
  children: Record<string, DirEntryInfo[]>;
  selectedPath: string | null;
  searchQuery: string;
  searchResults: string[];
  loading: boolean;
  error: string | null;
  launcherOpen: boolean;
  init: () => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  addFolder: (path: string) => Promise<void>;
  closeWorkspace: () => void;
  openLauncher: () => void;
  closeLauncher: () => void;
  toggleExpand: (path: string) => Promise<void>;
  selectPath: (path: string | null) => void;
  /** Expand parents, load folders, and select the file in the tree. */
  revealPath: (filePath: string) => Promise<void>;
  refresh: (path?: string) => Promise<void>;
  setSearchQuery: (q: string) => void;
  setSearchResults: (results: string[]) => void;
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  root: null,
  extraRoots: [],
  expanded: {},
  children: {},
  selectedPath: null,
  searchQuery: "",
  searchResults: [],
  loading: false,
  error: null,
  launcherOpen: false,
  openLauncher: () => set({ launcherOpen: true }),
  closeLauncher: () => set({ launcherOpen: false }),
  openWorkspace: async (path) => {
    const root = await invoke<string>("set_workspace_cwd", { path });
    rememberProject(root);
    try {
      await ensureProjectRules(root);
    } catch {
      /* Rules file is optional; opening the project still succeeds. */
    }
    const entries = await listDir(root);
    useEditorTabsStore.getState().closeAll();
    set({
      root,
      extraRoots: [],
      children: { [root]: entries },
      expanded: { [root]: true },
      selectedPath: null,
      loading: false,
      error: null,
      launcherOpen: false,
    });
  },
  addFolder: async (path) => {
    if (!get().root) {
      await get().openWorkspace(path);
      return;
    }
    if (path === get().root || get().extraRoots.includes(path)) return;
    const entries = await listDir(path);
    set((s) => ({
      extraRoots: [...s.extraRoots, path],
      children: { ...s.children, [path]: entries },
      expanded: { ...s.expanded, [path]: true },
      launcherOpen: false,
    }));
  },
  closeWorkspace: () => {
    clearLastWorkspace();
    useEditorTabsStore.getState().closeAll();
    set({
      root: null,
      extraRoots: [],
      expanded: {},
      children: {},
      selectedPath: null,
      loading: false,
      error: null,
      launcherOpen: true,
    });
  },
  init: async () => {
    if (get().root) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("empty") === "1") {
      set({ loading: false, root: null, extraRoots: [], launcherOpen: true });
      return;
    }
    const saved = readLastWorkspace();
    if (!saved) {
      set({ loading: false, root: null, launcherOpen: true });
      return;
    }
    set({ loading: true, error: null });
    try {
      await get().openWorkspace(saved);
    } catch (err) {
      set({
        loading: false,
        error: String(err),
        root: null,
        launcherOpen: true,
      });
    }
  },
  toggleExpand: async (path) => {
    const { expanded, children } = get();
    const nextOpen = !expanded[path];
    set({ expanded: { ...expanded, [path]: nextOpen } });
    if (nextOpen && !children[path]) {
      try {
        const entries = await listDir(path);
        set((s) => ({ children: { ...s.children, [path]: entries } }));
      } catch (err) {
        set({ error: String(err) });
      }
    }
  },
  selectPath: (selectedPath) => set({ selectedPath }),
  revealPath: async (filePath) => {
    const target = filePath.replace(/\\/g, "/");
    const roots = [get().root, ...get().extraRoots]
      .filter((r): r is string => Boolean(r))
      .map((r) => r.replace(/\\/g, "/").replace(/\/+$/, ""));
    const root =
      roots.find((r) => target === r || target.startsWith(`${r}/`)) ?? null;
    if (!root) {
      set({ selectedPath: filePath });
      return;
    }

    const rel = target.slice(root.length).replace(/^\//, "");
    const parts = rel.split("/").filter(Boolean);
    const expanded = { ...get().expanded, [root]: true };
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      current = `${current}/${parts[i]}`;
      expanded[current] = true;
      if (!get().children[current]) {
        try {
          const entries = await listDir(current);
          set((s) => ({ children: { ...s.children, [current]: entries } }));
        } catch (err) {
          set({ error: String(err) });
          break;
        }
      }
    }

    if (!get().children[root]) {
      try {
        const entries = await listDir(root);
        set((s) => ({ children: { ...s.children, [root]: entries } }));
      } catch (err) {
        set({ error: String(err) });
      }
    }

    set({
      expanded: { ...get().expanded, ...expanded },
      selectedPath: filePath,
    });
  },
  refresh: async (path) => {
    const target = path ?? get().root;
    if (!target) return;
    try {
      const entries = await listDir(target);
      set((s) => ({ children: { ...s.children, [target]: entries } }));
    } catch (err) {
      set({ error: String(err) });
    }
  },
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchResults: (searchResults) => set({ searchResults }),
}));
