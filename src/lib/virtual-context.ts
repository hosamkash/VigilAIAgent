/** Build prompt blocks for @problems / @codebase / @open virtual mentions. */

import type { EditorProblem } from "./editor-diagnostics";
import type { IndexedFile } from "./workspace-index";
import { readTextFile } from "./workspace-fs";

const EXCERPT = 2_500;

export function formatProblemsContext(problems: EditorProblem[]): string {
  if (problems.length === 0) {
    return "[Problems]\n(no open TS/JS diagnostics)\n[/Problems]";
  }
  const lines = problems.slice(0, 40).map((p) => {
    const where = p.path
      ? `${p.path}:${p.line}:${p.column}`
      : "(unknown)";
    return `- ${p.severity}: ${p.message} (${where})`;
  });
  const more =
    problems.length > 40 ? `\n…(+${problems.length - 40} more)` : "";
  return `[Problems]\n${lines.join("\n")}${more}\n[/Problems]`;
}

export function formatCodebaseContext(
  files: IndexedFile[],
  symbolCount: number,
  semantic?: {
    deep?: boolean;
    chunkCount?: number;
    vectorCount?: number;
    edgeCount?: number;
    fileCount?: number;
  } | null,
): string {
  const sample = files.slice(0, 80).map((f) => `- ${f.label}`).join("\n");
  const more =
    files.length > 80 ? `\n…(+${files.length - 80} more files)` : "";
  const deepLine =
    semantic && (semantic.chunkCount || semantic.vectorCount)
      ? `Deep local index: ${semantic.deep ? "ready" : "partial"} · ` +
        `${semantic.fileCount ?? "?"} files · ${semantic.chunkCount ?? 0} chunks · ` +
        `${semantic.vectorCount ?? 0} vectors · ${semantic.edgeCount ?? 0} import edges\n`
      : "";
  return (
    `[Codebase index]\n` +
    `files indexed: ${files.length}; symbols indexed: ${symbolCount}\n` +
    deepLine +
    `Sample paths:\n${sample || "(empty)"}${more}\n` +
    `Prefer search_codebase / find_definition / find_references / parallel_investigate for deep lookup.\n` +
    `[/Codebase index]`
  );
}

export async function formatOpenTabsContext(
  tabs: Array<{ path: string; content: string; mode?: string }>,
): Promise<string> {
  const fileTabs = tabs.filter((t) => t.mode === "file" || !t.mode);
  if (fileTabs.length === 0) {
    return "[Open editors]\n(none)\n[/Open editors]";
  }
  const parts: string[] = ["[Open editors]"];
  for (const tab of fileTabs.slice(0, 8)) {
    let body = tab.content || "";
    if (!body) {
      try {
        body = await readTextFile(tab.path);
      } catch {
        body = "";
      }
    }
    const clip =
      body.length > EXCERPT ? `${body.slice(0, EXCERPT)}\n…(truncated)` : body;
    parts.push(`path: ${tab.path}\n\`\`\`\n${clip || "(empty)"}\n\`\`\``);
  }
  if (fileTabs.length > 8) {
    parts.push(`…(+${fileTabs.length - 8} more open tabs)`);
  }
  parts.push("[/Open editors]");
  return parts.join("\n\n");
}

export type VirtualMentionId = "problems" | "codebase" | "open";

export function matchVirtualMention(query: string): VirtualMentionId | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  if ("problems".startsWith(q) || q === "diags" || q === "diagnostics") {
    return "problems";
  }
  if ("codebase".startsWith(q) || q === "repo" || q === "project") {
    return "codebase";
  }
  if (
    "open".startsWith(q) ||
    "tabs".startsWith(q) ||
    "editors".startsWith(q) ||
    q === "open-tabs"
  ) {
    return "open";
  }
  return null;
}
