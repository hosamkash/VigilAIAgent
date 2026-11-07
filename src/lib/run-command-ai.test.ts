import { describe, expect, it } from "vitest";
import { looksLikeShellCommand, parseSuggestion } from "./run-command-ai";

describe("run-command-ai parsing", () => {
  it("accepts real shell commands", () => {
    expect(
      looksLikeShellCommand("lsof -ti:5173 | xargs kill -9 2>/dev/null; npm run dev"),
    ).toBe(true);
    expect(looksLikeShellCommand("npm run tauri:dev")).toBe(true);
  });

  it("rejects Arabic prose as a command", () => {
    expect(
      looksLikeShellCommand("ولد لي أمر بيقفل البورت ويشغل وضع التطوير"),
    ).toBe(false);
  });

  it("reads command and description from JSON", () => {
    const result = parseSuggestion(
      JSON.stringify({
        command: "lsof -ti:5173 | xargs kill -9 2>/dev/null; npm run dev",
        description: "قفل البورت وتشغيل التطوير",
      }),
    );
    expect(result.command).toContain("npm run dev");
    expect(result.description).toContain("التطوير");
  });

  it("does not dump prose into the command field", () => {
    const result = parseSuggestion(
      "طبعا تقدر تستخدم الأمر ده عشان تقفل البورت وتشغل التطوير",
    );
    expect(result.command).toBe("");
  });
});
