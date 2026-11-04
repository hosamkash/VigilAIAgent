import { describe, expect, it } from "vitest";
import { estimateUsage, formatUsd, formatUsageLine, sumUsage } from "./cost";

describe("cost helpers", () => {
  it("formats usd to 4 decimals", () => {
    expect(formatUsd(0.0029)).toBe("$0.0029");
  });

  it("builds usage footer line", () => {
    const line = formatUsageLine({
      inputTokens: 3336,
      outputTokens: 54,
      cost: 0.0029,
    });
    expect(line).toContain("Cost: $0.0029");
    expect(line).toContain("3336 in / 54 out");
  });

  it("sums usage snapshots", () => {
    const total = sumUsage([
      { inputTokens: 10, outputTokens: 2, cost: 0.001 },
      { inputTokens: 5, outputTokens: 1, cost: 0.0005 },
    ]);
    expect(total.inputTokens).toBe(15);
    expect(total.outputTokens).toBe(3);
    expect(total.cost).toBeCloseTo(0.0015);
  });

  it("estimates tokens from text length", () => {
    const usage = estimateUsage("abcd".repeat(10), "wxyz".repeat(5), "gemini");
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.cost).toBeGreaterThanOrEqual(0);
  });
});
