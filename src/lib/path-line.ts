/** Parse workspace paths that may include a trailing `:line` (chat / find_definition). */

export function looksLikeWorkspacePath(text: string): boolean {
  const t = text.trim().replace(/^`+|`+$/g, "");
  if (!t || t.includes("://") || t.includes(" ")) return false;
  if (!/[./\\]/.test(t)) return false;
  return (
    /\.[A-Za-z0-9]{1,12}$/.test(t) ||
    t.startsWith("src/") ||
    t.startsWith("./")
  );
}

/**
 * `src/foo.ts:42` or `C:/proj/a.ts:12` → path + line.
 * Does not treat a bare Windows drive (`C:`) as a line suffix.
 */
export function parsePathWithLine(
  raw: string,
): { path: string; line?: number } | null {
  let t = raw.trim().replace(/^`+|`+$/g, "");
  if (!t) return null;
  if (t.startsWith("vigil-file://")) {
    t = decodeURIComponent(t.slice("vigil-file://".length));
  } else if (t.startsWith("vigil-file:")) {
    t = decodeURIComponent(t.slice("vigil-file:".length));
  }
  t = t.replace(/\\/g, "/");
  const hash = t.match(/^(.*)#L(\d+)$/i);
  if (hash) {
    t = hash[1]!;
    const line = Number(hash[2]);
    if (looksLikeWorkspacePath(t)) return { path: t, line };
  }
  const m = t.match(/^(.*):(\d+)$/);
  if (m) {
    const pathPart = m[1]!;
    if (/^[A-Za-z]$/.test(pathPart)) {
      return looksLikeWorkspacePath(t) ? { path: t } : null;
    }
    if (looksLikeWorkspacePath(pathPart)) {
      return { path: pathPart, line: Number(m[2]) };
    }
  }
  if (looksLikeWorkspacePath(t)) return { path: t };
  return null;
}
