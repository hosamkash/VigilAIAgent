import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Status = {
  platform: string;
  installed: boolean;
  hint: string;
};

export function OsOpenMenuCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const next = await invoke<Status>("os_open_menu_status");
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const windows = status?.platform === "windows";

  async function install() {
    setBusy(true);
    try {
      const next = await invoke<Status>("install_os_open_menu");
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function uninstall() {
    setBusy(true);
    try {
      const next = await invoke<Status>("uninstall_os_open_menu");
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl rounded border border-[var(--vigil-border)] p-3">
      <div className="text-sm font-semibold">Open with Vigil</div>
      <p className="mt-1 text-[12px] text-[var(--vigil-muted)]">
        زي Cursor: كليك يمين على مجلد في Explorer (ويندوز) أو Open With على
        المجلد في Finder (ماك).
      </p>
      {status ? (
        <p className="mt-2 text-[12px] text-[var(--vigil-text)]">{status.hint}</p>
      ) : (
        <p className="mt-2 text-[12px] text-[var(--vigil-muted)]">Checking…</p>
      )}
      {windows ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy || status?.installed}
            className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-xs text-white disabled:opacity-50"
            onClick={() => void install()}
          >
            Install Explorer menu
          </button>
          <button
            type="button"
            disabled={busy || !status?.installed}
            className="rounded border border-[var(--vigil-border)] px-2 py-1 text-xs disabled:opacity-50"
            onClick={() => void uninstall()}
          >
            Remove
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-2 text-[11px] text-[var(--vigil-danger)]">{error}</p>
      ) : null}
    </div>
  );
}
