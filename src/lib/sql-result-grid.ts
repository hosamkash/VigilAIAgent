/**
 * Helpers for Support SQL workbench result grids (local-only).
 */

export type SqlResultRow = Record<string, unknown>;

/** Column headers from the first row (stable Object.keys order). */
export function columnsFromRows(rows: SqlResultRow[]): string[] {
  if (!rows.length) return [];
  return Object.keys(rows[0] || {});
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Convert preview rows to CSV (includes header). */
export function rowsToCsv(rows: SqlResultRow[], columns?: string[]): string {
  const cols = columns?.length ? columns : columnsFromRows(rows);
  if (!cols.length) return "";
  const header = cols.map(csvEscape).join(",");
  const lines = rows.map((row) =>
    cols.map((c) => csvEscape(row[c])).join(","),
  );
  return [header, ...lines].join("\n");
}

/** Quote schema.table for SELECT prefill. */
export function quoteQualifiedTable(
  schema: string,
  name: string,
  engine: "mssql" | "postgres" | null | undefined,
): string {
  const s = String(schema || "dbo").trim() || "dbo";
  const n = String(name || "").trim();
  if (!n) return "";
  if (engine === "postgres") {
    const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
    return `${q(s)}.${q(n)}`;
  }
  const q = (id: string) => `[${id.replace(/]/g, "]]")}]`;
  return `${q(s)}.${q(n)}`;
}

/** Prefill SELECT for catalog “Open in SQL”. Row cap applied server-side. */
export function selectStarSql(
  schema: string,
  name: string,
  engine: "mssql" | "postgres" | null | undefined,
): string {
  const qual = quoteQualifiedTable(schema, name, engine);
  if (!qual) return "";
  return `SELECT * FROM ${qual}`;
}

export function cellDisplay(value: unknown): string {
  if (value == null) return "NULL";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
