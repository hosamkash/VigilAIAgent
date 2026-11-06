import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
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
import {
  VIGIL_DB_EXTENSION,
  clearVigilDbCache,
  defaultVigilDbPath,
  getConfiguredVigilDbPath,
  openUserVigilDb,
  resolveVigilDbPath,
  saveUserVigilDb,
  setConfiguredVigilDbPath,
} from "../lib/vigil-db";

const PROVIDERS: { id: ApiKeyProvider; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "anthropic", label: "Anthropic" },
];

type SettingsPage = "appearance" | "keys" | "database" | "usage";

const NAV: Array<{
  id: SettingsPage;
  label: string;
  hint: string;
  accent: string;
  soft: string;
  icon: ReactNode;
}> = [
  {
    id: "appearance",
    label: "Appearance",
    hint: "Themes & look",
    accent: "#ca5010",
    soft: "rgba(202, 80, 16, 0.14)",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
        <path
          d="M12 3a9 9 0 1 0 0 18c.7 0 1.2-.6 1-1.2-.3-.8.3-1.6 1.1-1.6H16a4 4 0 0 0 0-8h-.5c-.8 0-1.4-.7-1.1-1.4.3-.7-.2-1.5-1-1.6A9 9 0 0 0 12 3Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <circle cx="8" cy="10" r="1.1" fill="currentColor" />
        <circle cx="10.5" cy="7.5" r="1.1" fill="currentColor" />
        <circle cx="14" cy="7.8" r="1.1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "keys",
    label: "API Keys",
    hint: "BYOK & biometrics",
    accent: "#8764b8",
    soft: "rgba(135, 100, 184, 0.16)",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
        <circle cx="8" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M11 14h9m-3.5-2.5V14m0 0v2.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "database",
    label: "VigilDB",
    hint: "Portable user data",
    accent: "#038387",
    soft: "rgba(3, 131, 135, 0.14)",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
        <ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"
          stroke="currentColor"
          strokeWidth="1.7"
        />
      </svg>
    ),
  },
  {
    id: "usage",
    label: "Usage",
    hint: "Cost & tokens",
    accent: "#388a34",
    soft: "rgba(56, 138, 52, 0.14)",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
        <path
          d="M4 19V5m0 14h16"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M8 15v-3m4 3V8m4 7v-5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
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
  const [page, setPage] = useState<SettingsPage>("appearance");
  const [useBio, setUseBio] = useState(() => isBiometricEnabled());
  const [bioStatus, setBioStatus] = useState<BiometricStatus | null>(null);
  const [bioMsg, setBioMsg] = useState<string | null>(null);
  const [dbPath, setDbPath] = useState("");
  const [dbInfo, setDbInfo] = useState<string | null>(null);
  const [dbBusy, setDbBusy] = useState(false);

  const activeNav = NAV.find((n) => n.id === page) ?? NAV[0]!;

  useEffect(() => {
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
    void resolveVigilDbPath()
      .then(setDbPath)
      .catch(() => setDbPath(getConfiguredVigilDbPath() ?? ""));
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
    <div className="flex h-full w-full bg-[var(--vigil-bg)] text-[var(--vigil-text)]">
      {/* Left nav */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-[var(--vigil-border)] bg-[var(--vigil-sidebar)]">
        <div className="border-b border-[var(--vigil-border)] px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--vigil-muted)]">
            Settings
          </div>
          <div className="mt-0.5 text-sm font-semibold">Vigil Agent</div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map((item) => {
            const active = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setPage(item.id);
                  setError(null);
                }}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  active
                    ? "bg-[var(--vigil-panel)] shadow-sm"
                    : "hover:bg-[var(--vigil-hover)]"
                }`}
                style={
                  active
                    ? { boxShadow: `inset 3px 0 0 ${item.accent}` }
                    : undefined
                }
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: item.soft,
                    color: item.accent,
                  }}
                >
                  {item.icon}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">
                    {item.label}
                  </span>
                  <span className="block truncate text-[10px] text-[var(--vigil-muted)]">
                    {item.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[var(--vigil-border)] p-2">
          <button
            type="button"
            onClick={() => lockSettings()}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--vigil-hover)]"
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: "rgba(0, 120, 212, 0.12)",
                color: "var(--vigil-accent)",
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                <path
                  d="M14 6l-6 6 6 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 12h11"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">Back to IDE</span>
              <span className="block text-[10px] text-[var(--vigil-muted)]">
                Leave settings
              </span>
            </span>
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--vigil-panel)]">
        <header className="flex items-center gap-3 border-b border-[var(--vigil-border)] px-6 py-4">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: activeNav.soft, color: activeNav.accent }}
          >
            {activeNav.icon}
          </span>
          <div>
            <h1 className="text-lg font-semibold">{activeNav.label}</h1>
            <p className="text-sm text-[var(--vigil-muted)]">{activeNav.hint}</p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {page === "appearance" && (
            <div className="space-y-4 p-6">
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
                Quick switch: Light / Dark / Ocean / Forest / Sunset. Preference
                is saved locally for next launch.
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
                        const msg =
                          err instanceof Error ? err.message : String(err);
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
                <span className="mb-1 block text-[var(--vigil-muted)]">
                  Provider
                </span>
                <select
                  value={provider}
                  onChange={(e) =>
                    setProvider(e.target.value as ApiKeyProvider)
                  }
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
                <span className="mb-1 block text-[var(--vigil-muted)]">
                  API Key
                </span>
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

          {page === "database" && (
            <div className="max-w-2xl space-y-4 p-6">
              <div>
                <h2 className="text-base font-semibold">VigilDB (user data)</h2>
                <p className="text-sm text-[var(--vigil-muted)]">
                  Portable Firebase-style JSON database ({VIGIL_DB_EXTENSION}).
                  Stores your Run commands and other personal data. Copy the
                  file to another machine and keep working.
                </p>
              </div>

              <label className="block text-sm">
                <span className="mb-1 block text-[var(--vigil-muted)]">
                  Database file path
                </span>
                <input
                  value={dbPath}
                  onChange={(e) => setDbPath(e.target.value)}
                  placeholder={`~/…/user${VIGIL_DB_EXTENSION}`}
                  className="w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-3 py-2 font-mono text-xs"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={dbBusy || !dbPath.trim()}
                  className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40"
                  onClick={() => {
                    setDbBusy(true);
                    setDbInfo(null);
                    setError(null);
                    void (async () => {
                      try {
                        clearVigilDbCache();
                        setConfiguredVigilDbPath(dbPath.trim());
                        const { path, store } = await openUserVigilDb({
                          path: dbPath.trim(),
                          createIfMissing: true,
                        });
                        await saveUserVigilDb(path, store);
                        setDbPath(path);
                        setDbInfo(
                          `Active: ${store.meta.name} · ${store.docCount} docs · ${path}`,
                        );
                      } catch (err) {
                        setError(String(err));
                      } finally {
                        setDbBusy(false);
                      }
                    })();
                  }}
                >
                  {dbBusy ? "…" : "Open / Create"}
                </button>
                <button
                  type="button"
                  disabled={dbBusy}
                  className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-sm"
                  onClick={() => {
                    setDbBusy(true);
                    void (async () => {
                      try {
                        const picked = await openDialog({
                          multiple: false,
                          filters: [
                            { name: "VigilDB", extensions: ["vigilDB"] },
                          ],
                        });
                        if (typeof picked === "string" && picked) {
                          clearVigilDbCache();
                          setConfiguredVigilDbPath(picked);
                          const { path, store } = await openUserVigilDb({
                            path: picked,
                            createIfMissing: false,
                          });
                          setDbPath(path);
                          setDbInfo(
                            `Opened: ${store.meta.name} · ${store.docCount} docs`,
                          );
                        }
                      } catch (err) {
                        setError(String(err));
                      } finally {
                        setDbBusy(false);
                      }
                    })();
                  }}
                >
                  Browse…
                </button>
                <button
                  type="button"
                  disabled={dbBusy}
                  className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-sm"
                  onClick={() => {
                    setDbBusy(true);
                    void (async () => {
                      try {
                        const { path, store } = await openUserVigilDb();
                        const target = await saveDialog({
                          defaultPath: store.suggestedFileName(),
                          filters: [
                            { name: "VigilDB", extensions: ["vigilDB"] },
                          ],
                        });
                        if (typeof target === "string" && target) {
                          await saveUserVigilDb(target, store);
                          setDbPath(target);
                          setDbInfo(`Exported to ${target}`);
                        } else {
                          void path;
                        }
                      } catch (err) {
                        setError(String(err));
                      } finally {
                        setDbBusy(false);
                      }
                    })();
                  }}
                >
                  Export copy…
                </button>
                <button
                  type="button"
                  disabled={dbBusy}
                  className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-sm"
                  onClick={() => {
                    void defaultVigilDbPath().then((p) => {
                      setDbPath(p);
                      setDbInfo(`Default path: ${p}`);
                    });
                  }}
                >
                  Use default
                </button>
              </div>

              {dbInfo && (
                <p className="text-sm text-[var(--vigil-success)]">{dbInfo}</p>
              )}
              {error && (
                <p className="text-sm text-[var(--vigil-danger)]">{error}</p>
              )}

              <div className="rounded border border-[var(--vigil-border)] p-3 text-xs text-[var(--vigil-muted)]">
            Collections in your file:{" "}
            <code className="text-[var(--vigil-text)]">
              VigilAgent.runCommands
            </code>
            ,{" "}
            <code className="text-[var(--vigil-text)]">
              VigilAgent.chatSessions
            </code>{" "}
            (History). Close a chat tab to archive it into VigilDB.
              </div>
            </div>
          )}

          {page === "usage" && (
            <div className="space-y-4 p-6">
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
      </div>
    </div>
  );
}
