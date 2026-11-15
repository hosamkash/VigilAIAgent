import { describe, expect, it } from "vitest";
import {
  buildCiFixPrompt,
  draftPrBodyFromPlan,
  formatCiStatusForAgent,
  type CiStatusSummary,
} from "./git-pr";

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

  it("builds a fix prompt and plan-based PR body", () => {
    const summary: CiStatusSummary = {
      state: "failure",
      prNumber: 3,
      checks: [
        { name: "typecheck", status: "completed", conclusion: "failure" },
      ],
    };
    const prompt = buildCiFixPrompt(summary);
    expect(prompt).toContain("Do not force-push");
    expect(prompt).toContain("typecheck");
    const body = draftPrBodyFromPlan({
      title: "CI loop",
      goal: "Green checks",
      steps: [{ content: "Fix types", status: "completed" }],
    });
    expect(body).toContain("## CI loop");
    expect(body).toContain("[x] 1. Fix types");
  });
});
