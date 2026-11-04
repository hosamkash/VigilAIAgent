import { describe, expect, it } from "vitest";
import { parseGitStatusPorcelain } from "./git";

describe("git status parser", () => {
  it("parses staged, unstaged, and untracked", () => {
    const porcelain = [
      "M  src/a.ts",
      " M src/b.ts",
      "?? new.ts",
      "D  gone.ts",
    ].join("\n");
    const status = parseGitStatusPorcelain(porcelain, "## main...origin/main");
    expect(status.isRepo).toBe(true);
    expect(status.branch).toBe("main");
    expect(status.staged.map((c) => c.path)).toContain("src/a.ts");
    expect(status.staged.map((c) => c.path)).toContain("gone.ts");
    expect(status.changes.map((c) => c.path)).toContain("src/b.ts");
    expect(status.untracked.map((c) => c.path)).toContain("new.ts");
  });

  it("parses ahead/behind", () => {
    const status = parseGitStatusPorcelain(
      "",
      "## feature...origin/feature [ahead 2, behind 1]",
    );
    expect(status.branch).toBe("feature");
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(1);
  });
});
