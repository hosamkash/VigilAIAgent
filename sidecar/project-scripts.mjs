/**
 * Detect preferred test/lint commands from package.json / common stacks.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * @param {string} cwd
 * @returns {Promise<{ test: string | null, lint: string | null, raw: Record<string, string> }>}
 */
export async function detectProjectScripts(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  try {
    const raw = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    const scripts =
      raw && typeof raw.scripts === "object" && raw.scripts
        ? /** @type {Record<string, string>} */ (raw.scripts)
        : {};
    const test =
      pickScript(scripts, ["test", "test:unit", "test:ci", "vitest"]) ||
      (scripts.test ? "npm test" : null);
    const lint =
      pickScript(scripts, ["lint", "lint:check", "eslint"]) ||
      (scripts.lint ? "npm run lint" : null);
    return { test, lint, raw: scripts };
  } catch {
    return { test: null, lint: null, raw: {} };
  }
}

/**
 * @param {Record<string, string>} scripts
 * @param {string[]} names
 */
function pickScript(scripts, names) {
  for (const name of names) {
    if (scripts[name]) {
      if (name === "test") return "npm test";
      return `npm run ${name}`;
    }
  }
  return null;
}

/** Compact tip string for the agent system prompt / tool result. */
export async function formatProjectScriptTips(cwd) {
  const found = await detectProjectScripts(cwd);
  const lines = [];
  if (found.test) lines.push(`Preferred test: \`${found.test}\``);
  if (found.lint) lines.push(`Preferred lint: \`${found.lint}\``);
  if (lines.length === 0) {
    return "No npm test/lint scripts detected in package.json.";
  }
  return (
    lines.join("\n") +
    "\nAfter meaningful code edits, run the preferred test (or lint) via run_commands and fix failures before finishing."
  );
}
