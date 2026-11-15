import { create } from "zustand";
import type { DbEngine } from "../lib/db-sidecar";

export type SqlSessionState = {
  connected: boolean;
  engine: DbEngine | null;
  profileId: string | null;
  label: string | null;
  database: string | null;
  readOnly: boolean;
  setSession: (partial: Partial<Omit<SqlSessionState, "setSession" | "clear">>) => void;
  clear: () => void;
};

const empty = {
  connected: false,
  engine: null as DbEngine | null,
  profileId: null as string | null,
  label: null as string | null,
  database: null as string | null,
  readOnly: true,
};

export const useSqlSessionStore = create<SqlSessionState>((set) => ({
  ...empty,
  setSession: (partial) => set((s) => ({ ...s, ...partial })),
  clear: () => set({ ...empty }),
}));
