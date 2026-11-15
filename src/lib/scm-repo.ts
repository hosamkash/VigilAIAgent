/**
 * Multi-repo SCM identity: stable id + color from absolute Git root path.
 */

export const SCM_REPO_PALETTE = [
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet (accent, not default-purple-only)
  "#14b8a6", // teal
  "#f97316", // orange
  "#ec4899", // pink
  "#84cc16", // lime
  "#6366f1", // indigo
] as const;

export function normalizeRepoPath(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    || "";
}

/** Stable short id from absolute path (djb2 hex). */
export function scmRepoIdFromPath(rootPath: string): string {
  const p = normalizeRepoPath(rootPath).toLowerCase();
  let h = 5381;
  for (let i = 0; i < p.length; i++) {
    h = ((h << 5) + h + p.charCodeAt(i)) | 0;
  }
  return `r${(h >>> 0).toString(16)}`;
}

export function scmRepoColorFromPath(rootPath: string): string {
  const p = normalizeRepoPath(rootPath).toLowerCase();
  let h = 0;
  for (let i = 0; i < p.length; i++) {
    h = (h * 33 + p.charCodeAt(i)) >>> 0;
  }
  return SCM_REPO_PALETTE[h % SCM_REPO_PALETTE.length]!;
}

export function scmRepoDisplayName(rootPath: string): string {
  const p = normalizeRepoPath(rootPath);
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] || p || "repo";
}

export type ScmRepoRecord = {
  id: string;
  rootPath: string;
  displayName: string;
  color: string;
  isPrimary?: boolean;
  changeCount?: number;
  branch?: string;
  commitDraft?: string;
};

export function makeScmRepo(
  rootPath: string,
  opts?: Partial<Pick<ScmRepoRecord, "isPrimary" | "displayName" | "commitDraft">>,
): ScmRepoRecord {
  const path = normalizeRepoPath(rootPath);
  return {
    id: scmRepoIdFromPath(path),
    rootPath: path,
    displayName: opts?.displayName || scmRepoDisplayName(path),
    color: scmRepoColorFromPath(path),
    isPrimary: opts?.isPrimary,
    commitDraft: opts?.commitDraft,
  };
}
