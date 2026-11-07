import { describe, expect, it } from "vitest";
import type { GitStatus } from "./git";
import {
  buildExplorerGitDecorations,
  letterForGitKind,
} from "./git-explorer-decorations";

function status(partial: Partial<GitStatus>): GitStatus {
  return {
    branch: "main",
    ahead: 0,
    behind: 0,
    upstream: null,
    isRepo: true,
    hasCommits: true,
    staged: [],
    changes: [],
    untracked: [],
    conflicted: [],
    ...partial,
  };
}

describe("letterForGitKind", () => {
  it("uses N for new/untracked instead of U", () => {
    expect(letterForGitKind("untracked")).toBe("N");
    expect(letterForGitKind("modified")).toBe("M");
  });
});

describe("buildExplorerGitDecorations", () => {
  it("colors files and bubbles status into parent folders", () => {
    const map = buildExplorerGitDecorations(
      "/proj",
      status({
        changes: [{ path: "src/app.ts", status: "M", staged: false, raw: " M src/app.ts" }],
        untracked: [{ path: "src/new.ts", status: "?", staged: false, raw: "?? src/new.ts" }],
      }),
    );
    expect(map["/proj/src/app.ts"]).toEqual({ kind: "modified", letter: "M" });
    expect(map["/proj/src/new.ts"]).toEqual({ kind: "untracked", letter: "N" });
    expect(map["/proj/src"]?.letter).toBe("M");
  });

  it("prefers conflict over modified on the same folder", () => {
    const map = buildExplorerGitDecorations(
      "/proj",
      status({
        changes: [{ path: "a/x.ts", status: "M", staged: false, raw: " M a/x.ts" }],
        conflicted: [{ path: "a/y.ts", status: "U", staged: false, raw: "UU a/y.ts" }],
      }),
    );
    expect(map["/proj/a"]).toEqual({ kind: "conflict", letter: "C" });
  });
});
