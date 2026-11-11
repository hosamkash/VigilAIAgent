/** Parse `@query` at the caret and rank workspace paths for mention autocomplete. */

import type { DirEntryInfo } from "./workspace-fs";
import { relativeWorkspaceLabel } from "./explorer-dnd";

export type AtMentionCandidate = {
  path: string;
  name: string;
  isDir: boolean;
  label: string;
  score: number;
  /** When set, this candidate is a code symbol rather than a file/folder. */
  symbolLine?: number;
  symbolKind?: string;
  /** Virtual context mention (@problems / @codebase / @open). */
  virtualId?: "problems" | "codebase" | "open";
};

export type AtMentionQuery = {
  /** Start index of `@` in the draft. */
  start: number;
  /** End index of the query (caret). */
  end: number;
  query: string;
};

/** Find an active `@mention` query ending at `caret`. */
export function findAtMentionQuery(
  text: string,
  caret: number,
): AtMentionQuery | null {
  const end = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, end);
  const match = /(?:^|[\s\n])@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const raw = match[1] ?? "";
  const atIndex = before.length - raw.length - 1;
  if (text[atIndex] !== "@") return null;
  return { start: atIndex, end, query: raw };
}

function scorePath(label: string, name: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const labelL = label.toLowerCase();
  const nameL = name.toLowerCase();
  if (nameL === q) return 100;
  if (nameL.startsWith(q)) return 80;
  if (labelL.endsWith(`/${q}`) || labelL === q) return 70;
  if (nameL.includes(q)) return 50;
  if (labelL.includes(q)) return 30;
  // crude path segment fuzzy: all chars of query appear in order
  let i = 0;
  for (const ch of labelL) {
    if (ch === q[i]) i += 1;
    if (i >= q.length) return 15;
  }
  return 0;
}

/** Rank loaded explorer entries for an `@` query. */
export function rankAtMentionCandidates(
  entries: DirEntryInfo[],
  query: string,
  workspaceRoot: string | null,
  limit = 12,
): AtMentionCandidate[] {
  const scored: AtMentionCandidate[] = [];
  for (const entry of entries) {
    const label = relativeWorkspaceLabel(entry.path, workspaceRoot);
    const score = scorePath(label, entry.name, query);
    if (score <= 0 && query.trim()) continue;
    scored.push({
      path: entry.path,
      name: entry.name,
      isDir: entry.isDir,
      label,
      score: score + (entry.isDir ? 0 : 2),
    });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Flatten currently loaded explorer tree nodes into a candidate list. */
export function flattenExplorerEntries(
  children: Record<string, DirEntryInfo[]>,
): DirEntryInfo[] {
  const byPath = new Map<string, DirEntryInfo>();
  for (const list of Object.values(children)) {
    for (const entry of list) {
      byPath.set(entry.path, entry);
    }
  }
  return [...byPath.values()];
}

/** Replace the `@query` span with nothing (chip carries the reference). */
export function applyAtMentionReplacement(
  text: string,
  mention: AtMentionQuery,
): string {
  return `${text.slice(0, mention.start)}${text.slice(mention.end)}`;
}
