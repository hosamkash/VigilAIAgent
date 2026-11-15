/**
 * Lightweight .gitignore / .vigilignore for the deep code index.
 * Not a full gitignore engine — enough to skip vendor dumps and generated trees.
 */

/**
 * @param {string} text
 * @returns {{ dirNames: Set<string>, patterns: string[] }}
 */
export function parseIgnoreText(text) {
  const dirNames = new Set();
  /** @type {string[]} */
  const patterns = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    let t = raw.trim();
    if (!t || t.startsWith("#") || t.startsWith("!")) continue;
    if (t.startsWith("/")) t = t.slice(1);
    if (t.endsWith("/")) {
      const name = t.slice(0, -1).split("/").filter(Boolean).pop();
      if (name) dirNames.add(name);
      continue;
    }
    if (!t.includes("/") && !t.includes("*") && !t.includes("?")) {
      dirNames.add(t);
      continue;
    }
    patterns.push(t);
  }
  return { dirNames, patterns };
}

/**
 * @param {string} glob
 */
export function globToRegExp(glob) {
  const body = String(glob || "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`(?:^|/)${body}$`);
}

/**
 * @param {string} rel
 * @param {{ dirNames: Set<string>, patterns: string[] }} ignore
 */
export function shouldSkipRelative(rel, ignore) {
  const norm = String(rel || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!norm) return false;
  const parts = norm.split("/");
  for (const part of parts) {
    if (ignore.dirNames.has(part)) return true;
  }
  const base = parts[parts.length - 1] || "";
  for (const g of ignore.patterns) {
    const re = globToRegExp(g);
    if (re.test(norm) || re.test(base)) return true;
  }
  return false;
}

/**
 * @param {string} root
 */
export async function loadWorkspaceIgnore(root) {
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const dirNames = new Set();
  /** @type {string[]} */
  const patterns = [];
  for (const name of [".gitignore", ".vigilignore"]) {
    try {
      const text = await fs.readFile(path.join(root, name), "utf8");
      const parsed = parseIgnoreText(text);
      for (const d of parsed.dirNames) dirNames.add(d);
      patterns.push(...parsed.patterns);
    } catch {
      /* missing is fine */
    }
  }
  return { dirNames, patterns };
}
