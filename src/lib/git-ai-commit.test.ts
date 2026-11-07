import { describe, expect, it } from "vitest";
import { normalizeCommitMessage } from "./git-ai";

describe("normalizeCommitMessage", () => {
  it("keeps a subject and body", () => {
    const raw = [
      "feat(scm): pin commit box above source-control tabs",
      "",
      "- Keep commit/push actions visible on Changes, Graph, and Branches",
      "- Switch primary button to Push/Sync when the tree is clean",
    ].join("\n");
    expect(normalizeCommitMessage(raw)).toBe(raw);
  });

  it("strips markdown fences and vague wrappers", () => {
    expect(
      normalizeCommitMessage(
        '```\nfix(ui): clarify source control layout\n\n- Move commit controls to a sticky header\n```',
      ),
    ).toContain("fix(ui): clarify source control layout");
  });
});
