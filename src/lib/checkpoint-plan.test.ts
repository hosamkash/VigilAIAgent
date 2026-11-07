import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceRoot,
  planRestore,
  type CheckpointSnapshot,
} from "./checkpoint-plan";

function snap(
  id: string,
  createdAt: number,
  files: CheckpointSnapshot["files"],
): CheckpointSnapshot {
  return { id, workspace: "/proj", createdAt, files };
}

describe("normalizeWorkspaceRoot", () => {
  it("strips a trailing slash and parent segments", () => {
    expect(normalizeWorkspaceRoot("/tmp/proj/")).toBe("/tmp/proj");
    expect(normalizeWorkspaceRoot("/tmp/foo/../proj")).toBe("/tmp/proj");
  });
});

describe("planRestore", () => {
  it("puts each file back to the first snapshot from the chosen command on", () => {
    const files = planRestore(
      [
        snap("turn-2", 2, [
          { path: "a.ts", existed: true, content: "after turn 1" },
          { path: "b.ts", existed: false, content: "" },
        ]),
        snap("turn-1", 1, [{ path: "a.ts", existed: true, content: "original" }]),
      ],
      "turn-1",
    );
    expect(files).toEqual([
      { path: "a.ts", existed: true, content: "original" },
      { path: "b.ts", existed: false, content: "" },
    ]);
  });

  it("keeps an earlier command's file when a later command did not touch it", () => {
    const files = planRestore(
      [
        snap("turn-1", 1, [{ path: "a.ts", existed: true, content: "original" }]),
        snap("turn-2", 2, [{ path: "b.ts", existed: false, content: "" }]),
      ],
      "turn-2",
    );
    expect(files).toEqual([{ path: "b.ts", existed: false, content: "" }]);
  });
});
