import { useMemo, useState } from "react";
import { useTabsStore } from "../../../store/tabsStore";
import { upsertChatSession } from "../../../lib/db";

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
  const { history, tabs, restoreFromHistory, deleteFromHistory } =
    useTabsStore();
  const [query, setQuery] = useState("");

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
      <div className="mb-2 text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
        Vigil History
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search history"
        className="mb-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1 text-xs"
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-auto">
        {groups.length === 0 && (
          <div className="text-xs text-[var(--vigil-muted)]">
            No archived chats yet — close a tab to archive it.
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
                  onClick={() => restoreFromHistory(h.id)}
                  className="min-w-0 flex-1 truncate py-1 text-left text-xs"
                  title="Restore tab"
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
                    if (title) {
                      useTabsStore.setState((s) => ({
                        history: s.history.map((x) =>
                          x.id === h.id ? { ...x, title } : x,
                        ),
                      }));
                      void upsertChatSession({
                        id: h.id,
                        title,
                        messagesJson: JSON.stringify(h.messages),
                        archived: true,
                      }).catch(() => undefined);
                    }
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="hidden px-1 text-[10px] text-[var(--vigil-danger)] group-hover:inline"
                  title="Delete"
                  onClick={() => {
                    if (!window.confirm(`Delete “${h.title}”?`)) return;
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
