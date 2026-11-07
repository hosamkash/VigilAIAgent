import { useMemo, useState } from "react";
import { useTabsStore } from "../../../store/tabsStore";

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

type GroupKey = "Today" | "Yesterday" | "This Week" | "Older";

function groupFor(updatedAt: number, now = Date.now()): GroupKey {
  const today = startOfDay(now);
  const yesterday = today - 86400000;
  const week = today - 7 * 86400000;
  const day = startOfDay(updatedAt);
  if (day >= today) return "Today";
  if (day >= yesterday) return "Yesterday";
  if (day >= week) return "This Week";
  return "Older";
}

export function HistorySidebar() {
  const {
    history,
    tabs,
    hydrated,
    hydrateError,
    restoreFromHistory,
    deleteFromHistory,
    renameHistoryItem,
    hydrate,
  } = useTabsStore();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter(
      (h) =>
        !q ||
        h.title.toLowerCase().includes(q) ||
        h.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [history, query]);

  const groups = useMemo(() => {
    const order: GroupKey[] = ["Today", "Yesterday", "This Week", "Older"];
    const map = new Map<GroupKey, typeof items>();
    for (const key of order) map.set(key, []);
    for (const item of items) {
      const g = groupFor(item.updatedAt ?? Date.now());
      map.get(g)!.push(item);
    }
    return order
      .map((key) => ({ key, items: map.get(key)! }))
      .filter((g) => g.items.length > 0);
  }, [items]);

  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-2 flex items-center justify-between gap-2 pr-12">
        <div className="text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
          Vigil History
        </div>
        <button
          type="button"
          className="text-[10px] text-[var(--vigil-accent)] hover:underline"
          onClick={() => {
            useTabsStore.setState({ hydrated: false });
            void hydrate();
          }}
          title="Reload from VigilDB"
        >
          Refresh
        </button>
      </div>

      <div className="mb-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-hover)] px-2 py-1 text-[10px] text-[var(--vigil-muted)]">
        Saved in VigilDB ·{" "}
        <code className="text-[var(--vigil-text)]">
          VigilAgent.chatSessions
        </code>
        {!hydrated ? " · loading…" : ` · ${history.length} archived`}
      </div>

      {hydrateError && (
        <div className="mb-2 rounded border border-[var(--vigil-danger)]/30 px-2 py-1 text-[10px] text-[var(--vigil-danger)]">
          {hydrateError}
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search history"
        className="mb-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-xs"
      />

      <div className="min-h-0 flex-1 space-y-3 overflow-auto">
        {groups.length === 0 && (
          <div className="text-xs text-[var(--vigil-muted)]">
            No archived chats yet — close a chat tab to save it in VigilDB.
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
              {g.key}
            </div>
            {g.items.map((h) => (
              <div
                key={h.id}
                className="group mb-0.5 flex items-center gap-1 rounded px-1 hover:bg-[var(--vigil-hover)]"
              >
                <button
                  type="button"
                  disabled={busyId === h.id}
                  onClick={() => {
                    setBusyId(h.id);
                    void restoreFromHistory(h.id).finally(() =>
                      setBusyId(null),
                    );
                  }}
                  className="min-w-0 flex-1 truncate py-1 text-left text-xs"
                  title="Restore into a chat tab"
                >
                  {h.title}
                  <span className="ml-1 text-[10px] text-[var(--vigil-muted)]">
                    ({h.messages.length})
                  </span>
                </button>
                <button
                  type="button"
                  className="hidden px-1 text-[10px] group-hover:inline"
                  title="Rename"
                  onClick={() => {
                    const title = window.prompt("Rename", h.title);
                    if (title?.trim()) {
                      void renameHistoryItem(h.id, title.trim());
                    }
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="hidden px-1 text-[10px] text-[var(--vigil-danger)] group-hover:inline"
                  title="Delete from VigilDB"
                  onClick={() => {
                    if (!window.confirm(`Delete “${h.title}” from VigilDB?`)) {
                      return;
                    }
                    void deleteFromHistory(h.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {tabs.length > 0 && (
        <div className="mt-2 border-t border-[var(--vigil-border)] pt-2 text-[10px] text-[var(--vigil-muted)]">
          {tabs.length} open chat tab{tabs.length === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
