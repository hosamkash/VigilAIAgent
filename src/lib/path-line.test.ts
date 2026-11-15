import { describe, expect, it } from "vitest";
import { looksLikeWorkspacePath, parsePathWithLine } from "./path-line";

describe("parsePathWithLine", () => {
  it("parses relative path with line", () => {
    expect(parsePathWithLine("src/lib/foo.ts:42")).toEqual({
      path: "src/lib/foo.ts",
      line: 42,
    });
  });

  it("parses Windows drive path with line", () => {
    expect(parsePathWithLine("C:/proj/src/a.ts:12")).toEqual({
      path: "C:/proj/src/a.ts",
      line: 12,
    });
  });

  it("parses backtick find_definition refs", () => {
    expect(parsePathWithLine("`src/auth.ts:3`")).toEqual({
      path: "src/auth.ts",
      line: 3,
    });
  });

  it("parses vigil-file hash line", () => {
    expect(parsePathWithLine("vigil-file://src/auth.ts#L9")).toEqual({
      path: "src/auth.ts",
      line: 9,
    });
  });

  it("keeps path-only workspace refs", () => {
    expect(parsePathWithLine("src/auth.ts")).toEqual({ path: "src/auth.ts" });
  });

  it("rejects non-paths", () => {
    expect(parsePathWithLine("hello")).toBeNull();
    expect(looksLikeWorkspacePath("https://example.com")).toBe(false);
  });
});
