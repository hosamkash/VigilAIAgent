import { create } from "zustand";
import { fetchGitStatus } from "../lib/git";
import {
  buildExplorerGitDecorations,
  type ExplorerGitDecoration,
} from "../lib/git-explorer-decorations";

interface GitDecorationState {
  root: string | null;
  byPath: Record<string, ExplorerGitDecoration>;
  refreshing: boolean;
  setRoot: (root: string | null) => void;
  refresh: () => Promise<void>;
}

let timer: number | null = null;
let generation = 0;
let listening = false;

function onGitChanged() {
  void useGitDecorationStore.getState().refresh();
}

export const useGitDecorationStore = create<GitDecorationState>((set, get) => ({
  root: null,
  byPath: {},
  refreshing: false,
  setRoot: (root) => {
    generation += 1;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    if (!root) {
      set({ root: null, byPath: {}, refreshing: false });
      return;
    }
    set({ root });
    void get().refresh();
    timer = window.setInterval(() => {
      void get().refresh();
    }, 4000);
    if (typeof window !== "undefined" && !listening) {
      listening = true;
      window.addEventListener("vigil:git-changed", onGitChanged);
    }
  },
  refresh: async () => {
    const root = get().root;
    if (!root) {
      set({ byPath: {}, refreshing: false });
      return;
    }
    const gen = generation;
    set({ refreshing: true });
    try {
      const status = await fetchGitStatus(root);
      if (gen !== generation || get().root !== root) return;
      set({
        byPath: buildExplorerGitDecorations(root, status),
        refreshing: false,
      });
    } catch {
      if (gen !== generation || get().root !== root) return;
      set({ byPath: {}, refreshing: false });
    }
  },
}));
