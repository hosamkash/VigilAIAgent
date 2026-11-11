import { describe, expect, it } from "vitest";
import { buildBm25, tokenize } from "./bm25.mjs";

describe("tokenize", () => {
  it("splits camelCase and lowers", () => {
    const tokens = tokenize("searchCodebase helper");
    expect(tokens).toContain("search");
    expect(tokens).toContain("codebase");
    expect(tokens).toContain("helper");
  });
});

describe("buildBm25", () => {
  it("ranks the document that mentions the query higher", () => {
    const bm25 = buildBm25([
      { id: "a", text: "function listFiles() { return []; }" },
      { id: "b", text: "function searchCodebase(query) { return query; }" },
      { id: "c", text: "const unrelated = 1;" },
    ]);
    const hits = bm25.search("searchCodebase", 3);
    expect(hits[0]?.id).toBe("b");
    expect(hits[0]?.score).toBeGreaterThan(0);
  });
});
