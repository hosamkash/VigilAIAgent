import { useState } from "react";
import {
  sqlActivityLiveUi,
  sqlCaptureStartUi,
  sqlCaptureStopUi,
} from "../lib/db-sidecar";
import { useSqlSessionStore } from "../store/sqlSessionStore";

type Props = { compact?: boolean };

/** Vigil Profiler — Start/Stop capture around opening a report. */
export function SupportActivityCard({ compact = false }: Props) {
  const connected = useSqlSessionStore((s) => s.connected);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [log, setLog] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function onLive() {
    setBusy(true);
    setError(null);
    try {
      const r = await sqlActivityLiveUi();
      setLog(r.output || `(${r.count} rows)`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onStart() {
    setBusy(true);
    setError(null);
    try {
      const msg = await sqlCaptureStartUi({ maxMs: 15000 });
      setCapturing(true);
      setLog(msg);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onStop() {
    setBusy(true);
    setError(null);
    try {
      const r = await sqlCaptureStopUi();
      setCapturing(false);
      setLog(r.output || `(${r.count} events)`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={
        compact
          ? "mb-3 rounded border border-[var(--vigil-border)] p-2 text-[11px]"
          : "rounded border border-[var(--vigil-border)] p-4 text-sm"
      }
    >
      <div className="mb-1 font-semibold uppercase text-[var(--vigil-muted)]">
        Activity / Profiler
      </div>
      <p className="mb-2 text-[var(--vigil-muted)]">
        {connected
          ? capturing
            ? "Capturing… open the report / click in the EXE, then Stop."
            : "Start → open report → Stop — see SQL without SSMS Profiler."
          : "Connect a DB first (DB Connections)."}
      </p>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={!connected || busy}
          className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={() => void onLive()}
        >
          Live now
        </button>
        {!capturing ? (
          <button
            type="button"
            disabled={!connected || busy}
            className="rounded bg-[var(--vigil-accent)] px-2 py-1 !text-white disabled:opacity-50"
            onClick={() => void onStart()}
          >
            بدء الالتقاط
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)]"
            onClick={() => void onStop()}
          >
            إيقاف
          </button>
        )}
      </div>
      {error ? <p className="mt-2 text-red-500">{error}</p> : null}
      {log ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-2 font-mono text-[10px]">
          {log}
        </pre>
      ) : null}
    </div>
  );
}
