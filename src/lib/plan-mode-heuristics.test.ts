import { describe, expect, it } from "vitest";
import {
  isOpsStepContent,
  looksArabic,
  shouldSuggestPlanMode,
} from "./plan-mode-heuristics";
import {
  createPlanArtifact,
  formatLastPlanRevisionDiff,
  recordPlanRevision,
} from "./plan-artifact";

describe("plan-mode-heuristics", () => {
  it("suggests Plan mode for large multi-step prompts", () => {
    expect(shouldSuggestPlanMode("hi")).toBe(false);
    expect(
      shouldSuggestPlanMode(
        "Please refactor the auth module across multiple files and add tests step by step.",
      ),
    ).toBe(true);
    expect(
      shouldSuggestPlanMode(
        "عايز خطة نعدّل أكتر من ملف في المشروع وننفّذ الميزة على مراحل",
      ),
    ).toBe(true);
  });

  it("detects Arabic and ops steps", () => {
    expect(looksArabic("خطة التنفيذ")).toBe(true);
    expect(looksArabic("Execute plan")).toBe(false);
    expect(isOpsStepContent("Run npm test and watch CI")).toBe(true);
    expect(isOpsStepContent("Edit PlanPanel")).toBe(false);
  });

  it("records revision diffs for draft edits", () => {
    let plan = createPlanArtifact({
      goal: "G",
      steps: [
        { id: "a", content: "One", status: "pending" },
        { id: "b", content: "Two", status: "pending" },
      ],
    });
    plan = recordPlanRevision(plan, "v1");
    plan = {
      ...plan,
      steps: [
        plan.steps[0],
        { ...plan.steps[1], content: "Two edited" },
        { id: "c", content: "Three", status: "pending" },
      ],
    };
    plan = recordPlanRevision(plan, "v2");
    const diff = formatLastPlanRevisionDiff(plan);
    expect(diff).toContain("+ Two edited");
    expect(diff).toContain("+ Three");
    expect(diff).toContain("− Two");
  });
});
