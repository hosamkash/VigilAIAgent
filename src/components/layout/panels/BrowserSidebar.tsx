import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Globe, Plus, Trash2 } from "lucide-react";
import { useBrowserHistoryStore } from "../../../store/browserHistoryStore";
import { useCloudAuthStore } from "../../../store/cloudAuthStore";
import { useEditorTabsStore } from "../../../store/editorTabsStore";
import { browserTabTitle } from "../../../lib/browser-url";

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function BrowserSidebar() {
  const visits = useBrowserHistoryStore((s) => s.visits);
  const hydrated = useBrowserHistoryStore((s) => s.hydrated);
  const syncError = useBrowserHistoryStore((s) => s.syncError);
  const hydrate = useBrowserHistoryStore((s) => s.hydrate);
  const removeVisit = useBrowserHistoryStore((s) => s.removeVisit);
  const clearAll = useBrowserHistoryStore((s) => s.clearAll);
  const signedIn = Boolean(useCloudAuthStore((s) => s.user?.uid));
  const openBrowser = useEditorTabsStore((s) => s.openBrowser);
  const [query, setQuery] = useState("");
  const [draftUrl, setDraftUrl] = useState("");

  useEffect(() => {
    void hydrate();
  }, [hydrate, signedIn]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visits;
    return visits.filter(
      (v) =>
        v.title.toLowerCase().includes(q) || v.url.toLowerCase().includes(q),
    );
  }, [visits, query]);

  function openUrl(url: string) {
    openBrowser(url, { reuse: "any" });
  }

  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-2 flex items-center justify-between gap-2 pr-12">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
          <Globe className="h-3.5 w-3.5" aria-hidden />
          Browser
        </div>
        <button
          type="button"
          className="text-[10px] text-[var(--vigil-accent)] hover:underline"
          onClick={() => void hydrate()}
          title="Reload history"
        >
          Refresh
        </button>
      </div>

      <div className="mb-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-hover)] px-2 py-1 text-[10px] text-[var(--vigil-muted)]">
        {signedIn
          ? "Links sync to your account (url + title only)"
          : "Saved on this device · sign in to sync across machines"}
        {!hydrated ? " · loading…" : ` · ${visits.length} visits`}
      </div>

      {syncError ? (
        <div className="mb-2 rounded border border-[var(--vigil-danger)]/30 px-2 py-1 text-[10px] text-[var(--vigil-danger)]">
          {syncError}
        </div>
      ) : null}

      <form
        className="mb-2 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const raw = draftUrl.trim();
          if (!raw) {
            openBrowser("", { reuse: "any" });
            return;
          }
          openUrl(raw);
          setDraftUrl("");
        }}
      >
        <input
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          placeholder="Open URL…"
          className="min-w-0 flex-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1 text-[11px] outline-none focus:border-[var(--vigil-accent)]"
        />
        <button
          type="submit"
          title="Open in Vigil Browser"
          aria-label="Open in Vigil Browser"
          className="flex h-7 w-7 items-center justify-center rounded bg-[var(--vigil-accent)] !text-white"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </form>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search history…"
        className="mb-2 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1 text-[11px] outline-none focus:border-[var(--vigil-accent)]"
      />

      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          className="text-[10px] text-[var(--vigil-accent)] hover:underline"
          onClick={() => openBrowser("", { reuse: "none" })}
        >
          New browser tab
        </button>
        {visits.length > 0 ? (
          <button
            type="button"
            className="text-[10px] text-[var(--vigil-danger)] hover:underline"
            onClick={() => {
              if (
                window.confirm(
                  "Clear browser visit history?\n\nThis removes saved links (not cookies or passwords — those were never stored).",
                )
              ) {
                void clearAll();
              }
            }}
          >
            Clear all
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--vigil-border)] px-2 py-4 text-center text-[11px] text-[var(--vigil-muted)]">
            Visit pages in Vigil Browser — they show up here.
          </div>
        ) : (
          filtered.map((visit) => (
            <div
              key={visit.id}
              className="group flex items-start gap-1 rounded border border-transparent px-1.5 py-1.5 hover:border-[var(--vigil-border)] hover:bg-[var(--vigil-hover)]"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                title={visit.url}
                onClick={() => openUrl(visit.url)}
              >
                <div className="truncate text-[12px] text-[var(--vigil-text)]">
                  {visit.title || browserTabTitle(visit.url)}
                </div>
                <div className="truncate text-[10px] text-[var(--vigil-muted)]">
                  {visit.url}
                </div>
                <div className="text-[10px] text-[var(--vigil-muted)]">
                  {formatWhen(visit.visitedAt)}
                </div>
              </button>
              <button
                type="button"
                title="Open"
                aria-label="Open visit"
                className="mt-0.5 rounded p-1 text-[var(--vigil-muted)] opacity-0 hover:text-[var(--vigil-accent)] group-hover:opacity-100"
                onClick={() => openUrl(visit.url)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Remove"
                aria-label="Remove visit"
                className="mt-0.5 rounded p-1 text-[var(--vigil-muted)] opacity-0 hover:text-[var(--vigil-danger)] group-hover:opacity-100"
                onClick={() => void removeVisit(visit.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
