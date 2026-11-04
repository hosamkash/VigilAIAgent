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

export async function hasApiKey(provider: ApiKeyProvider): Promise<boolean> {
  return invoke<boolean>("has_api_key", { provider });
}

export async function deleteApiKey(provider: ApiKeyProvider): Promise<void> {
  await invoke("delete_api_key", { provider });
}

/** Read API key from OS Keychain via Rust (biometric when enabled). */
export async function getApiKey(provider: ApiKeyProvider): Promise<string> {
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

export async function getApiKeyHint(provider: ApiKeyProvider): Promise<string> {
  return invoke<string>("get_api_key_hint", { provider });
}

export interface BiometricStatus {
  available: boolean;
  platform: string;
  label: string;
  message: string;
}

export async function getBiometricStatus(): Promise<BiometricStatus> {
  return invoke<BiometricStatus>("biometric_status");
}

export async function testBiometric(
  reason = "Unlock Vigil AI Agent",
): Promise<boolean> {
  return invoke<boolean>("authenticate_biometric", { reason });
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
