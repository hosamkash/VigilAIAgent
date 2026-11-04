import { create } from "zustand";
import { getWorkspaceCwd } from "../lib/secure-storage";
import { listDir, type DirEntryInfo } from "../lib/workspace-fs";

interface ExplorerState {
  root: string | null;
  expanded: Record<string, boolean>;
  children: Record<string, DirEntryInfo[]>;
  selectedPath: string | null;
  searchQuery: string;
  searchResults: string[];
  loading: boolean;
  error: string | null;
  init: () => Promise<void>;
  toggleExpand: (path: string) => Promise<void>;
  selectPath: (path: string | null) => void;
  refresh: (path?: string) => Promise<void>;
  setSearchQuery: (q: string) => void;
  setSearchResults: (results: string[]) => void;
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  root: null,
  expanded: {},
  children: {},
  selectedPath: null,
  searchQuery: "",
  searchResults: [],
  loading: false,
  error: null,
  init: async () => {
    set({ loading: true, error: null });
    try {
      const root = await getWorkspaceCwd();
      const entries = await listDir(root);
      set({
        root,
        children: { [root]: entries },
        expanded: { [root]: true },
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: String(err),
        root: null,
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
