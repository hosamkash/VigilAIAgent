import { create } from "zustand";
import { browserTabTitle } from "../lib/browser-url";
import { basename, languageFromPath } from "../lib/workspace-fs";

function browserTitle(url: string): string {
  return url ? browserTabTitle(url) : "Vigil Browser";
}

export interface ExtensionTabMeta {
  extensionId: string;
  detailUrl: string;
  name: string;
  publisher: string;
  builtin?: boolean;
}

export interface GitDiffMeta {
  repoRoot: string;
  relPath: string;
  staged: boolean;
  conflicted: boolean;
}

export interface BrowserTabMeta {
  url: string;
}

export interface EditorTab {
  id: string;
  path: string;
  title: string;
  language: string;
  content: string;
  original: string;
  dirty: boolean;
  pinned: boolean;
  mode: "file" | "diff" | "extension" | "browser";
  revealLine?: number;
  extension?: ExtensionTabMeta;
  gitDiff?: GitDiffMeta;
  browser?: BrowserTabMeta;
}

interface EditorTabsState {
  tabs: EditorTab[];
  activeId: string | null;
  minimapEnabled: boolean;
  autoSave: boolean;
  wordWrap: boolean;
  openFile: (input: {
    path: string;
    content: string;
    mode?: "file" | "diff";
    original?: string;
    revealLine?: number;
  }) => void;
  openExtension: (meta: ExtensionTabMeta) => void;
  openBrowser: (url?: string) => void;
  updateBrowserUrl: (id: string, url: string, title?: string) => void;
  closeTab: (id: string) => void;
  closeAll: () => void;
  setActive: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  openUntitled: () => void;
  assignPath: (id: string, path: string) => void;
  revertContent: (id: string, content: string) => void;
  toggleAutoSave: () => void;
  toggleWordWrap: () => void;
  reorder: (from: number, to: number) => void;
  showAgentDiff: (path: string, original: string, modified: string) => void;
  showGitDiff: (
    path: string,
    original: string,
    modified: string,
    gitDiff: GitDiffMeta,
  ) => void;
  clearRevealLine: (id: string) => void;
  toggleMinimap: () => void;
}

const MINIMAP_KEY = "vigil.editor.minimap";
const AUTOSAVE_KEY = "vigil.editor.autosave";
const WORDWRAP_KEY = "vigil.editor.wordwrap";

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function saveFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

let untitledCount = 0;

export const useEditorTabsStore = create<EditorTabsState>((set, get) => ({
  tabs: [],
  activeId: null,
  minimapEnabled: loadFlag(MINIMAP_KEY),
  autoSave: loadFlag(AUTOSAVE_KEY),
  wordWrap: loadFlag(WORDWRAP_KEY),
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
  closeAll: () => set({ tabs: [], activeId: null }),
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
  openUntitled: () => {
    untitledCount += 1;
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      path: `untitled:${untitledCount}`,
      title: `Untitled-${untitledCount}`,
      language: "plaintext",
      content: "",
      original: "",
      dirty: false,
      pinned: false,
      mode: "file",
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  assignPath: (id, path) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              path,
              title: basename(path),
              language: languageFromPath(path),
              original: t.content,
              dirty: false,
            }
          : t,
      ),
    })),
  revertContent: (id, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, content, original: content, dirty: false } : t,
      ),
    })),
  toggleAutoSave: () =>
    set((s) => {
      const autoSave = !s.autoSave;
      saveFlag(AUTOSAVE_KEY, autoSave);
      return { autoSave };
    }),
  toggleWordWrap: () =>
    set((s) => {
      const wordWrap = !s.wordWrap;
      saveFlag(WORDWRAP_KEY, wordWrap);
      return { wordWrap };
    }),
  reorder: (from, to) =>
    set((s) => {
      const tabs = [...s.tabs];
      const [item] = tabs.splice(from, 1);
      if (!item) return s;
      tabs.splice(to, 0, item);
      return { tabs };
    }),
  openExtension: (meta) => {
    const id = `extension:${meta.extensionId}`;
    const existing = get().tabs.find((t) => t.id === id);
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const tab: EditorTab = {
      id,
      path: id,
      title: meta.name,
      language: "plaintext",
      content: "",
      original: "",
      dirty: false,
      pinned: false,
      mode: "extension",
      extension: meta,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  openBrowser: (url = "") => {
    let normalized = url.trim();
    if (normalized) {
      // Keep store URL canonical so BrowserView always sees a real href.
      if (
        normalized.startsWith("localhost") ||
        normalized.startsWith("127.") ||
        /^\d{1,3}(\.\d{1,3}){3}/.test(normalized)
      ) {
        normalized = normalized.includes("://")
          ? normalized
          : `http://${normalized}`;
      } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) {
        normalized = `https://${normalized}`;
      }
    }
    const tabs = get().tabs;
    const active = tabs.find((t) => t.id === get().activeId);
    const reuse =
      (active?.mode === "browser" ? active : undefined) ??
      tabs.find((t) => t.mode === "browser");

    if (reuse) {
      if (!normalized) {
        set({ activeId: reuse.id });
        return;
      }
      set((s) => ({
        activeId: reuse.id,
        tabs: s.tabs.map((t) =>
          t.id === reuse.id
            ? {
                ...t,
                browser: { url: normalized },
                title: browserTitle(normalized),
                path: `browser:${normalized}`,
              }
            : t,
        ),
      }));
      return;
    }

    const id = crypto.randomUUID();
    const tab: EditorTab = {
      id,
      path: normalized ? `browser:${normalized}` : `browser:${id}`,
      title: normalized ? browserTitle(normalized) : "Vigil Browser",
      language: "plaintext",
      content: "",
      original: "",
      dirty: false,
      pinned: false,
      mode: "browser",
      browser: { url: normalized },
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  updateBrowserUrl: (id, url, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && t.mode === "browser"
          ? {
              ...t,
              browser: { url },
              title: title || browserTitle(url) || t.title,
              path: `browser:${url || t.id}`,
            }
          : t,
      ),
    })),
  showAgentDiff: (path, original, modified) => {
    const id = `diff:${path}`;
    const existing = get().tabs.find((t) => t.id === id);
    if (existing) {
      set((s) => ({
        activeId: existing.id,
        tabs: s.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                content: modified,
                original,
                dirty: false,
                gitDiff: undefined,
              }
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
  showGitDiff: (path, original, modified, gitDiff) => {
    const id = `diff:${path}`;
    const existing = get().tabs.find((t) => t.id === id);
    if (existing) {
      set((s) => ({
        activeId: existing.id,
        tabs: s.tabs.map((t) =>
          t.id === id
            ? { ...t, content: modified, original, dirty: false, gitDiff }
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
      gitDiff,
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
      saveFlag(MINIMAP_KEY, minimapEnabled);
      return { minimapEnabled };
    }),
}));
