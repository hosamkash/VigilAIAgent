import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/secure-storage", () => ({
  hasApiKey: vi.fn(),
  listConfiguredProviders: vi.fn(async () => []),
  saveApiKey: vi.fn(),
  testBiometric: vi.fn(),
  verifyDevicePassword: vi.fn(),
  lockSettingsGate: vi.fn(async () => undefined),
  unlockSettingsGate: vi.fn(async () => undefined),
  isSettingsGateOpen: vi.fn(async () => false),
}));

import { testBiometric, verifyDevicePassword } from "../lib/secure-storage";
import { useSettingsStore } from "./settingsStore";

describe("settings unlock gate", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      view: "chat",
      settingsUnlocked: false,
      unlocking: false,
      unlockError: null,
      unlockEpoch: 0,
      configured: [],
      status: null,
    });
    vi.mocked(testBiometric).mockReset();
    vi.mocked(verifyDevicePassword).mockReset();
  });

  it("does not open Settings when authenticated is false (cancel/deny)", async () => {
    vi.mocked(testBiometric).mockResolvedValue({
      authenticated: false,
      detail: "cancelled or failed",
    });
    useSettingsStore.getState().openSettingsGate();
    await useSettingsStore.getState().requestSettingsAccess("biometrics");
    const s = useSettingsStore.getState();
    expect(s.settingsUnlocked).toBe(false);
    expect(s.view).toBe("settings-locked");
    expect(s.unlockError).toMatch(/denied/i);
  });

  it("opens Settings only when authenticated is exact true", async () => {
    const { unlockSettingsGate } = await import("../lib/secure-storage");
    vi.mocked(testBiometric).mockResolvedValue({
      authenticated: true,
      detail: "ok",
    });
    await useSettingsStore.getState().requestSettingsAccess("biometrics");
    const s = useSettingsStore.getState();
    expect(testBiometric).toHaveBeenCalledWith(
      "Unlock Vigil Settings",
      "biometrics",
      true,
    );
    expect(unlockSettingsGate).toHaveBeenCalled();
    expect(s.settingsUnlocked).toBe(true);
    expect(s.view).toBe("settings");
  });

  it("password mode only shows the form path (no native LA call)", async () => {
    await useSettingsStore.getState().requestSettingsAccess("password");
    expect(testBiometric).not.toHaveBeenCalled();
    expect(verifyDevicePassword).not.toHaveBeenCalled();
    const s = useSettingsStore.getState();
    expect(s.view).toBe("settings-locked");
    expect(s.unlocking).toBe(false);
  });

  it("unlocks Settings when device password verifies", async () => {
    const { unlockSettingsGate } = await import("../lib/secure-storage");
    vi.mocked(verifyDevicePassword).mockResolvedValue({
      authenticated: true,
      detail: "ok",
    });
    await useSettingsStore.getState().unlockWithDevicePassword("secret");
    expect(verifyDevicePassword).toHaveBeenCalledWith("secret", true);
    expect(unlockSettingsGate).toHaveBeenCalled();
    const s = useSettingsStore.getState();
    expect(s.settingsUnlocked).toBe(true);
    expect(s.view).toBe("settings");
  });

  it("keeps Settings locked when device password is wrong", async () => {
    vi.mocked(verifyDevicePassword).mockResolvedValue({
      authenticated: false,
      detail: "invalid",
    });
    await useSettingsStore.getState().unlockWithDevicePassword("nope");
    const s = useSettingsStore.getState();
    expect(s.settingsUnlocked).toBe(false);
    expect(s.view).toBe("settings-locked");
    expect(s.unlockError).toMatch(/denied/i);
  });

  it("does not start a new auth when Settings is already unlocked", async () => {
    useSettingsStore.setState({
      view: "settings",
      settingsUnlocked: true,
      unlocking: false,
    });
    vi.mocked(testBiometric).mockResolvedValue({
      authenticated: false,
      detail: "Authentication canceled.",
    });
    await useSettingsStore.getState().requestSettingsAccess("biometrics");
    expect(testBiometric).not.toHaveBeenCalled();
    const s = useSettingsStore.getState();
    expect(s.settingsUnlocked).toBe(true);
    expect(s.view).toBe("settings");
  });

  it("ignores late biometric success after cancel", async () => {
    let resolveBio!: (v: { authenticated: boolean; detail: string }) => void;
    vi.mocked(testBiometric).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBio = resolve;
        }),
    );

    const pending = useSettingsStore.getState().requestSettingsAccess();
    useSettingsStore.getState().cancelSettingsUnlock();
    resolveBio({ authenticated: true, detail: "ok" });
    await pending;

    const s = useSettingsStore.getState();
    expect(s.settingsUnlocked).toBe(false);
    expect(s.view).toBe("chat");
  });

  it("keeps Settings locked when biometric throws", async () => {
    vi.mocked(testBiometric).mockRejectedValue(new Error("auth boom"));
    await useSettingsStore.getState().requestSettingsAccess();
    const s = useSettingsStore.getState();
    expect(s.settingsUnlocked).toBe(false);
    expect(s.view).toBe("settings-locked");
    expect(s.unlockError).toMatch(/auth boom/);
  });
});
