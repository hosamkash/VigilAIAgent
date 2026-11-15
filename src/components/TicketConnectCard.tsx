import { useCallback, useEffect, useState } from "react";
import { AdoSettingsCard } from "./AdoSettingsCard";
import { githubBrowserLogin } from "../lib/git-oauth";
import {
  emptyTicketConnectSettings,
  loadTicketConnectSettings,
  platformNeeds,
  saveTicketConnectSettings,
  type TicketConnectSettings,
} from "../lib/ticket-connect-settings";
import {
  deleteTicketPat,
  hasTicketPat,
  saveTicketPat,
} from "../lib/ticket-vault";
import type { TicketPlatformId } from "../lib/ticket-platforms";

export function TicketConnectCard({ platformId }: { platformId: TicketPlatformId }) {
  if (platformId === "azure-devops") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-[var(--vigil-muted)]">
          PAT يتخزن محليًا في الـ vault — مش في Firestore. بعد الحفظ تقدر تنشر
          المسودات كـ Work Items.
        </p>
        <AdoSettingsCard />
      </div>
    );
  }

  return <GenericTokenConnect platformId={platformId} />;
}

function GenericTokenConnect({ platformId }: { platformId: TicketPlatformId }) {
  const [settings, setSettings] = useState<TicketConnectSettings>(
    emptyTicketConnectSettings(),
  );
  const [pat, setPat] = useState("");
  const [hasPat, setHasPat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSettings(await loadTicketConnectSettings());
      setHasPat(await hasTicketPat(platformId));
    } catch (err) {
      setError(String(err));
    }
  }, [platformId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSave() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await saveTicketConnectSettings(settings);
      if (pat.trim()) {
        await saveTicketPat(platformId, pat.trim());
        setPat("");
        setHasPat(true);
      }
      setNote("Saved. Token stays in the local vault.");
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onGithubSignIn() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const token = await githubBrowserLogin();
      await saveTicketPat("github", token);
      setHasPat(true);
      setNote("GitHub sign-in saved locally.");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    setBusy(true);
    setError(null);
    try {
      await deleteTicketPat(platformId);
      setHasPat(false);
      setNote("Token removed.");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const gh = settings.github || { owner: "", repo: "" };
  const gl = settings.gitlab || { host: "https://gitlab.com", projectId: "" };
  const jira = settings.jira || { site: "", email: "", projectKey: "" };
  const linear = settings.linear || { teamId: "" };
  const clickup = settings.clickup || { listId: "" };

  return (
    <div className="space-y-3 rounded border border-[var(--vigil-border)] p-4 text-sm">
      <p className="text-xs text-[var(--vigil-muted)]">{platformNeeds(platformId)}</p>
      {hasPat ? (
        <p className="text-xs text-emerald-600">Token on file for this platform.</p>
      ) : (
        <p className="text-xs text-amber-700">Not connected yet.</p>
      )}

      {platformId === "github" ? (
        <>
          <Field
            label="Owner"
            value={gh.owner || ""}
            onChange={(v) =>
              setSettings({ ...settings, github: { ...gh, owner: v } })
            }
          />
          <Field
            label="Repository"
            value={gh.repo || ""}
            onChange={(v) =>
              setSettings({ ...settings, github: { ...gh, repo: v } })
            }
          />
          <button
            type="button"
            disabled={busy}
            className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-xs !text-white disabled:opacity-50"
            onClick={() => void onGithubSignIn()}
          >
            Sign in with GitHub
          </button>
        </>
      ) : null}

      {platformId === "gitlab" ? (
        <>
          <Field
            label="Host"
            value={gl.host || "https://gitlab.com"}
            onChange={(v) =>
              setSettings({ ...settings, gitlab: { ...gl, host: v } })
            }
          />
          <Field
            label="Project ID"
            value={gl.projectId || ""}
            onChange={(v) =>
              setSettings({ ...settings, gitlab: { ...gl, projectId: v } })
            }
          />
        </>
      ) : null}

      {platformId === "jira" ? (
        <>
          <Field
            label="Site (xxx.atlassian.net)"
            value={jira.site || ""}
            onChange={(v) =>
              setSettings({ ...settings, jira: { ...jira, site: v } })
            }
          />
          <Field
            label="Email"
            value={jira.email || ""}
            onChange={(v) =>
              setSettings({ ...settings, jira: { ...jira, email: v } })
            }
          />
          <Field
            label="Project key"
            value={jira.projectKey || ""}
            onChange={(v) =>
              setSettings({ ...settings, jira: { ...jira, projectKey: v } })
            }
          />
        </>
      ) : null}

      {platformId === "linear" ? (
        <Field
          label="Team ID"
          value={linear.teamId || ""}
          onChange={(v) =>
            setSettings({ ...settings, linear: { ...linear, teamId: v } })
          }
        />
      ) : null}

      {platformId === "clickup" ? (
        <Field
          label="List ID"
          value={clickup.listId || ""}
          onChange={(v) =>
            setSettings({ ...settings, clickup: { ...clickup, listId: v } })
          }
        />
      ) : null}

      <label className="block">
        <span className="text-xs text-[var(--vigil-muted)]">
          API token / PAT (stored in vault)
        </span>
        <input
          type="password"
          className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder={hasPat ? "•••••••• (leave blank to keep)" : ""}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-xs !text-white disabled:opacity-50"
          onClick={() => void onSave()}
        >
          Save
        </button>
        {hasPat ? (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs hover:bg-[var(--vigil-hover)]"
            onClick={() => void onClear()}
          >
            Remove token
          </button>
        ) : null}
      </div>
      {note ? <p className="text-xs text-emerald-600">{note}</p> : null}
      {error ? <p className="text-xs text-[var(--vigil-danger)]">{error}</p> : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--vigil-muted)]">{label}</span>
      <input
        className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
