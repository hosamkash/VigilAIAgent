import { create } from "zustand";
import {
  deleteCloudBrowserVisit,
  listCloudBrowserVisits,
  loadLocalBrowserVisits,
  mergeBrowserVisitLists,
  mergeVisitIntoList,
  pushBrowserVisitToCloud,
  saveLocalBrowserVisits,
  sanitizeBrowserVisitInput,
  type BrowserVisit,
} from "../lib/cloud/browser-history";
import { useCloudAuthStore } from "./cloudAuthStore";

interface BrowserHistoryState {
  visits: BrowserVisit[];
  hydrated: boolean;
  syncError: string | null;
  hydrate: () => Promise<void>;
  recordVisit: (url: string, title?: string) => Promise<void>;
  removeVisit: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

function persist(visits: BrowserVisit[]) {
  saveLocalBrowserVisits(visits);
}

export const useBrowserHistoryStore = create<BrowserHistoryState>((set, get) => ({
  visits: loadLocalBrowserVisits(),
  hydrated: false,
  syncError: null,

  hydrate: async () => {
    const local = loadLocalBrowserVisits();
    const uid = useCloudAuthStore.getState().user?.uid;
    if (!uid) {
      set({ visits: local, hydrated: true, syncError: null });
      return;
    }
    try {
      const cloud = await listCloudBrowserVisits(uid);
      const merged = mergeBrowserVisitLists(local, cloud);
      persist(merged);
      set({ visits: merged, hydrated: true, syncError: null });
      // Best-effort: push any local-only visits up
      for (const visit of merged) {
        const onCloud = cloud.some((c) => c.id === visit.id || c.url === visit.url);
        if (!onCloud) {
          void pushBrowserVisitToCloud(uid, visit).catch(() => undefined);
        }
      }
    } catch (err) {
      set({
        visits: local,
        hydrated: true,
        syncError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  recordVisit: async (url, title) => {
    const visit = sanitizeBrowserVisitInput({ url, title });
    if (!visit) return;
    const next = mergeVisitIntoList(get().visits, visit);
    persist(next);
    set({ visits: next });
    const uid = useCloudAuthStore.getState().user?.uid;
    if (!uid) return;
    const head = next[0];
    if (!head) return;
    try {
      await pushBrowserVisitToCloud(uid, head);
    } catch (err) {
      set({
        syncError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  removeVisit: async (id) => {
    const next = get().visits.filter((v) => v.id !== id);
    persist(next);
    set({ visits: next });
    const uid = useCloudAuthStore.getState().user?.uid;
    if (!uid) return;
    try {
      await deleteCloudBrowserVisit(uid, id);
    } catch (err) {
      set({
        syncError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  clearAll: async () => {
    const prev = get().visits;
    persist([]);
    set({ visits: [] });
    const uid = useCloudAuthStore.getState().user?.uid;
    if (!uid) return;
    try {
      await Promise.all(
        prev.map((v) => deleteCloudBrowserVisit(uid, v.id).catch(() => undefined)),
      );
    } catch (err) {
      set({
        syncError: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
