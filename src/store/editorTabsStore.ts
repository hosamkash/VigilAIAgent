import { create } from "zustand";
import { basename, languageFromPath } from "../lib/workspace-fs";

export interface EditorTab {
  id: string;
  path: string;
  title: string;
  language: string;
  content: string;
  original: string;
  dirty: boolean;
  pinned: boolean;
  mode: "file" | "diff";
  revealLine?: number;
}

interface EditorTabsState {
  tabs: EditorTab[];
  activeId: string | null;
  minimapEnabled: boolean;
  openFile: (input: {
    path: string;
    content: string;
    mode?: "file" | "diff";
    original?: string;
    revealLine?: number;
  }) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  reorder: (from: number, to: number) => void;
  showAgentDiff: (path: string, original: string, modified: string) => void;
  clearRevealLine: (id: string) => void;
  toggleMinimap: () => void;
}

const MINIMAP_KEY = "vigil.editor.minimap";

function loadMinimap(): boolean {
  try {
    return localStorage.getItem(MINIMAP_KEY) === "1";
  } catch {
    return false;
  }
}

export const useEditorTabsStore = create<EditorTabsState>((set, get) => ({
  tabs: [],
  activeId: null,
  minimapEnabled: loadMinimap(),
  openFile: ({ path, content, mode = "file", original, revealLine }) => {
    const existing = get().tabs.find((t) => t.path === path && t.mode === mode);
    if (existing) {
      set((s) => ({
        activeId: existing.id,
        tabs: s.tabs.map((t) =>
          t.id === existing.id
            ? {
                ...t,
                content: mode === "file" ? content : t.content,
                revealLine,
              }
            : t,
        ),
      }));
      return;
    }
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      path,
      title: basename(path),
      language: languageFromPath(path),
      content,
      original: original ?? content,
      dirty: false,
      pinned: false,
      mode,
      revealLine,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeId =
        s.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeId;
      return { tabs, activeId };
    }),
  setActive: (activeId) => set({ activeId }),
  updateContent: (id, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, content, dirty: content !== t.original } : t,
      ),
    })),
  markSaved: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, original: t.content, dirty: false } : t,
      ),
    })),
  reorder: (from, to) =>
    set((s) => {
      const tabs = [...s.tabs];
      const [item] = tabs.splice(from, 1);
      if (!item) return s;
      tabs.splice(to, 0, item);
      return { tabs };
    }),
  showAgentDiff: (path, original, modified) => {
    const id = `diff:${path}`;
    const existing = get().tabs.find((t) => t.id === id);
    if (existing) {
      set((s) => ({
        activeId: existing.id,
        tabs: s.tabs.map((t) =>
          t.id === id
            ? { ...t, content: modified, original, dirty: false }
            : t,
        ),
      }));
      return;
    }
    const tab: EditorTab = {
      id,
      path,
      title: `${basename(path)} (diff)`,
      language: languageFromPath(path),
      content: modified,
      original,
      dirty: false,
      pinned: false,
      mode: "diff",
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  clearRevealLine: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, revealLine: undefined } : t,
      ),
    })),
  toggleMinimap: () =>
    set((s) => {
      const minimapEnabled = !s.minimapEnabled;
      try {
        localStorage.setItem(MINIMAP_KEY, minimapEnabled ? "1" : "0");
      } catch {
        /* ignore */
      }
      return { minimapEnabled };
    }),
}));
