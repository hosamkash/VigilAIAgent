import { describe, expect, it } from "vitest";
import {
  applyPlanUpdate,
  formatPlanSummary,
  normalizePlanStatus,
} from "./agent-plan.mjs";

describe("agent-plan", () => {
  it("normalizes statuses", () => {
    expect(normalizePlanStatus("done")).toBe("completed");
    expect(normalizePlanStatus("in-progress")).toBe("in_progress");
  });

  it("merges plan items by id", () => {
    const first = applyPlanUpdate([], {
      items: [
        { id: "a", content: "Explore", status: "pending" },
        { id: "b", content: "Edit", status: "pending" },
      ],
    });
    const next = applyPlanUpdate(first, {
      items: [{ id: "a", content: "Explore", status: "completed" }],
    });
    expect(next).toHaveLength(2);
    expect(next.find((i) => i.id === "a")?.status).toBe("completed");
    expect(formatPlanSummary(next)).toContain("[completed] Explore");
  });
});
