import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  clearLastWorkspace,
  readLastWorkspace,
  rememberProject,
} from "../lib/recent-projects";
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
