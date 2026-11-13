/**
 * Read-only SQL gate for Support / DB Copilot (Phase 1).
 */

const WRITE_RE =
  /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec|execute|sp_executesql|call|copy\s+\w+\s+from|into\s+outfile|load\s+data)\b/i;

const MULTI_STATEMENT_RE = /;(?=(?:[^']*'[^']*')*[^']*$)/;

/**
 * @param {string} sql
 * @returns {{ ok: true, kind: 'select' | 'other_read' } | { ok: false, error: string }}
 */
export function classifySql(sql) {
  const raw = String(sql || "").trim();
  if (!raw) return { ok: false, error: "SQL فارغ." };

  // Strip block/line comments for classification only.
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();

  if (!stripped) return { ok: false, error: "SQL فارغ بعد إزالة التعليقات." };

  if (MULTI_STATEMENT_RE.test(stripped.replace(/;+\s*$/, ""))) {
    return {
      ok: false,
      error: "جملة واحدة فقط في كل مرة (بدون عدة أوامر مفصولة بـ ;).",
    };
  }

  if (WRITE_RE.test(stripped)) {
    return {
      ok: false,
      error:
        "وضع القراءة فقط: ممنوع INSERT/UPDATE/DELETE/DDL/EXEC. فعّل Write mode لاحقًا للتغييرات.",
    };
  }

  if (/^\s*(select|with|show|describe|desc|explain|pragma)\b/i.test(stripped)) {
    return { ok: true, kind: "select" };
  }

  // Allow simple INFORMATION_SCHEMA / catalog reads that start with DECLARE? No.
  return {
    ok: false,
    error: "يُسمح فقط بـ SELECT / WITH / EXPLAIN / SHOW / DESCRIBE في الوضع الافتراضي.",
  };
}

/**
 * Wrap SELECT with a row cap when possible (best-effort).
 * @param {string} sql
 * @param {'mssql' | 'postgres'} engine
 * @param {number} maxRows
 */
export function applyRowLimit(sql, engine, maxRows = 100) {
  const n = Math.min(Math.max(Number(maxRows) || 100, 1), 2000);
  const trimmed = String(sql || "").trim().replace(/;+\s*$/, "");
  const lower = trimmed.toLowerCase();

  if (engine === "mssql") {
    if (/\btop\s+\(/i.test(trimmed) || /\btop\s+\d+/i.test(trimmed)) {
      return trimmed;
    }
    if (/^\s*select\b/i.test(trimmed) && !/^\s*select\s+distinct\b/i.test(trimmed)) {
      return trimmed.replace(/^\s*select\b/i, `SELECT TOP (${n})`);
    }
    if (/^\s*select\s+distinct\b/i.test(trimmed)) {
      return trimmed.replace(
        /^\s*select\s+distinct\b/i,
        `SELECT DISTINCT TOP (${n})`,
      );
    }
    return trimmed;
  }

  // postgres
  if (/\blimit\s+\d+/i.test(lower)) return trimmed;
  if (/^\s*(select|with)\b/i.test(trimmed)) {
    return `${trimmed}\nLIMIT ${n}`;
  }
  return trimmed;
}

export function isReadOnlyMode(mode) {
  return String(mode || "read").toLowerCase() !== "write";
}
