import { create } from "zustand";
import {
  loadInstalledIds,
  saveInstalledIds,
  type ExtensionItem,
} from "../lib/extensions-catalog";

interface ExtensionsState {
  installedIds: Set<string>;
  installingId: string | null;
  selectedId: string | null;
  setSelected: (id: string | null) => void;
  isInstalled: (id: string) => boolean;
  install: (ext: ExtensionItem) => Promise<void>;
  uninstall: (ext: ExtensionItem) => Promise<void>;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const useExtensionsStore = create<ExtensionsState>((set, get) => ({
  installedIds: loadInstalledIds(),
  installingId: null,
  selectedId: null,
  setSelected: (selectedId) => set({ selectedId }),
  isInstalled: (id) => get().installedIds.has(id),
  install: async (ext) => {
    if (ext.builtin || get().installingId) return;
    set({ installingId: ext.id });
    try {
      // Mock install latency (VSIX wiring later)
      await delay(1400);
      const next = new Set(get().installedIds);
      next.add(ext.id);
      saveInstalledIds(next);
      set({ installedIds: next });
    } finally {
      set({ installingId: null });
    }
  },
  uninstall: async (ext) => {
    if (ext.builtin || get().installingId) return;
    set({ installingId: ext.id });
    try {
      await delay(700);
      const next = new Set(get().installedIds);
      next.delete(ext.id);
      saveInstalledIds(next);
      set({ installedIds: next });
    } finally {
      set({ installingId: null });
    }
  },
}));
