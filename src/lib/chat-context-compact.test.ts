import { describe, expect, it } from "vitest";
import {
  buildCompactChatHistory,
  estimateHistoryChars,
} from "./chat-context-compact";

describe("chat-context-compact", () => {
  it("returns empty when no prior turns", () => {
    expect(buildCompactChatHistory([])).toBe("");
    expect(
      buildCompactChatHistory([{ role: "user", content: "only this" }]),
    ).toBe("");
  });

  it("keeps recent verbatim and summarizes older", () => {
    const messages = [
      { role: "user", content: "old question about auth" },
      { role: "assistant", content: "old answer about verifyToken" },
      { role: "user", content: "recent q1" },
      { role: "assistant", content: "recent a1" },
      { role: "user", content: "latest user message" },
    ];
    const out = buildCompactChatHistory(messages, { recentCount: 2 });
    expect(out).toContain("Conversation memory");
    expect(out).toContain("Earlier (summaries)");
    expect(out).toContain("old question");
    expect(out).toContain("Recent (verbatim)");
    expect(out).toContain("recent q1");
    // Latest user turn skipped (already in prompt)
    expect(out).not.toContain("latest user message");
  });

  it("estimates history size", () => {
    expect(
      estimateHistoryChars([
        { role: "user", content: "abcd" },
        { role: "assistant", content: "ef" },
      ]),
    ).toBe(6);
  });
});
