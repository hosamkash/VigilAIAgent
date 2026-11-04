import { create } from "zustand";
import type { ApiKeyProvider, AuthMode } from "../lib/secure-storage";
import {
  hasApiKey,
  listConfiguredProviders,
  lockSettingsGate,
  saveApiKey,
  testBiometric,
  unlockSettingsGate,
  verifyDevicePassword,
} from "../lib/secure-storage";
import { rememberKeyHint } from "../lib/key-hints";

export type AppView = "chat" | "settings-locked" | "settings";

interface SettingsState {
  view: AppView;
  settingsUnlocked: boolean;
  unlocking: boolean;
  unlockError: string | null;
  unlockEpoch: number;
  configured: ApiKeyProvider[];
  status: string | null;
  openSettingsGate: () => void;
  /** Biometrics native prompt (or legacy mode arg). */
  requestSettingsAccess: (mode?: AuthMode) => Promise<void>;
  /** Typed device password from the in-app form. */
  unlockWithDevicePassword: (password: string) => Promise<void>;
  cancelSettingsUnlock: () => void;
  lockSettings: () => void;
  refreshConfigured: () => Promise<void>;
  saveKey: (provider: ApiKeyProvider, key: string) => Promise<void>;
  checkKey: (provider: ApiKeyProvider) => Promise<boolean>;
}

async function finishUnlockAttempt(
  get: () => SettingsState,
  set: (
    partial:
      | Partial<SettingsState>
      | ((s: SettingsState) => Partial<SettingsState>),
  ) => void,
  epoch: number,
  authenticate: () => Promise<{ authenticated: boolean; detail: string }>,
): Promise<void> {
  try {
    const result = await authenticate();

    if (get().unlockEpoch !== epoch) {
      return;
    }

    if (get().settingsUnlocked && get().view === "settings") {
      set({ unlocking: false });
      return;
    }

    if (result.authenticated === true) {
      await unlockSettingsGate();
      if (get().unlockEpoch !== epoch) {
        await lockSettingsGate().catch(() => undefined);
        return;
      }
      set({
        view: "settings",
        settingsUnlocked: true,
        unlocking: false,
        unlockError: null,
      });
      return;
    }

    if (get().settingsUnlocked && get().view === "settings") {
      set({ unlocking: false });
      return;
    }

    await lockSettingsGate().catch(() => undefined);
    set({
      view: "settings-locked",
      settingsUnlocked: false,
      unlocking: false,
      unlockError: `Access denied (${result.detail}). Try biometrics or your device password.`,
    });
  } catch (err) {
    if (get().unlockEpoch !== epoch) {
      return;
    }
    if (get().settingsUnlocked && get().view === "settings") {
      set({ unlocking: false });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    await lockSettingsGate().catch(() => undefined);
    set({
      view: "settings-locked",
      settingsUnlocked: false,
      unlocking: false,
      unlockError: msg || "Authentication failed — Settings stay locked.",
    });
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  view: "chat",
  settingsUnlocked: false,
  unlocking: false,
  unlockError: null,
  unlockEpoch: 0,
  configured: [],
  status: null,

  openSettingsGate: () => {
    set({
      view: "settings-locked",
      settingsUnlocked: false,
      unlocking: false,
      unlockError: null,
    });
  },

  cancelSettingsUnlock: () => {
    void lockSettingsGate().catch(() => undefined);
    set((s) => ({
      view: "chat",
      settingsUnlocked: false,
      unlocking: false,
      unlockError: null,
      unlockEpoch: s.unlockEpoch + 1,
    }));
  },

  lockSettings: () => {
    void lockSettingsGate().catch(() => undefined);
    set((s) => ({
      view: "chat",
      settingsUnlocked: false,
      unlocking: false,
      unlockError: null,
      unlockEpoch: s.unlockEpoch + 1,
    }));
  },

  requestSettingsAccess: async (mode: AuthMode = "biometrics") => {
    if (get().unlocking) return;
    if (get().settingsUnlocked && get().view === "settings") return;

    // Password unlock is the in-app form — do not call native LA password mode.
    if (mode === "password") {
      set({
        view: "settings-locked",
        settingsUnlocked: false,
        unlocking: false,
        unlockError: null,
      });
      return;
    }

    const epoch = get().unlockEpoch;
    set({
      view: "settings-locked",
      settingsUnlocked: false,
      unlocking: true,
      unlockError: null,
    });

    await finishUnlockAttempt(get, set, epoch, () =>
      testBiometric("Unlock Vigil Settings", "biometrics", true),
    );
  },

  unlockWithDevicePassword: async (password: string) => {
    if (get().unlocking) return;
    if (get().settingsUnlocked && get().view === "settings") return;

    const trimmed = password.trim();
    if (!trimmed) {
      set({
        view: "settings-locked",
        settingsUnlocked: false,
        unlocking: false,
        unlockError: "Enter your device password.",
      });
      return;
    }

    const epoch = get().unlockEpoch;
    set({
      view: "settings-locked",
      settingsUnlocked: false,
      unlocking: true,
      unlockError: null,
    });

    await finishUnlockAttempt(get, set, epoch, () =>
      verifyDevicePassword(trimmed, true),
    );
  },

  refreshConfigured: async () => {
    try {
      const configured = await listConfiguredProviders();
      set({ configured: configured as ApiKeyProvider[] });
    } catch {
      set({ configured: [], status: "Could not read key metadata" });
    }
  },

  saveKey: async (provider, key) => {
    await saveApiKey(provider, key);
    rememberKeyHint(provider, key);
    const configured = await listConfiguredProviders();
    set({
      configured: configured as ApiKeyProvider[],
      status: `Saved ${provider} key`,
    });
  },

  checkKey: async (provider) => {
    try {
      return await hasApiKey(provider);
    } catch {
      return false;
    }
  },
}));
