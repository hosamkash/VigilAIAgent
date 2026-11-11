import { describe, expect, it } from "vitest";
import { normalizeDelegateTasks } from "./parallel-agents.mjs";

// Lightweight contract checks for CI helper text shapes (no network).
describe("ci loop helpers", () => {
  it("delegate task shape stays stable for CI-oriented prompts", () => {
    const tasks = normalizeDelegateTasks({
      tasks: [
        {
          title: "Fix CI",
          prompt: "Read failing checks and patch tests",
          branch: "fix/ci-flaky",
        },
      ],
    });
    expect(tasks[0].branch).toBe("fix/ci-flaky");
    expect(tasks[0].prompt).toMatch(/failing checks/i);
  });
});
