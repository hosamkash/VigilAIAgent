import type { GitChange, GitChangeStatus, GitStatus } from "./git";

/** Explorer decoration kinds — colors match Cursor / VS Code gitDecoration.*. */
export type ExplorerGitKind =
  | "modified"
  | "untracked"
  | "added"
  | "deleted"
  | "conflict";

export type ExplorerGitDecoration = {
  kind: ExplorerGitKind;
  /** Shown beside the name: M / N / A / D / C */
  letter: string;
};

const PRIORITY: Record<ExplorerGitKind, number> = {
  conflict: 5,
  modified: 4,
  deleted: 3,
  added: 2,
  untracked: 1,
};

export function letterForGitKind(kind: ExplorerGitKind): string {
  switch (kind) {
    case "untracked":
      return "N";
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "conflict":
      return "C";
  }
}

export function kindFromGitStatus(status: GitChangeStatus): ExplorerGitKind {
  switch (status) {
    case "?":
      return "untracked";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "U":
      return "conflict";
    case "M":
    case "R":
    case "C":
    case "!":
    default:
      return "modified";
  }
}

function normAbs(root: string, rel: string): string {
  const base = root.replace(/\/+$/, "");
  const path = rel.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  return `${base}/${path}`;
}

function merge(
  current: ExplorerGitDecoration | undefined,
  next: ExplorerGitDecoration,
): ExplorerGitDecoration {
  if (!current) return next;
  return PRIORITY[next.kind] >= PRIORITY[current.kind] ? next : current;
}

function decorateAncestors(
  map: Record<string, ExplorerGitDecoration>,
  absPath: string,
  root: string,
  deco: ExplorerGitDecoration,
) {
  const base = root.replace(/\/+$/, "");
  let cursor = absPath.replace(/\/+$/, "");
  while (cursor.startsWith(`${base}/`)) {
    const parent = cursor.slice(0, cursor.lastIndexOf("/"));
    if (!parent || parent === base || parent.length < base.length) break;
    map[parent] = merge(map[parent], deco);
    cursor = parent;
  }
}

/** Build absolute-path → decoration for explorer files and parent folders. */
export function buildExplorerGitDecorations(
  root: string,
  status: GitStatus | null | undefined,
): Record<string, ExplorerGitDecoration> {
  const map: Record<string, ExplorerGitDecoration> = {};
  if (!root || !status?.isRepo) return map;

  const apply = (change: GitChange) => {
    const kind = kindFromGitStatus(change.status);
    const deco: ExplorerGitDecoration = {
      kind,
      letter: letterForGitKind(kind),
    };
    const abs = normAbs(root, change.path);
    map[abs] = merge(map[abs], deco);
    decorateAncestors(map, abs, root, deco);
  };

  for (const change of status.conflicted) apply(change);
  for (const change of status.changes) apply(change);
  for (const change of status.staged) apply(change);
  for (const change of status.untracked) apply(change);

  return map;
}
