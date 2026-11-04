import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  getBiometricStatus,
  type BiometricStatus,
} from "../lib/secure-storage";
import { useSettingsStore } from "../store/settingsStore";

/** Prevent overlapping auth prompts (auto + click / double click). */
let authPromptInFlight = false;

export function SettingsUnlockScreen() {
  const unlocking = useSettingsStore((s) => s.unlocking);
  const unlockError = useSettingsStore((s) => s.unlockError);
  const requestSettingsAccess = useSettingsStore((s) => s.requestSettingsAccess);
  const unlockWithDevicePassword = useSettingsStore(
    (s) => s.unlockWithDevicePassword,
  );
  const cancelSettingsUnlock = useSettingsStore((s) => s.cancelSettingsUnlock);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<BiometricStatus | null>(null);

  useEffect(() => {
    void getBiometricStatus()
      .then((s) => {
        setStatus(s);
        const bio = s.biometricsAvailable ?? s.available;
        const pass = s.passwordAvailable ?? true;
        // If biometrics unavailable but password is, open password form directly.
        if (!bio && pass) setShowPasswordForm(true);
      })
      .catch(() => setStatus(null));
  }, []);

  const biometricsAvailable = status?.biometricsAvailable ?? status?.available ?? true;
  const passwordAvailable = status?.passwordAvailable ?? true;
  const vaultLabel = status?.vaultLabel ?? "OS secure storage";

  async function unlockBiometrics() {
    if (authPromptInFlight || unlocking) return;
    authPromptInFlight = true;
    try {
      await requestSettingsAccess("biometrics");
    } finally {
      authPromptInFlight = false;
    }
  }

  async function submitPassword(e?: FormEvent) {
    e?.preventDefault();
    if (authPromptInFlight || unlocking) return;
    authPromptInFlight = true;
    try {
      await unlockWithDevicePassword(password);
      setPassword("");
    } finally {
      authPromptInFlight = false;
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-[var(--vigil-bg)] text-[var(--vigil-text)]">
      <div className="w-full max-w-md rounded-xl border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--vigil-accent-soft)] text-3xl">
            🔒
          </div>
          <h1 className="text-xl font-semibold">Unlock Settings</h1>
          <p className="mt-2 text-sm text-[var(--vigil-muted)]">
            {showPasswordForm
              ? "Enter your device password / PIN to continue."
              : (status?.message ??
                "Use biometrics, or unlock with your device password / PIN.")}
          </p>
          <p className="mt-2 text-xs text-[var(--vigil-muted)]">
            Layer 1: device auth · Layer 2: {vaultLabel}
          </p>
        </div>

        {unlocking && (
          <p className="mb-4 text-center text-sm text-[var(--vigil-accent)]">
            Waiting for authentication…
          </p>
        )}

        {unlockError && (
          <p className="mb-4 rounded border border-[var(--vigil-danger)]/40 bg-[var(--vigil-danger)]/10 px-3 py-2 text-center text-sm text-[var(--vigil-danger)]">
            {unlockError}
          </p>
        )}

        {showPasswordForm ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => void submitPassword(e)}
          >
            <label
              className="text-xs text-[var(--vigil-muted)]"
              htmlFor="device-password"
            >
              Device password
            </label>
            <input
              id="device-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              disabled={unlocking || !passwordAvailable}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-3 py-2.5 text-sm text-[var(--vigil-text)] outline-none focus:border-[var(--vigil-accent)]"
              placeholder="Password"
            />
            <button
              type="submit"
              disabled={unlocking || !password.trim() || !passwordAvailable}
              className="rounded-md bg-[var(--vigil-accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {unlocking ? "Verifying…" : "Unlock"}
            </button>
            {biometricsAvailable && (
              <button
                type="button"
                disabled={unlocking}
                onClick={() => {
                  setShowPasswordForm(false);
                  setPassword("");
                }}
                className="rounded-md border border-[var(--vigil-border)] px-4 py-2 text-sm text-[var(--vigil-muted)] hover:text-[var(--vigil-text)] disabled:opacity-50"
              >
                Back
              </button>
            )}
            {!biometricsAvailable && (
              <button
                type="button"
                disabled={unlocking}
                onClick={() => {
                  authPromptInFlight = false;
                  cancelSettingsUnlock();
                }}
                className="rounded-md border border-[var(--vigil-border)] px-4 py-2 text-sm text-[var(--vigil-muted)] hover:text-[var(--vigil-text)] disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            {biometricsAvailable && (
              <button
                type="button"
                disabled={unlocking}
                onClick={() => void unlockBiometrics()}
                className="rounded-md bg-[var(--vigil-accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {unlocking
                  ? "Waiting…"
                  : `Unlock with ${status?.label ?? "Biometrics"}`}
              </button>
            )}
            {passwordAvailable && (
              <button
                type="button"
                disabled={unlocking}
                onClick={() => {
                  setShowPasswordForm(true);
                  setPassword("");
                }}
                className="rounded-md border border-[var(--vigil-accent)] bg-[var(--vigil-accent-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--vigil-text)] disabled:opacity-50"
              >
                Unlock with Device Password
              </button>
            )}
            <button
              type="button"
              disabled={unlocking}
              onClick={() => {
                authPromptInFlight = false;
                cancelSettingsUnlock();
              }}
              className="rounded-md border border-[var(--vigil-border)] px-4 py-2 text-sm text-[var(--vigil-muted)] hover:text-[var(--vigil-text)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
