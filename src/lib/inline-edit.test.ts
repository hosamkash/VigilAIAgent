import { describe, expect, it } from "vitest";
import {
  buildInlineEditPrompt,
  extractEditedCode,
} from "./inline-edit";

describe("inline-edit", () => {
  it("strips markdown fences from model output", () => {
    expect(extractEditedCode("```ts\nconst x = 1;\n```", "old")).toBe(
      "const x = 1;",
    );
  });

  it("preserves trailing newline from original", () => {
    expect(extractEditedCode("const x = 2", "old\n")).toBe("const x = 2\n");
  });

  it("builds a focused rewrite prompt", () => {
    const prompt = buildInlineEditPrompt({
      path: "src/a.ts",
      language: "typescript",
      instruction: "rename x to total",
      selection: "const x = 1;",
      startLine: 10,
      endLine: 10,
    });
    expect(prompt).toContain("rename x to total");
    expect(prompt).toContain("src/a.ts:10-10");
    expect(prompt).toContain("const x = 1;");
  });
});
