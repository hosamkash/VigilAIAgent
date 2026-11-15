import { describe, expect, it } from "vitest";
import { MAX_EXTRA_MODELS, pickTsModelPaths } from "./monaco-project-ts";

describe("pickTsModelPaths", () => {
  const root = "/proj";
  const indexed = [
    "/proj/src/a.ts",
    "/proj/src/b.ts",
    "/proj/src/c.ts",
    "/proj/src/d.ts",
    "/proj/readme.md",
  ];

  it("puts open-tab seeds and neighbors before the rest of the index", () => {
    const picked = pickTsModelPaths({
      workspaceRoot: root,
      indexedTsJsPaths: indexed,
      seedPaths: ["/proj/src/c.ts"],
      neighborPaths: ["src/d.ts"],
      maxModels: 4,
    });
    expect(picked[0]).toBe("/proj/src/c.ts");
    expect(picked[1]).toBe("/proj/src/d.ts");
    expect(picked).toContain("/proj/src/a.ts");
    expect(picked.every((p) => p.endsWith(".ts"))).toBe(true);
  });

  it("dedupes and respects the cap", () => {
    const picked = pickTsModelPaths({
      workspaceRoot: root,
      indexedTsJsPaths: indexed,
      seedPaths: ["/proj/src/a.ts", "src/a.ts"],
      neighborPaths: ["/proj/src/a.ts"],
      maxModels: 2,
    });
    expect(picked).toEqual(["/proj/src/a.ts", "/proj/src/b.ts"]);
    expect(picked.length).toBeLessThanOrEqual(MAX_EXTRA_MODELS);
  });
});
