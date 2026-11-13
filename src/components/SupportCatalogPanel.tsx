import { useEffect, useMemo, useState } from "react";
import {
  describeTableUi,
  listDatabasesUi,
  listObjectsUi,
  type SqlCatalogObject,
} from "../lib/db-sidecar";
import { useComposerContextStore } from "../store/composerContextStore";
import { useSqlCatalogStore } from "../store/sqlCatalogStore";
import { useSqlSessionStore } from "../store/sqlSessionStore";

type Props = { compact?: boolean };

/** Visual DB catalog tree + Add to chat (@table). */
export function SupportCatalogPanel({ compact = false }: Props) {
  const connected = useSqlSessionStore((s) => s.connected);
  const label = useSqlSessionStore((s) => s.label);
  const refreshCatalog = useSqlCatalogStore((s) => s.refresh);
  const catalogObjects = useSqlCatalogStore((s) => s.objects);
  const catalogLoading = useSqlCatalogStore((s) => s.loading);
  const addSqlTable = useComposerContextStore((s) => s.addSqlTable);

  const [databases, setDatabases] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [expandedDb, setExpandedDb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");

  useEffect(() => {
    if (!connected) {
      useSqlCatalogStore.getState().clear();
      setDatabases([]);
      return;
    }
    void (async () => {
      try {
        const dbs = await listDatabasesUi();
        setDatabases(dbs);
      } catch {
        setDatabases([]);
      }
      await refreshCatalog();
    })();
  }, [connected, refreshCatalog]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = catalogObjects.length
      ? catalogObjects
      : ([] as SqlCatalogObject[]);
    if (!q) return list.slice(0, compact ? 40 : 120);
    return list
      .filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.schema.toLowerCase().includes(q) ||
          `${o.schema}.${o.name}`.toLowerCase().includes(q),
      )
      .slice(0, compact ? 40 : 120);
  }, [catalogObjects, filter, compact]);

  async function onAdd(obj: SqlCatalogObject) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      let columnsPreview = "";
      try {
        columnsPreview = await describeTableUi({
          table: obj.name,
          schema: obj.schema,
        });
      } catch {
        /* optional */
      }
      addSqlTable({
        schema: obj.schema,
        name: obj.name,
        columnsPreview: columnsPreview.slice(0, 4000),
        connectionLabel: label,
      });
      setNote(`Added @table:${obj.schema}.${obj.name} to chat`);
      setPreview(columnsPreview.slice(0, 800));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRefresh() {
    setBusy(true);
    setError(null);
    try {
      const objs = await listObjectsUi({ kind: "all" });
      if (!objs.length) {
        /* still refresh store */
      }
      await refreshCatalog();
      const dbs = await listDatabasesUi().catch(() => []);
      setDatabases(dbs);
      setNote(`Loaded ${useSqlCatalogStore.getState().objects.length} objects`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!connected) {
    return (
      <div
        className={
          compact
            ? "mb-3 rounded border border-[var(--vigil-border)] p-2 text-[11px] text-[var(--vigil-muted)]"
            : "rounded border border-[var(--vigil-border)] p-4 text-sm text-[var(--vigil-muted)]"
        }
      >
        Catalog — connect a DB first to browse tables.
      </div>
    );
  }

  return (
    <div
      className={
        compact
          ? "mb-3 rounded border border-[var(--vigil-border)] p-2 text-[11px]"
          : "rounded border border-[var(--vigil-border)] p-4 text-sm"
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold uppercase text-[var(--vigil-muted)]">
          DB Catalog
        </span>
        <button
          type="button"
          disabled={busy || catalogLoading}
          className="rounded border border-[var(--vigil-border)] px-2 py-0.5 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={() => void onRefresh()}
        >
          Refresh
        </button>
      </div>

      <button
        type="button"
        className="mb-2 text-start text-[10px] text-[var(--vigil-muted)] hover:underline"
        onClick={() => setExpandedDb((v) => !v)}
      >
        {expandedDb ? "▾" : "▸"} Databases ({databases.length})
      </button>
      {expandedDb && databases.length > 0 ? (
        <ul className="mb-2 max-h-24 overflow-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-1 font-mono text-[10px]">
          {databases.map((db) => (
            <li key={db} className="truncate px-1 py-0.5">
              {db}
            </li>
          ))}
        </ul>
      ) : null}

      <input
        className="mb-2 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
        placeholder="Search tables… or type @table: in chat"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      <ul className="max-h-48 overflow-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)]">
        {filtered.length === 0 ? (
          <li className="p-2 text-[var(--vigil-muted)]">
            {catalogLoading ? "Loading…" : "No objects. Click Refresh."}
          </li>
        ) : (
          filtered.map((obj) => (
            <li
              key={`${obj.schema}.${obj.name}`}
              className="flex items-center justify-between gap-2 border-b border-[var(--vigil-border)] px-2 py-1 last:border-0"
            >
              <span className="min-w-0 truncate font-mono text-[10px]">
                {obj.schema}.{obj.name}
                <span className="text-[var(--vigil-muted)]">
                  {" "}
                  ({String(obj.type).replace("BASE ", "")})
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                className="shrink-0 rounded border border-[var(--vigil-border)] px-1.5 py-0.5 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
                onClick={() => void onAdd(obj)}
                title="Add to chat as @table"
              >
                @table
              </button>
            </li>
          ))
        )}
      </ul>

      {note ? <p className="mt-2 text-[10px] text-[var(--vigil-muted)]">{note}</p> : null}
      {error ? <p className="mt-2 text-[10px] text-red-500">{error}</p> : null}
      {preview && !compact ? (
        <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-2 font-mono text-[10px]">
          {preview}
        </pre>
      ) : null}
    </div>
  );
}
