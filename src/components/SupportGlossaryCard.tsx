import { useCallback, useEffect, useState } from "react";
import {
  loadSqlGlossary,
  saveSqlGlossary,
  type GlossaryTerm,
} from "../lib/sql-glossary";

export function SupportGlossaryCard({ compact = false }: { compact?: boolean }) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [ar, setAr] = useState("");
  const [en, setEn] = useState("");
  const [table, setTable] = useState("");
  const [column, setColumn] = useState("");
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setTerms(await loadSqlGlossary());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shown = terms.filter((t) => {
    const blob = `${t.ar || ""} ${t.en || ""} ${t.table || ""} ${t.column || ""}`.toLowerCase();
    return !q.trim() || blob.includes(q.trim().toLowerCase());
  });

  async function onAdd() {
    if (!ar.trim() && !en.trim()) return;
    const next = [
      ...terms,
      {
        ar: ar.trim() || undefined,
        en: en.trim() || undefined,
        table: table.trim() || undefined,
        column: column.trim() || undefined,
      },
    ];
    await saveSqlGlossary(next);
    setAr("");
    setEn("");
    setTable("");
    setColumn("");
    setNote("Saved in .vigil/glossary.json");
    await refresh();
  }

  return (
    <div className="rounded border border-[var(--vigil-border)] p-2 text-[11px]">
      <div className="mb-1 font-semibold">Glossary · قاموس</div>
      {!compact ? (
        <p className="mb-1 text-[10px] text-[var(--vigil-muted)]">
          مصطلح عربي → جدول.عمود
        </p>
      ) : null}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="بحث…"
        className="mb-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-1.5 py-1"
      />
      <div className="mb-1 grid grid-cols-2 gap-1">
        <input
          value={ar}
          onChange={(e) => setAr(e.target.value)}
          placeholder="عربي"
          className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-1.5 py-1"
        />
        <input
          value={en}
          onChange={(e) => setEn(e.target.value)}
          placeholder="English"
          className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-1.5 py-1"
        />
        <input
          value={table}
          onChange={(e) => setTable(e.target.value)}
          placeholder="table"
          className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-1.5 py-1"
        />
        <input
          value={column}
          onChange={(e) => setColumn(e.target.value)}
          placeholder="column"
          className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-1.5 py-1"
        />
      </div>
      <button
        type="button"
        className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)]"
        onClick={() => void onAdd()}
      >
        Add
      </button>
      {note ? <div className="mt-1 text-[10px] text-emerald-600">{note}</div> : null}
      <ul className="mt-1 max-h-28 space-y-0.5 overflow-auto">
        {shown.slice(0, 20).map((t, i) => (
          <li key={`${t.ar}-${t.en}-${i}`} className="text-[10px] text-[var(--vigil-muted)]">
            {[t.ar, t.en].filter(Boolean).join(" / ")}
            {t.table ? ` → ${t.table}${t.column ? `.${t.column}` : ""}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
