import { useEffect, useState } from "react";
import {
  isLocalSecureTarget,
  resolveSecureEntitlement,
} from "../lib/secure-entitlement";
import { useCloudAuthStore } from "../store/cloudAuthStore";
import { useSecureStore } from "../store/secureStore";

type Props = { compact?: boolean };

export function SecureAllowlistCard({ compact = false }: Props) {
  const hosts = useSecureStore((s) => s.hosts);
  const previewUrl = useSecureStore((s) => s.previewUrl);
  const busy = useSecureStore((s) => s.busy);
  const error = useSecureStore((s) => s.error);
  const lastScan = useSecureStore((s) => s.lastScan);
  const refreshAllowlist = useSecureStore((s) => s.refreshAllowlist);
  const refreshPreview = useSecureStore((s) => s.refreshPreview);
  const addHost = useSecureStore((s) => s.addHost);
  const removeHost = useSecureStore((s) => s.removeHost);
  const runQuickScan = useSecureStore((s) => s.runQuickScan);
  const runActiveScan = useSecureStore((s) => s.runActiveScan);
  const setPanelOpen = useSecureStore((s) => s.setPanelOpen);
  const user = useCloudAuthStore((s) => s.user);
  const billing = useCloudAuthStore((s) => s.billing);

  const [hostInput, setHostInput] = useState("");
  const [confirmOwn, setConfirmOwn] = useState(false);
  const [scanUrl, setScanUrl] = useState("");
  const [confirmActive, setConfirmActive] = useState(false);

  const targetUrl = scanUrl || previewUrl || "http://127.0.0.1:5173";
  const entitlement = resolveSecureEntitlement({
    planTier: billing?.planTier || (user ? "free" : null),
    entitlements: billing?.entitlements,
    signedIn: !!user,
    localTarget: isLocalSecureTarget(targetUrl),
  });

  useEffect(() => {
    void refreshAllowlist();
    void refreshPreview();
  }, [refreshAllowlist, refreshPreview]);

  useEffect(() => {
    if (previewUrl && !scanUrl) setScanUrl(previewUrl);
  }, [previewUrl, scanUrl]);

  return (
    <div className="mb-3 rounded border border-[var(--vigil-border)] p-2 text-[11px]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold uppercase text-[var(--vigil-muted)]">
          Vigil Secure
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={busy || !entitlement.passive}
            className="rounded bg-[var(--vigil-accent)] px-1.5 py-0.5 text-[10px] !text-white disabled:opacity-50"
            onClick={() => void runQuickScan(scanUrl || undefined)}
          >
            {busy ? "…" : "Quick"}
          </button>
          <button
            type="button"
            disabled={busy || !entitlement.active || !confirmActive}
            className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] hover:bg-[var(--vigil-hover)] disabled:opacity-50"
            title={
              confirmActive
                ? "Start Active (Standard) pack"
                : "Check confirm first"
            }
            onClick={() => void runActiveScan(scanUrl || undefined)}
          >
            Active
          </button>
        </div>
      </div>
      <p className="mb-1.5 text-[var(--vigil-muted)]">
        Authorized only. Quick = passive. Active = safe probes (paths, XSS
        reflection, CSRF forms, admin reachability) — needs confirm.
      </p>
      <p className="mb-1.5 text-[10px] text-[var(--vigil-muted)]">
        {entitlement.reasonAr}
      </p>
      <label className="mb-1.5 flex items-start gap-1.5 text-[10px] text-[var(--vigil-muted)]">
        <input
          type="checkbox"
          checked={confirmActive}
          onChange={(e) => setConfirmActive(e.target.checked)}
          className="mt-0.5"
          disabled={!entitlement.active}
        />
        Start Active scan on this authorized target (موافق على الفحص النشط)
      </label>
      {!compact && (
        <input
          value={scanUrl}
          onChange={(e) => setScanUrl(e.target.value)}
          placeholder={previewUrl || "http://127.0.0.1:5173"}
          className="mb-1.5 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-[11px]"
        />
      )}
      {previewUrl && (
        <div className="mb-1 truncate text-[10px] text-[var(--vigil-muted)]">
          Preview: {previewUrl}
        </div>
      )}
      {lastScan?.summary && (
        <button
          type="button"
          className="mb-1.5 block w-full rounded border border-[var(--vigil-border)] px-2 py-1 text-left hover:bg-[var(--vigil-hover)]"
          onClick={() => setPanelOpen(true)}
        >
          Last scan: {lastScan.summary.total} finding(s)
          {lastScan.summary.high
            ? ` · ${lastScan.summary.high} high`
            : ""}
          {lastScan.target ? ` → ${lastScan.target}` : ""}
        </button>
      )}
      <div className="mb-1 text-[10px] font-medium uppercase text-[var(--vigil-muted)]">
        Allowlist
      </div>
      {hosts.length === 0 ? (
        <div className="mb-1 text-[var(--vigil-muted)]">
          Empty (localhost always allowed)
        </div>
      ) : (
        <ul className="mb-1 max-h-24 space-y-0.5 overflow-auto">
          {hosts.map((h) => (
            <li
              key={h.host}
              className="flex items-center justify-between gap-1 rounded px-1 hover:bg-[var(--vigil-hover)]"
            >
              <span className="truncate font-mono">{h.host}</span>
              <button
                type="button"
                className="shrink-0 text-[10px] text-[var(--vigil-danger)]"
                onClick={() => void removeHost(h.host)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1">
        <input
          value={hostInput}
          onChange={(e) => setHostInput(e.target.value)}
          placeholder="example.com"
          className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-[11px]"
        />
        <label className="flex items-start gap-1.5 text-[10px] text-[var(--vigil-muted)]">
          <input
            type="checkbox"
            checked={confirmOwn}
            onChange={(e) => setConfirmOwn(e.target.checked)}
            className="mt-0.5"
          />
          I own / am authorized to test this host (مطلوب للاستضافة البعيدة)
        </label>
        <button
          type="button"
          disabled={busy || !hostInput.trim()}
          className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={() => {
            void addHost(hostInput.trim(), confirmOwn).then(() => {
              setHostInput("");
              setConfirmOwn(false);
            });
          }}
        >
          Add host
        </button>
      </div>
      {error && (
        <div className="mt-1.5 rounded border border-[var(--vigil-danger)]/30 px-2 py-1 text-[10px] text-[var(--vigil-danger)]">
          {error}
        </div>
      )}
    </div>
  );
}
