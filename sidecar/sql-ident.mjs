/**
 * Safe SQL identifier helpers for Support / DB Copilot.
 */

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isSafeDbName(name) {
  const s = String(name || "").trim();
  if (!s || s.length > 128) return false;
  // No quotes, brackets, semicolons, or path tricks.
  if (/[;'"\\`]/.test(s) || /\.\./.test(s)) return false;
  return /^[A-Za-z0-9_$#@.\- ]+$/.test(s);
}

/**
 * @param {string} ident
 * @param {'mssql' | 'postgres'} engine
 */
export function quoteIdent(ident, engine) {
  const s = String(ident || "");
  if (engine === "postgres") return `"${s.replace(/"/g, '""')}"`;
  return `[${s.replace(/]/g, "]]")}]`;
}

/**
 * Build a best-effort CREATE TABLE script from column metadata rows.
 * @param {string} schema
 * @param {string} name
 * @param {Array<{ col: string, typ: string, nullable?: string, len?: number | null }>} columns
 * @param {'mssql' | 'postgres'} engine
 */
export function synthesizeCreateTable(schema, name, columns, engine) {
  const qual = `${quoteIdent(schema, engine)}.${quoteIdent(name, engine)}`;
  const lines = (columns || []).map((c) => {
    const col = quoteIdent(c.col, engine);
    let typ = String(c.typ || "nvarchar");
    if (c.len != null && Number(c.len) > 0 && Number(c.len) < 8000) {
      if (/char|binary/i.test(typ)) typ = `${typ}(${c.len})`;
    }
    if (Number(c.len) === -1 && /nvarchar|varchar|varbinary/i.test(typ)) {
      typ = engine === "mssql" ? `${typ}(max)` : typ;
    }
    const nullability =
      String(c.nullable || "").toUpperCase() === "YES" ? "NULL" : "NOT NULL";
    return `  ${col} ${typ} ${nullability}`;
  });
  return `CREATE TABLE ${qual} (\n${lines.join(",\n")}\n);`;
}
