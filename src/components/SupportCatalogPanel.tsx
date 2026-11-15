import { useEffect, useMemo, useState } from "react";
import {
  describeTableUi,
  getObjectDdlUi,
  listDatabasesUi,
  patchDbProfileUi,
  useDatabaseUi,
  type SqlCatalogObject,
} from "../lib/db-sidecar";
import { useComposerContextStore } from "../store/composerContextStore";
import { useSqlCatalogStore } from "../store/sqlCatalogStore";
import { useSqlSessionStore } from "../store/sqlSessionStore";
import { useSqlWorkbenchStore } from "../store/sqlWorkbenchStore";

type Props = { compact?: boolean };
type KindFilter = "all" | "table" | "view" | "routine";

function isRoutine(type: string): boolean {
  const t = type.toUpperCase();
  return (
    t.includes("PROCEDURE") ||
    t.includes("FUNCTION") ||
    t.includes("ROUTINE") ||
    t.includes("AGGREGATE")
  );
}

function isView(type: string): boolean {
  return type.toUpperCase().includes("VIEW");
}

function isTable(type: string): boolean {
  const t = type.toUpperCase();
  return t.includes("TABLE") && !isView(t) && !isRoutine(t);
}

/** Visual DB catalog + switch DB + SQL/DDL/@table actions. */
export function SupportCatalogPanel({ compact = false }: Props) {
  const connected = useSqlSessionStore((s) => s.connected);
  const label = useSqlSessionStore((s) => s.label);
  const engine = useSqlSessionStore((s) => s.engine);
  const activeDatabase = useSqlSessionStore((s) => s.database);
  const profileId = useSqlSessionStore((s) => s.profileId);
  const setSession = useSqlSessionStore((s) => s.setSession);
  const refreshCatalog = useSqlCatalogStore((s) => s.refresh);
  const catalogObjects = useSqlCatalogStore((s) => s.objects);
  const catalogLoading = useSqlCatalogStore((s) => s.loading);
  const addSqlTable = useComposerContextStore((s) => s.addSqlTable);
  const openSelectForTable = useSqlWorkbenchStore((s) => s.openSelectForTable);
  const loadDraftSql = useSqlWorkbenchStore((s) => s.loadDraftSql);

  const [databases, setDatabases] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [expandedDb, setExpandedDb] = useState(true);
  const [collapsedSchemas, setCollapsedSchemas] = useState<Record<string, boolean>>(
    {},
  );
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
    let list = catalogObjects.length
      ? catalogObjects
      : ([] as SqlCatalogObject[]);
    if (kindFilter === "table") list = list.filter((o) => isTable(o.type));
    else if (kindFilter === "view") list = list.filter((o) => isView(o.type));
    else if (kindFilter === "routine")
      list = list.filter((o) => isRoutine(o.type));
    if (q) {
      list = list.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.schema.toLowerCase().includes(q) ||
          `${o.schema}.${o.name}`.toLowerCase().includes(q) ||
          o.type.toLowerCase().includes(q),
      );
    }
    return list.slice(0, compact ? 60 : 200);
  }, [catalogObjects, filter, kindFilter, compact]);

  const bySchema = useMemo(() => {
    const map = new Map<string, SqlCatalogObject[]>();
    for (const obj of filtered) {
      const key = obj.schema || "(default)";
      const arr = map.get(key) || [];
      arr.push(obj);
      map.set(key, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  async function onAdd(obj: SqlCatalogObject) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      let columnsPreview = "";
      if (!isRoutine(obj.type)) {
        try {
          columnsPreview = await describeTableUi({
            table: obj.name,
            schema: obj.schema,
          });
        } catch {
          /* optional */
        }
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

  async function onUseDatabase(db: string) {
    if (!db || db === activeDatabase) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const session = await useDatabaseUi(db);
      setSession({
        connected: !!session.connected,
        engine: session.engine,
        profileId: session.profileId,
        label: session.label,
        database: session.database,
        readOnly: session.readOnly !== false,
      });
      if (profileId || session.profileId) {
        try {
          await patchDbProfileUi(String(profileId || session.profileId), {
            lastDatabase: db,
          });
        } catch {
          /* optional */
        }
      }
      await refreshCatalog();
      setExpandedDb(true);
      setNote(`Using database ${db}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDdl(obj: SqlCatalogObject) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { ddl, kind } = await getObjectDdlUi({
        table: obj.name,
        schema: obj.schema,
        kind: isRoutine(obj.type)
          ? obj.type.toUpperCase().includes("FUNC")
            ? "function"
            : "procedure"
          : isView(obj.type)
            ? "view"
            : "auto",
      });
      if (!ddl) throw new Error("Empty DDL");
      loadDraftSql(`-- ${kind || "DDL"}: ${obj.schema}.${obj.name}\n${ddl}`);
      setNote(`DDL loaded → SQL panel (${kind || "object"})`);
      setPreview(ddl.slice(0, 1200));
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
        Catalog — وصّل أولًا عشان تشوف الجداول والإجراءات.
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
        className="mb-1 text-start text-[10px] text-[var(--vigil-muted)] hover:underline"
        onClick={() => setExpandedDb((v) => !v)}
      >
        {expandedDb ? "▾" : "▸"} Databases ({databases.length})
      </button>
      {activeDatabase ? (
        <p className="mb-1 text-[10px] text-[var(--vigil-muted)]">
          Active DB:{" "}
          <span className="font-mono text-[var(--vigil-text)]">
            {activeDatabase}
          </span>
        </p>
      ) : null}
      {expandedDb && databases.length > 0 ? (
        <ul className="mb-2 max-h-24 overflow-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-1 font-mono text-[10px]">
          {databases.map((db) => {
            const active = db === activeDatabase;
            return (
              <li
                key={db}
                className="flex items-center justify-between gap-1 px-1 py-0.5"
              >
                <span
                  className={`min-w-0 truncate ${active ? "font-semibold" : ""}`}
                >
                  {active ? "● " : ""}
                  {db}
                </span>
                <button
                  type="button"
                  disabled={busy || active}
                  className="shrink-0 rounded border border-[var(--vigil-border)] px-1 py-0.5 hover:bg-[var(--vigil-hover)] disabled:opacity-40"
                  onClick={() => void onUseDatabase(db)}
                  title="Switch active database"
                >
                  Use
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="mb-2 flex flex-wrap gap-1">
        {(
          [
            ["all", "All"],
            ["table", "Tables"],
            ["view", "Views"],
            ["routine", "Procs"],
          ] as const
        ).map(([id, labelBtn]) => (
          <button
            key={id}
            type="button"
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              kindFilter === id
                ? "border-[var(--vigil-accent)] bg-[var(--vigil-accent-soft)] text-[var(--vigil-accent)]"
                : "border-[var(--vigil-border)] hover:bg-[var(--vigil-hover)]"
            }`}
            onClick={() => setKindFilter(id)}
          >
            {labelBtn}
          </button>
        ))}
      </div>

      <input
        className="mb-2 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
        placeholder="Search schema/table/proc… أو @table: في الشات"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      <div className="max-h-56 overflow-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)]">
        {bySchema.length === 0 ? (
          <p className="p-2 text-[10px] text-[var(--vigil-muted)]">
            {catalogLoading ? "Loading…" : "No objects. Click Refresh."}
          </p>
        ) : (
          bySchema.map(([schema, objs]) => {
            const collapsed = collapsedSchemas[schema] === true;
            return (
              <div key={schema}>
                <button
                  type="button"
                  className="sticky top-0 flex w-full items-center justify-between bg-[var(--vigil-panel)] px-2 py-1 text-start text-[10px] font-semibold hover:bg-[var(--vigil-hover)]"
                  onClick={() =>
                    setCollapsedSchemas((s) => ({
                      ...s,
                      [schema]: !collapsed,
                    }))
                  }
                >
                  <span>
                    {collapsed ? "▸" : "▾"} {schema}
                  </span>
                  <span className="text-[var(--vigil-muted)]">{objs.length}</span>
                </button>
                {!collapsed
                  ? objs.map((obj) => (
                      <div
                        key={`${obj.schema}.${obj.name}.${obj.type}`}
                        className="flex items-center justify-between gap-2 border-b border-[var(--vigil-border-soft)] px-2 py-1 last:border-0"
                      >
                        <span className="min-w-0 truncate font-mono text-[10px]">
                          {obj.name}
                          <span className="text-[var(--vigil-muted)]">
                            {" "}
                            ({String(obj.type).replace("BASE ", "")})
                          </span>
                        </span>
                        <span className="flex shrink-0 gap-1">
                          {!isRoutine(obj.type) ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
                              onClick={() => {
                                openSelectForTable({
                                  schema: obj.schema,
                                  name: obj.name,
                                  engine,
                                });
                                setNote(
                                  `SQL: SELECT * FROM ${obj.schema}.${obj.name}`,
                                );
                              }}
                              title="Open SELECT in SQL panel"
                            >
                              SQL
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
                            onClick={() => void onDdl(obj)}
                            title="Load DDL into SQL panel"
                          >
                            DDL
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
                            onClick={() => void onAdd(obj)}
                            title="Add to chat as @table"
                          >
                            @table
                          </button>
                        </span>
                      </div>
                    ))
                  : null}
              </div>
            );
          })
        )}
      </div>

      {note ? (
        <p className="mt-2 text-[10px] text-[var(--vigil-muted)]">{note}</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[10px] text-[var(--vigil-danger)]">{error}</p>
      ) : null}
      {preview && !compact ? (
        <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-2 font-mono text-[10px]">
          {preview}
        </pre>
      ) : null}
    </div>
  );
}
