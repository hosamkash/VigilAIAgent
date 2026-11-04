import { useState } from "react";
import { useExplorerStore } from "../../../store/explorerStore";
import { useEditorTabsStore } from "../../../store/editorTabsStore";
import { runWorkspaceCommand, readTextFile } from "../../../lib/workspace-fs";
import {
  buildRgCommand,
  loadSearchHistory,
  parseRgOutput,
  pushSearchHistory,
  type SearchHit,
  type SearchHistoryEntry,
} from "../../../lib/search";

export function SearchSidebar() {
  const { root, searchQuery, setSearchQuery } = useExplorerStore();
  const openFile = useEditorTabsStore((s) => s.openFile);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("node_modules,dist,target,.git");
  const [replace, setReplace] = useState("");
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [history, setHistory] = useState<SearchHistoryEntry[]>(() =>
    loadSearchHistory(),
  );
  const [error, setError] = useState<string | null>(null);

  async function onSearch(q = searchQuery) {
    if (!root || !q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const cmd = buildRgCommand(q, include, exclude);
      const out = await runWorkspaceCommand(cmd, root);
      const parsed = parseRgOutput(out).slice(0, 300);
      setHits(parsed);
      setHistory(pushSearchHistory({ query: q, include, exclude }));
      useExplorerStore
        .getState()
        .setSearchResults(parsed.map((h) => h.raw));
    } catch (err) {
      setError(String(err));
      setHits([]);
    } finally {
      setBusy(false);
    }
  }

  async function openHit(hit: SearchHit) {
    if (!root) return;
    const abs = hit.path.startsWith("/")
      ? hit.path
      : `${root.replace(/\/$/, "")}/${hit.path}`;
    try {
      const content = await readTextFile(abs);
      openFile({ path: abs, content, revealLine: hit.line });
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-2 text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
        Search
      </div>
      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void onSearch();
        }}
        placeholder="Search"
        className="mb-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1 text-xs"
      />
      <input
        value={include}
        onChange={(e) => setInclude(e.target.value)}
        placeholder="files to include (e.g. *.ts)"
        className="mb-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1 text-xs"
      />
      <input
        value={exclude}
        onChange={(e) => setExclude(e.target.value)}
        placeholder="files to exclude"
        className="mb-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1 text-xs"
      />
      <input
        value={replace}
        onChange={(e) => setReplace(e.target.value)}
        placeholder="Replace (coming soon)"
        disabled
        className="mb-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1 text-xs opacity-50"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => void onSearch()}
        className="mb-2 rounded bg-[var(--vigil-accent)] px-2 py-1 text-xs text-white disabled:opacity-40"
      >
        {busy ? "Searching…" : "Search"}
      </button>
      {error && (
        <div className="mb-2 text-[11px] text-[var(--vigil-danger)]">{error}</div>
      )}
      {history.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[10px] uppercase text-[var(--vigil-muted)]">
            History
          </div>
          <div className="flex max-h-16 flex-wrap gap-1 overflow-auto">
            {history.slice(0, 8).map((h) => (
              <button
                key={h.id}
                type="button"
                className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] hover:bg-[var(--vigil-hover)]"
                onClick={() => {
                  setSearchQuery(h.query);
                  setInclude(h.include);
                  setExclude(h.exclude);
                  void onSearch(h.query);
                }}
              >
                {h.query}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mb-1 text-[10px] text-[var(--vigil-muted)]">
        {hits.length} result{hits.length === 1 ? "" : "s"}
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto">
        {hits.map((hit, i) => (
          <button
            key={`${hit.raw}-${i}`}
            type="button"
            onClick={() => void openHit(hit)}
            className="block w-full truncate rounded px-1 py-1 text-left hover:bg-[var(--vigil-hover)]"
            title={hit.raw}
          >
            <div className="truncate text-[11px] text-[var(--vigil-accent)]">
              {hit.path}:{hit.line}
            </div>
            <div className="truncate font-mono text-[10px] text-[var(--vigil-muted)]">
              {hit.preview}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
