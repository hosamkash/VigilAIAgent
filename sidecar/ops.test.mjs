import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveToolCwd } from "./ops.mjs";

describe("resolveToolCwd", () => {
  it("allows workspace and sibling worktrees", () => {
    const base = "/work/app";
    expect(resolveToolCwd(undefined, base)).toBe(path.resolve(base));
    expect(resolveToolCwd("/work/app.worktrees/feat", base)).toBe(
      path.resolve("/work/app.worktrees/feat"),
    );
  });

  it("rejects paths outside workspace/worktrees", () => {
    expect(() => resolveToolCwd("/tmp/other", "/work/app")).toThrow(/workdir/);
  });
});
