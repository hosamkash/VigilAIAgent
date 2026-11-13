import { create } from "zustand";
import {
  listObjectsUi,
  type SqlCatalogObject,
} from "../lib/db-sidecar";

export type SqlCatalogEntry = SqlCatalogObject & {
  key: string;
};

type SqlCatalogState = {
  objects: SqlCatalogEntry[];
  loading: boolean;
  error: string | null;
  refreshedAt: number | null;
  refresh: () => Promise<void>;
  clear: () => void;
  search: (query: string, limit?: number) => SqlCatalogEntry[];
};

export const useSqlCatalogStore = create<SqlCatalogState>((set, get) => ({
  objects: [],
  loading: false,
  error: null,
  refreshedAt: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const objects = await listObjectsUi({ kind: "all" });
      const entries = objects
        .filter((o) => o.name)
        .map((o) => ({
          ...o,
          key: `${o.schema}.${o.name}`,
        }));
      set({
        objects: entries,
        loading: false,
        refreshedAt: Date.now(),
        error: null,
      });
    } catch (err) {
      set({
        loading: false,
        error: String(err),
        objects: [],
      });
    }
  },

  clear: () =>
    set({ objects: [], error: null, refreshedAt: null, loading: false }),

  search: (query, limit = 12) => {
    const q = query.trim().toLowerCase();
    const all = get().objects;
    if (!q) return all.slice(0, limit);
    const scored = all
      .map((o) => {
        const name = o.name.toLowerCase();
        const key = o.key.toLowerCase();
        let score = 0;
        if (name === q) score = 100;
        else if (name.startsWith(q)) score = 80;
        else if (key.includes(q)) score = 50;
        else if (name.includes(q)) score = 40;
        return { o, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((x) => x.o);
  },
}));
