/**
 * Per-project rules file for Vigil AI Agent.
 * Lives in the workspace only — never synced to Firestore.
 */

import { createDir, readTextFile, writeTextFile } from "./workspace-fs";

export const PROJECT_RULES_DIR = ".vigil";
export const PROJECT_RULES_FILE = "rules.md";
export const PROJECT_RULES_REL = `${PROJECT_RULES_DIR}/${PROJECT_RULES_FILE}`;

export const PROJECT_RULES_TEMPLATE = `# Vigil project rules

This file is the local reference for Vigil AI Agent in this project.
Write instructions the agent should follow here (architecture, style, do / don't).
You can leave it empty; the file stays so you can fill it later.

These rules stay on this machine with the project. They are not uploaded to Firestore.

## Browser
- Open previews with the \`browser_open\` tool (Vigil Browser inside the IDE).
- Do not tell the user to use Command Palette or "Simple Browser: Show".
- Do not open the OS/system browser unless the user explicitly asks for that.
`;

export function projectRulesPath(workspaceRoot: string): string {
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${root}/${PROJECT_RULES_REL}`;
}

export async function ensureProjectRules(
  workspaceRoot: string,
): Promise<{ path: string; created: boolean }> {
  const path = projectRulesPath(workspaceRoot);
  try {
    await readTextFile(path);
    return { path, created: false };
  } catch {
    const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    try {
      await createDir(`${root}/${PROJECT_RULES_DIR}`);
    } catch {
      /* writeTextFile also creates parents when possible */
    }
    await writeTextFile(path, PROJECT_RULES_TEMPLATE);
    return { path, created: true };
  }
}

export async function readProjectRules(workspaceRoot: string): Promise<string> {
  try {
    return (await readTextFile(projectRulesPath(workspaceRoot))).trim();
  } catch {
    return "";
  }
}

/** Drop leftover VS Code / Cursor tips that block Vigil Browser tool use. */
function sanitizeBrowserRules(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const lower = line.toLowerCase();
      if (lower.includes("simple browser: show")) return false;
      if (lower.includes("command palette") && lower.includes("browser")) return false;
      if (
        /cmd\s*\+\s*shift\s*\+\s*p|ctrl\s*\+\s*shift\s*\+\s*p/i.test(line) &&
        /browser|simple browser/i.test(line)
      ) {
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();
}

/** Skip the stock template so an untouched file does not pad the system prompt. */
export function formatProjectRulesForAgent(raw: string): string {
  const original = raw.trim();
  if (!original) return "";
  // Exact stock file (before sanitize) — nothing custom to inject.
  if (original === PROJECT_RULES_TEMPLATE.trim()) return "";
  const text = sanitizeBrowserRules(original);
  if (!text) return "";
  return (
    `Project rules (from ${PROJECT_RULES_REL} — follow these for this workspace):\n` +
    text +
    "\n\n(Override: open previews with the browser_open tool / Vigil Browser — never Command Palette.)"
  );
}
