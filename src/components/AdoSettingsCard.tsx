import { useCallback, useEffect, useState } from "react";
import {
  deleteAdoPat,
  emptyAdoSettings,
  hasAdoPat,
  loadAdoSettings,
  saveAdoPat,
  saveAdoSettings,
  type AdoSettings,
} from "../lib/ado-settings";

/** Settings → Azure DevOps (PAT + org/project). */
export function AdoSettingsCard() {
  const [settings, setSettings] = useState<AdoSettings>(emptyAdoSettings());
  const [pat, setPat] = useState("");
  const [hasPat, setHasPat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSettings(await loadAdoSettings());
      setHasPat(await hasAdoPat());
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSaveSettings() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await saveAdoSettings(settings);
      if (pat.trim()) {
        await saveAdoPat(pat.trim());
        setPat("");
        setHasPat(true);
      }
      setNote("Saved Azure DevOps settings.");
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClearPat() {
    setBusy(true);
    setError(null);
    try {
      await deleteAdoPat();
      setHasPat(false);
      setNote("PAT removed.");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded border border-[var(--vigil-border)] p-4 text-sm">
      <p className="text-xs text-[var(--vigil-muted)]">
        PAT stays in the local vault (never Firestore / never{" "}
        <code>.vigil/ado-settings.json</code>). Create a PAT with Work Items
        (Read &amp; Write). Entra OAuth comes later.
      </p>

      <label className="block">
        <span className="text-xs text-[var(--vigil-muted)]">Organization</span>
        <input
          className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5"
          value={settings.organization}
          onChange={(e) =>
            setSettings((s) => ({ ...s, organization: e.target.value }))
          }
          placeholder="contoso"
        />
      </label>

      <label className="block">
        <span className="text-xs text-[var(--vigil-muted)]">Project</span>
        <input
          className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5"
          value={settings.project}
          onChange={(e) =>
            setSettings((s) => ({ ...s, project: e.target.value }))
          }
          placeholder="MyProject"
        />
      </label>

      <label className="block">
        <span className="text-xs text-[var(--vigil-muted)]">
          Area path (optional)
        </span>
        <input
          className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5"
          value={settings.areaPath || ""}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              areaPath: e.target.value || undefined,
            }))
          }
        />
      </label>

      <label className="block">
        <span className="text-xs text-[var(--vigil-muted)]">
          Default work item type
        </span>
        <select
          className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5"
          value={settings.defaultWorkItemType}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              defaultWorkItemType: e.target.value as AdoSettings["defaultWorkItemType"],
            }))
          }
        >
          <option value="Bug">Bug</option>
          <option value="Task">Task</option>
          <option value="User Story">User Story</option>
        </select>
      </label>

      <label className="block">
        <span className="text-xs text-[var(--vigil-muted)]">
          Personal Access Token {hasPat ? "(saved)" : "(not set)"}
        </span>
        <input
          type="password"
          className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder={hasPat ? "•••••••• (leave blank to keep)" : "PAT"}
          autoComplete="off"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-xs !text-white disabled:opacity-50"
          onClick={() => void onSaveSettings()}
        >
          Save
        </button>
        {hasPat ? (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs hover:bg-[var(--vigil-hover)]"
            onClick={() => void onClearPat()}
          >
            Clear PAT
          </button>
        ) : null}
      </div>

      {note ? <p className="text-xs text-[var(--vigil-muted)]">{note}</p> : null}
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
