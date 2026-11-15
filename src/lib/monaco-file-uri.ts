/** Convert between workspace paths and Monaco file:// URIs. */

export function pathToFileUri(path: string): string {
  const norm = path.replace(/\\/g, "/");
  if (norm.startsWith("file:")) return norm;
  if (/^[A-Za-z]:\//.test(norm)) {
    return `file:///${norm}`;
  }
  return `file://${norm.startsWith("/") ? "" : "/"}${norm}`;
}

export function fileUriToPath(uri: string): string | null {
  const raw = String(uri || "").trim();
  if (!raw) return null;
  let path = raw;
  try {
    if (raw.includes("://")) {
      const u = new URL(raw);
      path = decodeURIComponent(u.pathname || "");
    }
  } catch {
    path = raw.replace(/^file:\/\//, "");
  }
  if (/^\/[A-Za-z]:\//.test(path)) return path.slice(1);
  return path || null;
}

export function monacoResourceToPath(resource: {
  fsPath?: string;
  path?: string;
  toString?: () => string;
}): string | null {
  const fs = String(resource.fsPath || "").trim();
  if (fs) return fs.replace(/\\/g, "/");
  const p = String(resource.path || "").trim();
  if (p && !p.startsWith("inmemory:")) {
    return fileUriToPath(p.startsWith("file:") ? p : `file://${p}`) || p;
  }
  try {
    return fileUriToPath(resource.toString?.() || "");
  } catch {
    return null;
  }
}
