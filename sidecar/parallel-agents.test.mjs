import { describe, expect, it } from "vitest";
import {
  mapPool,
  normalizeDelegateTasks,
  formatDelegateSummary,
} from "./parallel-agents.mjs";

describe("parallel-agents", () => {
  it("mapPool respects concurrency and order", async () => {
    const seen = [];
    const results = await mapPool([1, 2, 3, 4], 2, async (n) => {
      seen.push(n);
      await new Promise((r) => setTimeout(r, 5));
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40]);
    expect(seen.sort()).toEqual([1, 2, 3, 4]);
  });

  it("normalizeDelegateTasks caps and requires prompts", () => {
    const tasks = normalizeDelegateTasks({
      tasks: [
        { title: "A", prompt: "do a" },
        { title: "skip" },
        ...Array.from({ length: 10 }, (_, i) => ({
          title: `t${i}`,
          prompt: `p${i}`,
        })),
      ],
    });
    expect(tasks.length).toBe(6);
    expect(tasks[0].title).toBe("A");
  });

  it("formatDelegateSummary includes statuses", () => {
    const text = formatDelegateSummary([
      {
        id: "1",
        title: "Explore auth",
        prompt: "x",
        status: "completed",
        result: "Found verifyToken",
      },
      {
        id: "2",
        title: "Broken",
        prompt: "y",
        status: "failed",
        error: "timeout",
      },
    ]);
    expect(text).toContain("Explore auth");
    expect(text).toContain("timeout");
  });
});
