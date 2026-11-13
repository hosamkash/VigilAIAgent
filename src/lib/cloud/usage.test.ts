import { describe, expect, it } from "vitest";
import { estimateTokenDebit } from "./usage";

describe("estimateTokenDebit", () => {
  it("sums input and output", () => {
    expect(estimateTokenDebit({ inputTokens: 10, outputTokens: 5 })).toBe(15);
  });

  it("floors and clamps", () => {
    expect(estimateTokenDebit({ inputTokens: -1, outputTokens: 3.9 })).toBe(3);
  });
});
