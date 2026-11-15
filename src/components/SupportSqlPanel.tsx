import { useEffect, useMemo, useRef, useState } from "react";
import {
  explainSqlUi,
  runSqlUi,
  setSqlModeUi,
} from "../lib/db-sidecar";
import {
  loadSqlHistory,
  pushSqlHistory,
  removeSqlHistory,
  toggleStarSqlHistory,
  type SqlHistoryEntry,
} from "../lib/sql-history";
import {
  cellDisplay,
  columnsFromRows,
  rowsToCsv,
  type SqlResultRow,
} from "../lib/sql-result-grid";
import { useComposerContextStore } from "../store/composerContextStore";
import { useSqlSessionStore } from "../store/sqlSessionStore";
import { useSqlWorkbenchStore } from "../store/sqlWorkbenchStore";

type Props = { compact?: boolean };

/** Support SQL workbench — editor + grid + history + explain. */
export function SupportSqlPanel({ compact = false }: Props) {
  const connected = useSqlSessionStore((s) => s.connected);
  const readOnly = useSqlSessionStore((s) => s.readOnly);
  const engine = useSqlSessionStore((s) => s.engine);
  const label = useSqlSessionStore((s) => s.label);
  const database = useSqlSessionStore((s) => s.database);
  const profileId = useSqlSessionStore((s) => s.profileId);
  const setSession = useSqlSessionStore((s) => s.setSession);

  const draftSql = useSqlWorkbenchStore((s) => s.draftSql);
  const draftNonce = useSqlWorkbenchStore((s) => s.draftNonce);
  const setDraftSql = useSqlWorkbenchStore((s) => s.setDraftSql);
  const loadDraftSql = useSqlWorkbenchStore((s) => s.loadDraftSql);
  const addSqlSnippet = useComposerContextStore((s) => s.addSqlSnippet);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rows, setRows] = useState<SqlResultRow[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [ranAt, setRanAt] = useState<number | null>(null);
  const [planText, setPlanText] = useState<string>("");
  const [history, setHistory] = useState<SqlHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setHistory(loadSqlHistory());
  }, []);

  useEffect(() => {
    if (draftNonce > 0) {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [draftNonce]);

  const columns = useMemo(() => columnsFromRows(rows), [rows]);

  async function onRun() {
    const sql = draftSql.trim();
    if (!sql) {
      setError("اكتب جملة SQL أولًا.");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    setPlanText("");
    try {
      const result = await runSqlUi({ sql, maxRows: 100 });
      setRows(result.rows);
      setRowCount(result.rowCount);
      setRanAt(Date.now());
      setNote(
        result.rowCount === 0
          ? "0 صفوف"
          : `${result.rowCount} صف${result.rows.length < result.rowCount ? ` (عرض ${result.rows.length})` : ""}`,
      );
      setHistory(
        pushSqlHistory({
          sql,
          ok: true,
          rowCount: result.rowCount,
          engine,
          database,
          profileId,
        }),
      );
    } catch (err) {
      setRows([]);
      setRowCount(0);
      setError(String(err));
      setHistory(
        pushSqlHistory({
          sql,
          ok: false,
          engine,
          database,
          profileId,
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onExplain() {
    const sql = draftSql.trim();
    if (!sql) {
      setError("اكتب جملة SQL أولًا.");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await explainSqlUi({ sql });
      setPlanText(result.output || "(empty plan)");
      setNote("Explain plan جاهز");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function onCopyCsv() {
    if (!rows.length) return;
    const csv = rowsToCsv(rows, columns);
    void navigator.clipboard.writeText(csv).then(
      () => setNote("تم نسخ CSV"),
      () => setError("فشل نسخ الحافظة"),
    );
  }

  function onPinSql() {
    const sql = draftSql.trim();
    if (!sql) return;
    addSqlSnippet({
      title: "query",
      text: sql,
      connectionLabel: label,
    });
    setNote("اتضاف للـ chat كـ snippet");
  }

  function onPinResults() {
    if (!rows.length) return;
    const preview = rowsToCsv(rows.slice(0, 30), columns);
    addSqlSnippet({
      title: "results",
      text: `-- ${rowCount} rows (preview)\n${preview}`,
      connectionLabel: label,
    });
    setNote("نتائج محدودة اتضافت للشات");
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
        SQL — وصّل قاعدة بيانات أولًا (Save profile → Connect)، بعدين Run من هنا.
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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold uppercase text-[var(--vigil-muted)]">
          SQL
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {readOnly ? (
            <span
              className="rounded bg-[var(--vigil-accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--vigil-accent)]"
              title="الجلسة للقراءة فقط"
            >
              Read-only
            </span>
          ) : (
            <span
              className="rounded bg-[rgba(199,46,15,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--vigil-danger)]"
              title="الجمل الكتابية مسموحة"
            >
              WRITE
            </span>
          )}
          {engine ? (
            <span className="text-[10px] text-[var(--vigil-muted)]">
              {engine}
              {database ? ` · ${database}` : ""}
              {label ? ` · ${label}` : ""}
            </span>
          ) : null}
        </div>
      </div>

      <textarea
        ref={textareaRef}
        className="mb-2 w-full resize-y rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 font-mono text-[11px] leading-snug"
        rows={compact ? 4 : 8}
        spellCheck={false}
        value={draftSql}
        onChange={(e) => setDraftSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void onRun();
          }
        }}
        placeholder="SELECT …"
      />

      <div className="mb-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          className="rounded bg-[var(--vigil-accent)] px-2.5 py-1 text-white hover:opacity-90 disabled:opacity-50"
          onClick={() => void onRun()}
        >
          {busy ? "…" : "Run"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={() => void onExplain()}
          title="Estimated explain plan"
        >
          Explain
        </button>
        <button
          type="button"
          disabled={busy || !rows.length}
          className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={onCopyCsv}
        >
          CSV
        </button>
        <button
          type="button"
          disabled={busy || !draftSql.trim()}
          className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={onPinSql}
          title="Add SQL to chat context"
        >
          → Chat
        </button>
        <button
          type="button"
          disabled={busy || !rows.length}
          className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={onPinResults}
          title="Pin result preview to chat"
        >
          Results→Chat
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={() => setShowHistory((v) => !v)}
        >
          History
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={() => {
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                if (readOnly) {
                  const ok = window.confirm(
                    "تفعيل Write mode؟ INSERT/UPDATE/DELETE/DDL هتشتغل على الجلسة دي.",
                  );
                  if (!ok) return;
                  const session = await setSqlModeUi({
                    mode: "write",
                    confirm: true,
                  });
                  setSession({
                    connected: true,
                    engine: session.engine,
                    profileId: session.profileId,
                    label: session.label,
                    database: session.database,
                    readOnly: false,
                  });
                  setNote("Write mode ON");
                } else {
                  const session = await setSqlModeUi({ mode: "read" });
                  setSession({
                    connected: true,
                    engine: session.engine,
                    profileId: session.profileId,
                    label: session.label,
                    database: session.database,
                    readOnly: true,
                  });
                  setNote("Read-only restored");
                }
              } catch (err) {
                setError(String(err));
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {readOnly ? "Write…" : "Read-only"}
        </button>
        <span className="self-center text-[10px] text-[var(--vigil-muted)]">
          ⌘/Ctrl+Enter
        </span>
      </div>

      {showHistory ? (
        <ul className="mb-2 max-h-28 overflow-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-1">
          {history.length === 0 ? (
            <li className="px-1 py-1 text-[10px] text-[var(--vigil-muted)]">
              مفيش تاريخ بعد — شغّل SELECT أول مرة.
            </li>
          ) : (
            history.slice(0, compact ? 12 : 24).map((h) => (
              <li
                key={h.id}
                className="flex items-start gap-1 border-b border-[var(--vigil-border-soft)] px-1 py-0.5 last:border-0"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-start font-mono text-[10px] hover:underline"
                  title={h.sql}
                  onClick={() => {
                    loadDraftSql(h.sql);
                    setShowHistory(false);
                  }}
                >
                  {h.starred ? "★ " : ""}
                  {h.ok === false ? "✗ " : ""}
                  {h.sql.replace(/\s+/g, " ").slice(0, 80)}
                </button>
                <button
                  type="button"
                  className="shrink-0 px-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
                  title="Star"
                  onClick={() => setHistory(toggleStarSqlHistory(h.id))}
                >
                  ★
                </button>
                <button
                  type="button"
                  className="shrink-0 px-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-danger)]"
                  title="Remove"
                  onClick={() => setHistory(removeSqlHistory(h.id))}
                >
                  ×
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {note ? (
        <p className="mb-1 text-[10px] text-[var(--vigil-muted)]">
          {note}
          {ranAt ? ` · ${new Date(ranAt).toLocaleTimeString()}` : ""}
        </p>
      ) : null}
      {error ? (
        <p className="mb-2 text-[10px] text-[var(--vigil-danger)]">{error}</p>
      ) : null}

      {planText ? (
        <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-2 font-mono text-[10px]">
          {planText}
        </pre>
      ) : null}

      <div
        className={
          compact
            ? "max-h-40 overflow-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)]"
            : "max-h-72 overflow-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)]"
        }
      >
        {columns.length === 0 ? (
          <p className="p-2 text-[10px] text-[var(--vigil-muted)]">
            {rowCount === 0 && ranAt
              ? "لا نتائج."
              : "النتائج تظهر هنا بعد Run. من الكتالوج: SQL أو DDL."}
          </p>
        ) : (
          <table className="min-w-full border-collapse font-mono text-[10px]">
            <thead className="sticky top-0 bg-[var(--vigil-panel)]">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="whitespace-nowrap border-b border-[var(--vigil-border)] px-2 py-1 text-start font-semibold"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-[var(--vigil-border-soft)] last:border-0 hover:bg-[var(--vigil-hover)]"
                >
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="max-w-[14rem] truncate whitespace-nowrap px-2 py-0.5"
                      title={cellDisplay(row[col])}
                    >
                      {cellDisplay(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
