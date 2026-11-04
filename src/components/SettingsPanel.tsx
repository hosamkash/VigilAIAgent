import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ApiKeyProvider, BiometricStatus } from "../lib/secure-storage";
import {
  getBiometricStatus,
  isBiometricEnabled,
  setBiometricEnabled,
  testBiometric,
} from "../lib/secure-storage";
import { getStoredKeyHint } from "../lib/key-hints";
import { useSettingsStore } from "../store/settingsStore";
import { useCostStore, formatUsd } from "../store/costStore";
import { THEMES, useThemeStore } from "../store/themeStore";
import { sumUsage } from "../lib/cost";

const PROVIDERS: { id: ApiKeyProvider; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "anthropic", label: "Anthropic" },
];

export function SettingsPanel() {
  const { configured, status, lockSettings, refreshConfigured, saveKey } =
    useSettingsStore();
  const { logs, refreshLogs } = useCostStore();
  const { themeId, setTheme } = useThemeStore();
  const [provider, setProvider] = useState<ApiKeyProvider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<"appearance" | "keys" | "usage">(
    "appearance",
  );
  const [useBio, setUseBio] = useState(() => isBiometricEnabled());
  const [bioStatus, setBioStatus] = useState<BiometricStatus | null>(null);
  const [bioMsg, setBioMsg] = useState<string | null>(null);

  useEffect(() => {
    // Do NOT re-check/kick on mount — that raced with unlock and ejected
    // users right after a successful fingerprint.
    void refreshConfigured();
    void refreshLogs();
    void getBiometricStatus()
      .then(setBioStatus)
      .catch(() =>
        setBioStatus({
          available: false,
          platform: "web",
          label: "Biometrics",
          message: "Unavailable in browser preview",
          biometricsAvailable: false,
          passwordAvailable: false,
          vaultLabel: "OS secure storage",
        }),
      );
  }, [refreshConfigured, refreshLogs]);

  const totals = useMemo(() => {
    const mapped = logs.map((l) => ({
      inputTokens: l.inputTokens,
      outputTokens: l.outputTokens,
      cost: l.cost,
      provider: l.provider ?? undefined,
    }));
    const all = sumUsage(mapped);
    const byProvider: Record<string, number> = {};
    for (const l of logs) {
      const key = l.provider ?? "unknown";
      byProvider[key] = (byProvider[key] ?? 0) + l.cost;
    }
    const now = Date.now();
    const day = now - 24 * 60 * 60 * 1000;
    const month = now - 30 * 24 * 60 * 60 * 1000;
    const daily = sumUsage(
      mapped.filter((_, i) => (logs[i]?.createdAt ?? 0) >= day),
    );
    const monthly = sumUsage(
      mapped.filter((_, i) => (logs[i]?.createdAt ?? 0) >= month),
    );
    return { all, byProvider, daily, monthly };
  }, [logs]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await saveKey(provider, apiKey.trim());
      setApiKey("");
    } catch (err) {
      setError(
        String(err) +
          " — Keys are stored via Rust → OS Keychain (not available in plain browser).",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-[var(--vigil-panel)] text-[var(--vigil-text)]">
      <header className="flex items-center justify-between border-b border-[var(--vigil-border)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-sm text-[var(--vigil-muted)]">
            Appearance · BYOK · Usage — Vigil V2
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["appearance", "Appearance"],
              ["keys", "API Keys"],
              ["usage", "Usage"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              className={`rounded border px-3 py-1.5 text-sm ${
                page === id
                  ? "border-[var(--vigil-accent)]"
                  : "border-[var(--vigil-border)]"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => lockSettings()}
            className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-sm"
          >
            Back to IDE
          </button>
        </div>
      </header>

      {page === "appearance" && (
        <div className="space-y-4 overflow-auto p-6">
          <div>
            <h2 className="text-base font-semibold">Theme</h2>
            <p className="text-sm text-[var(--vigil-muted)]">
              Default is Light. Pick a preset — colors apply instantly across
              the IDE.
            </p>
          </div>

          <div className="grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => setTheme(theme.id)}
                data-active={themeId === theme.id}
                className="theme-card rounded-lg p-3 text-left"
              >
                <div className="mb-3 flex h-14 overflow-hidden rounded border border-[var(--vigil-border)]">
                  {theme.swatches.map((color) => (
                    <div
                      key={color}
                      className="h-full flex-1"
                      style={{ background: color }}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{theme.label}</div>
                    <div className="text-[11px] text-[var(--vigil-muted)]">
                      {theme.description}
                    </div>
                  </div>
                  <span className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--vigil-muted)]">
                    {theme.mode}
                  </span>
                </div>
                {themeId === theme.id && (
                  <div className="mt-2 text-[11px] font-medium text-[var(--vigil-accent)]">
                    Active
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="max-w-4xl rounded border border-[var(--vigil-border)] p-3 text-xs text-[var(--vigil-muted)]">
            Quick switch: Light / Dark / Ocean / Forest / Sunset. Preference is
            saved locally for next launch.
          </div>
        </div>
      )}

      {page === "keys" && (
        <form onSubmit={onSave} className="max-w-lg space-y-4 p-6">
          <div className="rounded border border-[var(--vigil-border)] p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Use {bioStatus?.label ?? "Biometrics"} before key access
                <div className="text-xs text-[var(--vigil-muted)]">
                  Layer 1: device auth · Layer 2:{" "}
                  {bioStatus?.vaultLabel ?? "OS secure storage"}
                  {bioStatus?.message ? ` — ${bioStatus.message}` : ""}
                </div>
              </span>
              <input
                type="checkbox"
                checked={useBio}
                onChange={(e) => {
                  setUseBio(e.target.checked);
                  setBiometricEnabled(e.target.checked);
                }}
              />
            </label>
            <button
              type="button"
              className="mt-2 rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs disabled:opacity-50"
              disabled={bioBusy}
              onClick={() => {
                setError(null);
                setBioMsg("Waiting for authentication…");
                setBioBusy(true);
                void testBiometric("Unlock Vigil AI Agent")
                  .then((result) =>
                    setBioMsg(
                      result.authenticated === true
                        ? "Biometrics OK — native dialog completed successfully."
                        : `Biometrics denied (${result.detail}).`,
                    ),
                  )
                  .catch((err) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    setBioMsg(`Biometrics error: ${msg}`);
                    setError(msg);
                  })
                  .finally(() => setBioBusy(false));
              }}
            >
              {bioBusy ? "Waiting…" : "Test biometric"}
            </button>
            {bioMsg && (
              <p
                className={`mt-2 text-xs ${
                  bioMsg.startsWith("Biometrics error")
                    ? "text-[var(--vigil-danger)]"
                    : bioMsg.startsWith("Biometrics OK")
                      ? "text-[var(--vigil-success)]"
                      : "text-[var(--vigil-muted)]"
                }`}
              >
                {bioMsg}
              </p>
            )}
          </div>

          <div className="rounded border border-[var(--vigil-border)] p-3 text-xs">
            <div className="mb-2 font-semibold">Stored keys</div>
            {PROVIDERS.map((p) => (
              <div
                key={p.id}
                className="flex justify-between border-b border-[var(--vigil-border-soft)] py-1 font-mono"
              >
                <span>{p.label}</span>
                <span className="text-[var(--vigil-muted)]">
                  {configured.includes(p.id)
                    ? (getStoredKeyHint(p.id) ?? "•••• configured")
                    : "—"}
                </span>
              </div>
            ))}
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--vigil-muted)]">Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ApiKeyProvider)}
              className="w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-3 py-2"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {configured.includes(p.id) ? " ✓" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--vigil-muted)]">API Key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-… / AIza… / sk-ant-…"
              className="w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-3 py-2"
            />
          </label>

          <button
            type="submit"
            disabled={busy || !apiKey.trim()}
            className="rounded-md bg-[var(--vigil-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save to OS Keychain"}
          </button>

          {status && (
            <p className="text-sm text-[var(--vigil-success)]">{status}</p>
          )}
          {error && (
            <p className="text-sm text-[var(--vigil-danger)]">{error}</p>
          )}
        </form>
      )}

      {page === "usage" && (
        <div className="space-y-4 overflow-auto p-6">
          <div className="grid max-w-3xl grid-cols-3 gap-3 text-sm">
            <div className="rounded border border-[var(--vigil-border)] p-3">
              <div className="text-[var(--vigil-muted)]">All time</div>
              <div className="text-lg font-semibold">
                {formatUsd(totals.all.cost)}
              </div>
            </div>
            <div className="rounded border border-[var(--vigil-border)] p-3">
              <div className="text-[var(--vigil-muted)]">Last 24h</div>
              <div className="text-lg font-semibold">
                {formatUsd(totals.daily.cost)}
              </div>
            </div>
            <div className="rounded border border-[var(--vigil-border)] p-3">
              <div className="text-[var(--vigil-muted)]">Last 30d</div>
              <div className="text-lg font-semibold">
                {formatUsd(totals.monthly.cost)}
              </div>
            </div>
          </div>

          <div className="max-w-3xl rounded border border-[var(--vigil-border)] p-3 text-sm">
            <div className="mb-2 font-semibold">By provider</div>
            {Object.keys(totals.byProvider).length === 0 && (
              <div className="text-[var(--vigil-muted)]">No usage yet</div>
            )}
            {Object.entries(totals.byProvider).map(([p, cost]) => (
              <div
                key={p}
                className="flex justify-between border-b border-[var(--vigil-border-soft)] py-1"
              >
                <span>{p}</span>
                <span>{formatUsd(cost)}</span>
              </div>
            ))}
          </div>

          <div className="max-w-4xl overflow-auto rounded border border-[var(--vigil-border)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--vigil-hover)] text-[var(--vigil-muted)]">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Tokens</th>
                  <th className="px-3 py-2">Cost</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr
                    key={l.id}
                    className="border-t border-[var(--vigil-border-soft)]"
                  >
                    <td className="px-3 py-2">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{l.provider ?? "—"}</td>
                    <td className="px-3 py-2">{l.model ?? "—"}</td>
                    <td className="px-3 py-2">
                      {l.inputTokens}/{l.outputTokens}
                    </td>
                    <td className="px-3 py-2">{formatUsd(l.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
