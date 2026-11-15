/** Same-folder OS opens reuse this window; a different folder needs a new process. */

export function normalizeWorkspaceKey(path: string): string {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function shouldReuseVigilWindow(
  currentWorkspace: string | null | undefined,
  incomingFolder: string,
): boolean {
  const incoming = normalizeWorkspaceKey(incomingFolder);
  if (!incoming) return true;
  const current = normalizeWorkspaceKey(currentWorkspace || "");
  if (!current) return true;
  return current === incoming;
}
