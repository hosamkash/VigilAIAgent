import { describe, expect, it } from "vitest";
import {
  extractCiFailureHints,
  parseGhPrChecks,
} from "./ops.mjs";

describe("parseGhPrChecks", () => {
  it("flags fail lines and extracts file:line hints", () => {
    const text = [
      "lint\tfail\t1s\thttps://example/lint",
      "test\tpass\t12s\thttps://example/test",
      "typecheck\tfail\t3s\thttps://example/tsc",
      "  src/lib/git-pr.ts:42: error TS2322",
    ].join("\n");
    const parsed = parseGhPrChecks(text);
    expect(parsed.failed).toBe(true);
    expect(parsed.pending).toBe(false);
    expect(parsed.failedLines.length).toBe(2);
    const hints = extractCiFailureHints(text);
    expect(hints.some((h) => h.includes("git-pr.ts:42"))).toBe(true);
  });

  it("treats pending checks as not failed", () => {
    const parsed = parseGhPrChecks("build\tpending\t0s\n");
    expect(parsed.failed).toBe(false);
    expect(parsed.pending).toBe(true);
  });
});
