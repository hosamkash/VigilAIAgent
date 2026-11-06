/**
 * Frontend secure storage — talks to Rust ONLY (never localStorage for keys).
 * Rust stores secrets in the OS keychain and mediates sidecar HMAC.
 */

import { invoke } from "@tauri-apps/api/core";

export type ApiKeyProvider = "openai" | "gemini" | "anthropic";

const BIOMETRIC_PREF_KEY = "vigil.useBiometric";
const FAIL_COUNT_KEY = "vigil.biometricFails";

export function isBiometricEnabled(): boolean {
  try {
    return localStorage.getItem(BIOMETRIC_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setBiometricEnabled(on: boolean): void {
  try {
    localStorage.setItem(BIOMETRIC_PREF_KEY, on ? "1" : "0");
    if (on) localStorage.setItem(FAIL_COUNT_KEY, "0");
  } catch {
    /* ignore */
  }
}

function biometricFailCount(): number {
  try {
    return Number(localStorage.getItem(FAIL_COUNT_KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

function bumpBiometricFail(): number {
  const n = biometricFailCount() + 1;
  try {
    localStorage.setItem(FAIL_COUNT_KEY, String(n));
  } catch {
    /* ignore */
  }
  return n;
}

function resetBiometricFail(): void {
  try {
    localStorage.setItem(FAIL_COUNT_KEY, "0");
  } catch {
    /* ignore */
  }
}

/** After 3 failures, skip biometric and use keychain only. */
function shouldRequireBiometric(): boolean {
  return isBiometricEnabled() && biometricFailCount() < 3;
}

export async function saveApiKey(
  provider: ApiKeyProvider,
  apiKey: string,
): Promise<void> {
  // If Settings was already unlocked with Touch ID, do NOT prompt again —
  // a second Keychain/password dialog is what felt like "login after fingerprint".
  const gateOpen = await isSettingsGateOpen().catch(() => false);
  if (gateOpen) {
    await invoke("save_api_key", { provider, apiKey });
    resetBiometricFail();
    return;
  }

  const require = shouldRequireBiometric();
  try {
    await invoke("save_api_key_with_biometric", {
      provider,
      apiKey,
      requireBiometric: require,
    });
    resetBiometricFail();
  } catch (err) {
    if (require) {
      const fails = bumpBiometricFail();
      if (fails >= 3) {
        await invoke("save_api_key", { provider, apiKey });
        return;
      }
    }
    throw err;
  }
}

export async function isSettingsGateOpen(): Promise<boolean> {
  return invoke<boolean>("settings_gate_open");
}

export async function lockSettingsGate(): Promise<void> {
  await invoke("lock_settings_gate");
}

/** Call only after Touch ID authenticated === true. */
export async function unlockSettingsGate(): Promise<void> {
  await invoke("unlock_settings_gate");
}

export async function hasApiKey(provider: ApiKeyProvider): Promise<boolean> {
  return invoke<boolean>("has_api_key", { provider });
}

export async function deleteApiKey(provider: ApiKeyProvider): Promise<void> {
  await invoke("delete_api_key", { provider });
}

/**
 * Read API key from OS vault (Layer 2).
 * Layer 1 presence prompt is skipped when Settings gate is already open.
 */
export async function getApiKey(provider: ApiKeyProvider): Promise<string> {
  const gateOpen = await isSettingsGateOpen().catch(() => false);
  if (gateOpen) {
    const key = await invoke<string>("get_api_key", { provider });
    resetBiometricFail();
    return key;
  }

  const require = shouldRequireBiometric();
  try {
    const key = await invoke<string>("get_api_key_with_biometric", {
      provider,
      requireBiometric: require,
    });
    resetBiometricFail();
    return key;
  } catch (err) {
    if (require) {
      const fails = bumpBiometricFail();
      if (fails >= 3) {
        return invoke<string>("get_api_key", { provider });
      }
    }
    throw err;
  }
}

/**
 * Read API key WITHOUT biometric / Settings unlock.
 * For chat helpers (voice STT, image enrich) so mic does not pop Touch ID every time.
 * Still uses OS vault (Layer 2); may show a one-time Keychain allow if ACL requires it.
 */
export async function getApiKeyQuiet(provider: ApiKeyProvider): Promise<string> {
  return invoke<string>("get_api_key", { provider });
}

export async function getApiKeyHint(provider: ApiKeyProvider): Promise<string> {
  return invoke<string>("get_api_key_hint", { provider });
}

export interface BiometricStatus {
  available: boolean;
  platform: string;
  label: string;
  message: string;
  /** Biometric prompt available on this OS/device. */
  biometricsAvailable?: boolean;
  /** Typed device password verification available. */
  passwordAvailable?: boolean;
  /** OS secure vault label (Keychain / Credential Manager / Secret Service). */
  vaultLabel?: string;
}

export async function getBiometricStatus(): Promise<BiometricStatus> {
  return invoke<BiometricStatus>("biometric_status");
}

export interface BiometricAuthResult {
  authenticated: boolean;
  detail: string;
}

export type AuthMode = "biometrics" | "password";

/**
 * Returns authenticated===true ONLY after native auth success.
 * mode: "biometrics" (native prompt). Prefer verifyDevicePassword() for typed passwords.
 */
export async function testBiometric(
  reason = "Unlock Vigil AI Agent",
  mode: AuthMode = "biometrics",
  openSettingsGate = false,
): Promise<BiometricAuthResult> {
  try {
    const result = await invoke<BiometricAuthResult>("authenticate_biometric", {
      reason,
      mode,
      openSettingsGate,
    });
    if (
      !result ||
      typeof result !== "object" ||
      result.authenticated !== true
    ) {
      return {
        authenticated: false,
        detail:
          result && typeof result === "object" && "detail" in result
            ? String((result as BiometricAuthResult).detail || "denied")
            : "denied",
      };
    }
    return { authenticated: true, detail: result.detail || "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      msg.includes("authenticate_biometric")
        ? msg
        : `Auth invoke failed: ${msg}`,
    );
  }
}

/** Verify a typed device login password (in-app form). No biometric prompt. */
export async function verifyDevicePassword(
  password: string,
  openSettingsGate = false,
): Promise<BiometricAuthResult> {
  try {
    const result = await invoke<BiometricAuthResult>("verify_device_password", {
      password,
      openSettingsGate,
    });
    if (
      !result ||
      typeof result !== "object" ||
      result.authenticated !== true
    ) {
      return {
        authenticated: false,
        detail:
          result && typeof result === "object" && "detail" in result
            ? String((result as BiometricAuthResult).detail || "denied")
            : "denied",
      };
    }
    return { authenticated: true, detail: result.detail || "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      msg.includes("verify_device_password")
        ? msg
        : `Password verify failed: ${msg}`,
    );
  }
}

/** Opaque session bootstrap from Rust. */
export async function getLaunchSession(): Promise<{
  sessionId: string;
  hmacToken: string;
}> {
  return invoke("get_launch_session");
}

/** Per-launch HMAC secret (hex). Used to sign sidecar HTTP requests. */
export async function getLaunchSecret(): Promise<string> {
  return invoke<string>("get_launch_secret");
}

export async function listConfiguredProviders(): Promise<ApiKeyProvider[]> {
  return invoke<ApiKeyProvider[]>("list_configured_providers");
}

export async function spawnSidecar(): Promise<{
  port: number;
  sessionId: string;
  alreadyRunning: boolean;
  pid?: number | null;
}> {
  return invoke("spawn_sidecar");
}

export async function getWorkspaceCwd(): Promise<string> {
  return invoke<string>("get_workspace_cwd");
}
