import { describe, expect, it } from "vitest";
import {
  assertGitOk,
  cloneDestination,
  parseGitStatusPorcelain,
  parseStashList,
  parseWorktreeList,
  sanitizeBranchName,
  validateBranchName,
  worktreeDestination,
  type GitChange,
} from "./git";
import { filterGraphNodes, parseGitGraphLog } from "./git-graph";
import { buildScmMenu } from "./scm-menu";
import { buildChangeTree, sortChanges } from "./scm-view";
import { parseOnelineLog, splitUnifiedHunks } from "./git-hunks";

describe("git status parser", () => {
  it("parses staged, unstaged, and untracked", () => {
    const porcelain = [
      "M  src/a.ts",
      " M src/b.ts",
      "?? new.ts",
      "D  gone.ts",
    ].join("\n");
    const status = parseGitStatusPorcelain(porcelain, "## main...origin/main");
    expect(status.isRepo).toBe(true);
    expect(status.hasCommits).toBe(true);
    expect(status.branch).toBe("main");
    expect(status.staged.map((c) => c.path)).toContain("src/a.ts");
    expect(status.staged.map((c) => c.path)).toContain("gone.ts");
    expect(status.changes.map((c) => c.path)).toContain("src/b.ts");
    expect(status.untracked.map((c) => c.path)).toContain("new.ts");
  });

  it("parses ahead/behind and upstream", () => {
    const status = parseGitStatusPorcelain(
      "",
      "## feature...origin/feature [ahead 2, behind 1]",
    );
    expect(status.branch).toBe("feature");
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(1);
    expect(status.upstream).toBe("origin/feature");
  });

  it("leaves upstream empty when the branch is not tracking", () => {
    const status = parseGitStatusPorcelain("", "## main");
    expect(status.upstream).toBeNull();
  });

  it("detects unborn branch from status line", () => {
    const status = parseGitStatusPorcelain(
      "?? README.md",
      "## No commits yet on main",
    );
    expect(status.hasCommits).toBe(false);
    expect(status.branch).toBe("main");
  });

  it("parses conflicted files", () => {
    const status = parseGitStatusPorcelain("UU conflict.ts", "## main");
    expect(status.conflicted.map((c) => c.path)).toContain("conflict.ts");
  });
});

describe("branch name validation", () => {
  it("rejects commas with helpful message", () => {
    const v = validateBranchName("01-Project-phase1,2,3");
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/comma not allowed/i);
    expect(v.suggested).toBe("01-Project-phase1-2-3");
  });

  it("accepts conventional names", () => {
    expect(validateBranchName("feat/add-login-page").ok).toBe(true);
    expect(validateBranchName("01-Project-phase1-2-3").ok).toBe(true);
  });

  it("sanitizes free text", () => {
    expect(sanitizeBranchName("add login page")).toBe("add-login-page");
    expect(sanitizeBranchName("01-Project-phase1,2,3")).toBe(
      "01-Project-phase1-2-3",
    );
  });
});

describe("git graph parser", () => {
  it("parses oneline graph with decorate", () => {
    const raw = [
      "* abc1234 (HEAD -> main, origin/main) Initial commit: Project setup",
      "* def5678 (feat/login) Add login page",
    ].join("\n");
    const { nodes, maxLanes } = parseGitGraphLog(raw);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.shortHash).toBe("abc1234");
    expect(nodes[0]!.isHead).toBe(true);
    expect(nodes[0]!.refs.some((r) => r.includes("main"))).toBe(true);
    expect(nodes[1]!.message).toContain("Add login");
    expect(maxLanes).toBeGreaterThanOrEqual(1);
  });

  it("filters by search query", () => {
    const { nodes } = parseGitGraphLog(
      "* aaa1111 Fix typo\n* bbb2222 feat: auth",
    );
    expect(filterGraphNodes(nodes, "auth")).toHaveLength(1);
    expect(filterGraphNodes(nodes, "aaa")).toHaveLength(1);
  });
});

describe("git command helpers", () => {
  it("rejects failed git output and keeps success text", () => {
    expect(assertGitOk("Already up to date.")).toBe("Already up to date.");
    expect(() => assertGitOk("fatal: not a git repository\n[exit 128]")).toThrow(
      /not a git repository/,
    );
  });

  it("parses stash and worktree lists", () => {
    expect(parseStashList("stash@{0}\twip: login\nstash@{1}\ttemp")).toEqual([
      { ref: "stash@{0}", message: "wip: login" },
      { ref: "stash@{1}", message: "temp" },
    ]);
    expect(
      parseWorktreeList(
        [
          "worktree /repo",
          "HEAD abc",
          "branch refs/heads/main",
          "",
          "worktree /repo.worktrees/feat",
          "HEAD def",
          "branch refs/heads/feat",
        ].join("\n"),
      ),
    ).toEqual([
      { path: "/repo", head: "abc", branch: "main" },
      { path: "/repo.worktrees/feat", head: "def", branch: "feat" },
    ]);
  });

  it("builds clone and worktree paths beside the workspace", () => {
    expect(cloneDestination("/work/app", "git@github.com:org/demo.git")).toBe(
      "/work/demo",
    );
    expect(worktreeDestination("/work/app", "feat/login")).toBe(
      "/work/app.worktrees/feat-login",
    );
  });
});

describe("source control menu", () => {
  const menu = buildScmMenu({
    repo: true,
    hasCommits: true,
    busy: false,
    viewMode: "list",
    sortBy: "path",
  });

  it("matches the Cursor more-actions groups", () => {
    expect(menu.map((item) => item.label)).toEqual([
      "View & Sort",
      "Pull",
      "Push",
      "Clone",
      "Checkout to...",
      "Fetch",
      "Commit",
      "Changes",
      "Pull, Push",
      "Branch",
      "Remote",
      "Stash",
      "Tags",
      "Worktrees",
      "Show Git Output",
    ]);
  });

  it("includes create-from and the rest of the branch actions", () => {
    const branch = menu.find((item) => item.id === "branchMenu");
    expect(branch?.children?.map((item) => item.label)).toEqual([
      "Merge...",
      "Rebase Branch...",
      "Create Branch...",
      "Create Branch From...",
      "Rename Branch...",
      "Delete Branch...",
      "Delete Remote Branch...",
      "Publish Branch...",
    ]);
  });

  it("keeps history actions disabled until the first commit", () => {
    const fresh = buildScmMenu({
      repo: true,
      hasCommits: false,
      busy: false,
      viewMode: "list",
      sortBy: "path",
    });
    expect(fresh.find((item) => item.id === "branchMenu")?.disabled).toBe(true);
    expect(fresh.find((item) => item.id === "checkout")?.disabled).toBe(true);
    expect(fresh.find((item) => item.id === "commitMenu")?.disabled).toBe(false);
  });
});

describe("unified diff hunks", () => {
  it("splits each hunk into its own patch", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 111..222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      " line",
      "-old",
      "+new",
      "@@ -10,2 +10,3 @@",
      " keep",
      "+added",
    ].join("\n");
    const hunks = splitUnifiedHunks(diff);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.preview).toBe("old");
    expect(hunks[0]?.patch).toContain("@@ -1,3 +1,3 @@");
    expect(hunks[0]?.patch).not.toContain("@@ -10,2 +10,3 @@");
    expect(hunks[1]?.patch.startsWith("diff --git")).toBe(true);
  });

  it("parses oneline log rows", () => {
    expect(parseOnelineLog("abc1234 Fix login\ndef5678 Add tests")).toEqual([
      { hash: "abc1234", message: "Fix login" },
      { hash: "def5678", message: "Add tests" },
    ]);
  });
});

describe("change list view", () => {
  const changes: GitChange[] = [
    { path: "src/b.ts", status: "M", staged: false, raw: " M src/b.ts" },
    { path: "src/a.ts", status: "A", staged: true, raw: "A  src/a.ts" },
    { path: "readme.md", status: "?", staged: false, raw: "?? readme.md" },
  ];

  it("sorts by name and nests a tree by folder", () => {
    expect(sortChanges(changes, "name").map((change) => change.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "readme.md",
    ]);
    const tree = buildChangeTree(changes, "path");
    expect(tree.map((node) => (node.type === "dir" ? node.name : node.change.path))).toEqual([
      "src",
      "readme.md",
    ]);
    const src = tree[0];
    expect(src?.type).toBe("dir");
    if (src?.type === "dir") {
      expect(src.children.map((node) => (node.type === "file" ? node.change.path : ""))).toEqual([
        "src/a.ts",
        "src/b.ts",
      ]);
    }
  });
});
