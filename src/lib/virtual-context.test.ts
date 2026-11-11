import { describe, expect, it } from "vitest";
import {
  formatCodebaseContext,
  formatProblemsContext,
  matchVirtualMention,
} from "./virtual-context";

describe("virtual-context", () => {
  it("matches virtual mention prefixes", () => {
    expect(matchVirtualMention("prob")).toBe("problems");
    expect(matchVirtualMention("code")).toBe("codebase");
    expect(matchVirtualMention("tab")).toBe("open");
    expect(matchVirtualMention("App")).toBeNull();
  });

  it("formats problems", () => {
    const text = formatProblemsContext([
      {
        id: "1",
        path: "/p/a.ts",
        message: "bad",
        severity: "error",
        line: 2,
        column: 1,
      },
    ]);
    expect(text).toContain("error: bad");
    expect(text).toContain("/p/a.ts:2:1");
  });

  it("includes deep index stats in @codebase context", () => {
    const text = formatCodebaseContext(
      [{ path: "/p/a.ts", name: "a.ts", label: "a.ts" }],
      3,
      { deep: true, fileCount: 10, chunkCount: 40, vectorCount: 40, edgeCount: 12 },
    );
    expect(text).toContain("Deep local index: ready");
    expect(text).toContain("40 chunks");
    expect(text).toContain("find_definition");
  });
});
