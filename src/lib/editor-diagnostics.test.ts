import { describe, expect, it } from "vitest";
import {
  formatEditorProblem,
  isTsJsPath,
  monacoSeverityToProblem,
} from "./editor-diagnostics";

describe("editor-diagnostics", () => {
  it("detects ts/js paths", () => {
    expect(isTsJsPath("src/App.tsx")).toBe(true);
    expect(isTsJsPath("a.rs")).toBe(false);
  });

  it("maps monaco severities", () => {
    expect(monacoSeverityToProblem(8)).toBe("error");
    expect(monacoSeverityToProblem(4)).toBe("warning");
  });

  it("formats problems", () => {
    expect(
      formatEditorProblem({
        id: "1",
        path: "src/a.ts",
        message: "bad",
        severity: "error",
        line: 2,
        column: 3,
      }),
    ).toContain("src/a.ts:2:3");
  });
});
