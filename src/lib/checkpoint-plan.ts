/** Local restore points for one agent command. File bytes never go in VigilDB. */

export type CheckpointFile = {
  path: string;
  existed: boolean;
  content: string;
};

export type CheckpointSnapshot = {
  id: string;
  workspace: string;
  createdAt: number;
  files: CheckpointFile[];
};

/** Match the sidecar key so both sides open the same folder. */
export function normalizeWorkspaceRoot(input: string): string {
  const slash = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  const drive = /^[A-Za-z]:/.exec(slash);
  const body = drive ? slash.slice(2) : slash;
  const parts = body.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const prefix = drive ? `${drive[0].toUpperCase()}/` : "/";
  const joined = `${prefix}${stack.join("/")}`.replace(/\/+$/, "");
  return joined || (drive ? `${drive[0].toUpperCase()}/` : "/");
}

/**
 * Files to put back so the workspace matches the moment before `targetId`.
 * The first snapshot of each path from that command onward wins.
 */
export function planRestore(
  snapshots: CheckpointSnapshot[],
  targetId: string,
): CheckpointFile[] {
  const ordered = [...snapshots].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const start = ordered.findIndex((snap) => snap.id === targetId);
  if (start < 0) return [];
  const seen = new Map<string, CheckpointFile>();
  for (const snap of ordered.slice(start)) {
    for (const file of snap.files) {
      if (!file.path || seen.has(file.path)) continue;
      seen.set(file.path, file);
    }
  }
  return [...seen.values()];
}
