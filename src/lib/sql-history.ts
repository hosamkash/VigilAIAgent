/**
 * Local Support SQL query history + starred snippets (browser/localStorage).
 */

export type SqlHistoryEntry = {
  id: string;
  sql: string;
  starred?: boolean;
  engine?: string | null;
  database?: string | null;
  profileId?: string | null;
  rowCount?: number;
  ok?: boolean;
  createdAt: number;
};

const KEY = "vigil.sql.history.v1";
const MAX = 80;

/** In-memory fallback when localStorage is unavailable (tests / SSR). */
let memoryEntries: SqlHistoryEntry[] = [];

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined" && !!localStorage;
  } catch {
    return false;
  }
}

export function loadSqlHistory(): SqlHistoryEntry[] {
  if (!storageAvailable()) return [...memoryEntries];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { entries?: SqlHistoryEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function saveAll(entries: SqlHistoryEntry[]): void {
  const next = entries.slice(0, MAX);
  memoryEntries = next;
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ entries: next }));
  } catch {
    /* quota */
  }
}

/** Test helper — clear memory + storage. */
export function clearSqlHistoryForTests(): void {
  memoryEntries = [];
  if (storageAvailable()) {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}

export function pushSqlHistory(
  entry: Omit<SqlHistoryEntry, "id" | "createdAt"> & { id?: string },
): SqlHistoryEntry[] {
  const sql = String(entry.sql || "").trim();
  if (!sql) return loadSqlHistory();
  const list = loadSqlHistory().filter(
    (e) => e.sql.trim().toLowerCase() !== sql.toLowerCase() || e.starred,
  );
  const next: SqlHistoryEntry = {
    id: entry.id || crypto.randomUUID(),
    sql,
    starred: false,
    engine: entry.engine ?? null,
    database: entry.database ?? null,
    profileId: entry.profileId ?? null,
    rowCount: entry.rowCount,
    ok: entry.ok,
    createdAt: Date.now(),
  };
  const starred = list.filter((e) => e.starred);
  const rest = list.filter((e) => !e.starred);
  const merged = [next, ...starred.filter((s) => s.sql !== sql), ...rest].slice(
    0,
    MAX,
  );
  saveAll(merged);
  return merged;
}

export function toggleStarSqlHistory(id: string): SqlHistoryEntry[] {
  const list = loadSqlHistory().map((e) =>
    e.id === id ? { ...e, starred: !e.starred } : e,
  );
  list.sort((a, b) => {
    const as = a.starred ? 1 : 0;
    const bs = b.starred ? 1 : 0;
    if (bs !== as) return bs - as;
    return b.createdAt - a.createdAt;
  });
  saveAll(list);
  return list;
}

export function removeSqlHistory(id: string): SqlHistoryEntry[] {
  const list = loadSqlHistory().filter((e) => e.id !== id);
  saveAll(list);
  return list;
}
