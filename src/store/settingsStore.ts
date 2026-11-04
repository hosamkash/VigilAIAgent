import { create } from "zustand";
import type { ApiKeyProvider } from "../lib/secure-storage";
import {
  hasApiKey,
  listConfiguredProviders,
  saveApiKey,
} from "../lib/secure-storage";
import { rememberKeyHint } from "../lib/key-hints";

interface SettingsState {
  view: "chat" | "settings";
  configured: ApiKeyProvider[];
  status: string | null;
  setView: (view: "chat" | "settings") => void;
  refreshConfigured: () => Promise<void>;
  saveKey: (provider: ApiKeyProvider, key: string) => Promise<void>;
  checkKey: (provider: ApiKeyProvider) => Promise<boolean>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  view: "chat",
  configured: [],
  status: null,
  setView: (view) => set({ view }),
  refreshConfigured: async () => {
    try {
      const configured = await listConfiguredProviders();
      set({ configured });
    } catch {
      set({ configured: [], status: "Keychain unavailable (browser preview)" });
    }
  },
  saveKey: async (provider, key) => {
    await saveApiKey(provider, key);
    rememberKeyHint(provider, key);
    const configured = await listConfiguredProviders();
    set({ configured, status: `Saved ${provider} key to OS Keychain` });
  },
  checkKey: async (provider) => {
    try {
      return await hasApiKey(provider);
    } catch {
      return false;
    }
  },
}));
