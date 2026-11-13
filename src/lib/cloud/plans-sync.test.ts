import { describe, expect, it } from "vitest";
import type { PlanArtifact } from "../plan-artifact";
import { shouldReplaceLocalPlanWithCloud } from "./plans-sync";

function stubPlan(partial: Partial<PlanArtifact>): PlanArtifact {
  return {
    id: "p1",
    title: "t",
    goal: "g",
    status: "draft",
    createdAt: 1,
    updatedAt: 100,
    assumptions: [],
    risks: [],
    steps: [],
    ...partial,
  };
}

describe("shouldReplaceLocalPlanWithCloud", () => {
  it("pulls when local is missing", () => {
    expect(shouldReplaceLocalPlanWithCloud(null, 50)).toBe(true);
  });

  it("keeps newer local", () => {
    expect(
      shouldReplaceLocalPlanWithCloud(stubPlan({ updatedAt: 200 }), 150),
    ).toBe(false);
  });

  it("replaces when cloud is newer", () => {
    expect(
      shouldReplaceLocalPlanWithCloud(stubPlan({ updatedAt: 100 }), 250),
    ).toBe(true);
  });

  it("keeps local on equal timestamps", () => {
    expect(
      shouldReplaceLocalPlanWithCloud(stubPlan({ updatedAt: 100 }), 100),
    ).toBe(false);
  });
});
