/**
 * Compact prior chat turns into a budgeted history block for the agent.
 * Keeps recent messages verbatim; summarizes older ones to survive monorepo sessions.
 */

export type CompactableMessage = {
  role: "user" | "assistant" | string;
  content: string;
};

const DEFAULT_RECENT = 6;
const DEFAULT_MAX_CHARS = 12_000;
const OLD_SNIPPET = 220;

function clip(text: string, max: number): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * Build a history appendix for the agent prompt.
 * Returns empty string when there is nothing useful to attach.
 */
export function buildCompactChatHistory(
  messages: CompactableMessage[],
  options: {
    recentCount?: number;
    maxChars?: number;
    /** Exclude the just-appended user turn (already in the prompt). */
    skipLastUser?: boolean;
  } = {},
): string {
  const recentCount = options.recentCount ?? DEFAULT_RECENT;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  let list = messages.filter(
    (m) =>
      (m.role === "user" || m.role === "assistant") &&
      String(m.content || "").trim(),
  );
  if (options.skipLastUser !== false && list.length > 0) {
    const last = list[list.length - 1]!;
    if (last.role === "user") list = list.slice(0, -1);
  }
  if (list.length === 0) return "";

  const recent = list.slice(-recentCount);
  const older = list.slice(0, Math.max(0, list.length - recent.length));

  const parts: string[] = ["[Conversation memory — compacted for this turn]"];

  if (older.length > 0) {
    parts.push("Earlier (summaries):");
    for (const msg of older) {
      const tag = msg.role === "user" ? "User" : "Assistant";
      parts.push(`- ${tag}: ${clip(msg.content, OLD_SNIPPET)}`);
    }
  }

  parts.push("Recent (verbatim):");
  for (const msg of recent) {
    const tag = msg.role === "user" ? "User" : "Assistant";
    const body = String(msg.content || "").trim();
    const truncated =
      body.length > 2_400 ? `${body.slice(0, 2_400)}\n…(truncated)` : body;
    parts.push(`${tag}:\n${truncated}`);
  }
  parts.push("[/Conversation memory]");

  let out = parts.join("\n\n");
  if (out.length > maxChars) {
    // Drop oldest summary lines first, then trim recent.
    out = out.slice(out.length - maxChars);
    out = `…(older memory trimmed)\n${out}`;
  }
  return out;
}

/** Rough size helper for tests / UI. */
export function estimateHistoryChars(messages: CompactableMessage[]): number {
  return messages.reduce((n, m) => n + String(m.content || "").length, 0);
}
