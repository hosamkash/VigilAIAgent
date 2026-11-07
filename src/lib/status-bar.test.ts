import { describe, expect, it } from "vitest";
import { agentStats, isWarningProblem, languageLabel, tabStats } from "./status-bar";

describe("status bar labels", () => {
  it("names languages the way the editor status bar does", () => {
    expect(languageLabel("src/App.tsx", "typescript")).toBe("TypeScript JSX");
    expect(languageLabel("notes.md", "markdown")).toBe("Markdown");
    expect(languageLabel("untitled:1", "plaintext")).toBe("Plain Text");
  });

  it("formats tab and agent stats", () => {
    expect(tabStats(0, 0)).toBe("Tab Stats: 0/0 (0%)");
    expect(tabStats(4, 3)).toBe("Tab Stats: 3/4 (75%)");
    expect(agentStats(500, 82)).toBe("Agent Stats: 582 tokens");
  });

  it("splits warnings from errors", () => {
    expect(isWarningProblem("warning: unused")).toBe(true);
    expect(isWarningProblem("error: failed")).toBe(false);
  });
});
