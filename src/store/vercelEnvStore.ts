import { create } from "zustand";
import {
  fetchVercelWebEnvStatus,
  runVercelWebEnvPush,
  type VercelWebEnvStatus,
} from "../lib/cline-engine";

type VercelEnvState = {
  status: VercelWebEnvStatus | null;
  loading: boolean;
  pushing: boolean;
  error: string | null;
  log: string | null;
  refresh: () => Promise<void>;
  pushLive: () => Promise<void>;
};

export const useVercelEnvStore = create<VercelEnvState>((set, get) => ({
  status: null,
  loading: false,
  pushing: false,
  error: null,
  log: null,

  refresh: async () => {
    if (get().pushing) return;
    set({ loading: true, error: null });
    try {
      const status = await fetchVercelWebEnvStatus();
      set({
        status,
        loading: false,
        error: status.error || null,
        log: status.log ?? get().log,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  pushLive: async () => {
    if (get().pushing) return;
    set({ pushing: true, error: null, log: null });
    try {
      const status = await runVercelWebEnvPush();
      set({
        status,
        pushing: false,
        error: status.ok ? null : status.error || "فشل رفع المفاتيح",
        log: status.log ?? null,
      });
    } catch (err) {
      set({
        pushing: false,
        error: err instanceof Error ? err.message : String(err),
      });
      await get().refresh();
    }
  },
}));
