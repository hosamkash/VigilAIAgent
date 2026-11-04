export interface SearchHit {
  path: string;
  line: number;
  preview: string;
  raw: string;
}

export interface SearchHistoryEntry {
  id: string;
  query: string;
  include: string;
  exclude: string;
  at: number;
}

const HISTORY_KEY = "vigil.searchHistory";

/** Parse `rg -n` lines: path:line:preview */
export function parseRgLine(line: string): SearchHit | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("[exit")) return null;
  // Windows drives: C:\foo:12:text — prefer last match of :digits:
  const m = trimmed.match(/^(.*):(\d+):(.*)$/);
  if (!m) return null;
  return {
    path: m[1]!,
    line: Number(m[2]),
    preview: m[3] ?? "",
    raw: trimmed,
  };
}

export function parseRgOutput(out: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const line of out.split("\n")) {
    const hit = parseRgLine(line);
    if (hit) hits.push(hit);
  }
  return hits;
}

export function buildRgCommand(
  query: string,
  include = "",
  exclude = "",
): string {
  const parts = ["rg", "-n", "--color", "never", "--hidden"];
  if (include.trim()) {
    for (const g of include.split(",").map((s) => s.trim()).filter(Boolean)) {
      parts.push("-g", JSON.stringify(g));
    }
  }
  if (exclude.trim()) {
    for (const g of exclude.split(",").map((s) => s.trim()).filter(Boolean)) {
      parts.push("-g", JSON.stringify(`!${g}`));
    }
  }
  parts.push(JSON.stringify(query), ".");
  return `${parts.join(" ")} || true`;
}

export function loadSearchHistory(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SearchHistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function pushSearchHistory(
  entry: Omit<SearchHistoryEntry, "id" | "at">,
): SearchHistoryEntry[] {
  const next: SearchHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    at: Date.now(),
  };
  const prev = loadSearchHistory().filter(
    (h) =>
      !(
        h.query === entry.query &&
        h.include === entry.include &&
        h.exclude === entry.exclude
      ),
  );
  const list = [next, ...prev].slice(0, 30);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}
