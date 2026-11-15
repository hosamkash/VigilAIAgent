import { create } from "zustand";
import {
  addSecureAllowHost,
  getSecurePreviewUrl,
  listSecureAllowlist,
  removeSecureAllowHost,
  runSecureActiveScan,
  runSecurePassiveScan,
  type SecureAllowEntry,
  type SecureFinding,
  type SecureScanResult,
} from "../lib/secure-sidecar";

type SecureState = {
  hosts: SecureAllowEntry[];
  previewUrl: string | null;
  lastScan: SecureScanResult | null;
  selectedFinding: SecureFinding | null;
  panelOpen: boolean;
  busy: boolean;
  error: string | null;
  setPanelOpen: (open: boolean) => void;
  setSelectedFinding: (f: SecureFinding | null) => void;
  refreshAllowlist: () => Promise<void>;
  refreshPreview: () => Promise<void>;
  addHost: (host: string, confirm: boolean, note?: string) => Promise<void>;
  removeHost: (host: string) => Promise<void>;
  runQuickScan: (url?: string) => Promise<void>;
  runActiveScan: (url?: string) => Promise<void>;
  retestLast: () => Promise<void>;
};

export const useSecureStore = create<SecureState>((set, get) => ({
  hosts: [],
  previewUrl: null,
  lastScan: null,
  selectedFinding: null,
  panelOpen: false,
  busy: false,
  error: null,

  setPanelOpen: (open) => set({ panelOpen: open }),
  setSelectedFinding: (f) => set({ selectedFinding: f, panelOpen: !!f || get().panelOpen }),

  refreshAllowlist: async () => {
    try {
      const hosts = await listSecureAllowlist();
      set({ hosts, error: null });
    } catch (e) {
      set({ error: String((e as Error)?.message || e) });
    }
  },

  refreshPreview: async () => {
    const previewUrl = await getSecurePreviewUrl();
    set({ previewUrl });
  },

  addHost: async (host, confirm, note) => {
    set({ busy: true, error: null });
    try {
      const hosts = await addSecureAllowHost({ host, confirm, note });
      set({ hosts, busy: false });
    } catch (e) {
      set({ busy: false, error: String((e as Error)?.message || e) });
      throw e;
    }
  },

  removeHost: async (host) => {
    set({ busy: true, error: null });
    try {
      const hosts = await removeSecureAllowHost(host);
      set({ hosts, busy: false });
    } catch (e) {
      set({ busy: false, error: String((e as Error)?.message || e) });
    }
  },

  runQuickScan: async (url) => {
    set({ busy: true, error: null, panelOpen: true });
    try {
      const lastScan = await runSecurePassiveScan(url);
      set({
        lastScan,
        busy: false,
        selectedFinding: lastScan.findings[0] || null,
        error: lastScan.ok === false ? lastScan.error || "Scan failed" : null,
      });
    } catch (e) {
      set({
        busy: false,
        error: String((e as Error)?.message || e),
        lastScan: null,
      });
    }
  },

  runActiveScan: async (url) => {
    set({ busy: true, error: null, panelOpen: true });
    try {
      const lastScan = await runSecureActiveScan(url, true);
      set({
        lastScan,
        busy: false,
        selectedFinding: lastScan.findings[0] || null,
        error: lastScan.ok === false ? lastScan.error || "Active scan failed" : null,
      });
    } catch (e) {
      set({
        busy: false,
        error: String((e as Error)?.message || e),
        lastScan: null,
      });
    }
  },

  retestLast: async () => {
    const prev = get().lastScan;
    const url = prev?.target;
    if (prev?.pack === "active") {
      await get().runActiveScan(url);
    } else {
      await get().runQuickScan(url);
    }
  },
}));
