import { describe, expect, it } from "vitest";
import { formatCiStatusForAgent, type CiStatusSummary } from "./git-pr";

describe("formatCiStatusForAgent", () => {
  it("summarizes failing checks", () => {
    const summary: CiStatusSummary = {
      state: "failure",
      prNumber: 12,
      prUrl: "https://github.com/o/r/pull/12",
      checks: [
        {
          name: "test",
          status: "completed",
          conclusion: "failure",
          url: "https://example.com",
        },
      ],
    };
    const text = formatCiStatusForAgent(summary);
    expect(text).toContain("CI state: failure");
    expect(text).toContain("#12");
    expect(text).toContain("test: completed (failure)");
    expect(text).toContain("Fix failing checks");
  });
});
