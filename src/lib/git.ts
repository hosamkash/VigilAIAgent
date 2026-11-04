import { runWorkspaceCommand } from "./workspace-fs";

export type GitChangeStatus = "M" | "A" | "D" | "R" | "C" | "U" | "?" | "!";

export interface GitChange {
  path: string;
  status: GitChangeStatus;
  staged: boolean;
  raw: string;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  isRepo: boolean;
  staged: GitChange[];
  changes: GitChange[];
  untracked: GitChange[];
}

export function parseGitStatusPorcelain(
  porcelain: string,
  branchLine = "",
): GitStatus {
  const staged: GitChange[] = [];
  const changes: GitChange[] = [];
  const untracked: GitChange[] = [];

  for (const line of porcelain.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed) continue;
    if (trimmed.length < 4) continue;
    const x = trimmed[0]!;
    const y = trimmed[1]!;
    let path = trimmed.slice(3);
    if (path.includes(" -> ")) path = path.split(" -> ").pop() ?? path;

    if (x === "?" && y === "?") {
      untracked.push({ path, status: "?", staged: false, raw: trimmed });
      continue;
    }

    if (x !== " " && x !== "?") {
      staged.push({
        path,
        status: x as GitChangeStatus,
        staged: true,
        raw: trimmed,
      });
    }
    if (y !== " " && y !== "?") {
      changes.push({
        path,
        status: y as GitChangeStatus,
        staged: false,
        raw: trimmed,
      });
    }
  }

  let branch = "HEAD";
  let ahead = 0;
  let behind = 0;
  // ## main...origin/main [ahead 1, behind 2]
  if (branchLine.startsWith("## ")) {
    let rest = branchLine.slice(3).trim();
    const bracket = rest.match(/\s+\[([^\]]+)\]$/);
    const tracking = bracket?.[1] ?? "";
    if (bracket) rest = rest.slice(0, bracket.index).trim();
    const dots = rest.indexOf("...");
    branch = (dots >= 0 ? rest.slice(0, dots) : rest) || "HEAD";
    const aheadM = tracking.match(/ahead\s+(\d+)/);
    const behindM = tracking.match(/behind\s+(\d+)/);
    if (aheadM) ahead = Number(aheadM[1]);
    if (behindM) behind = Number(behindM[1]);
  }

  return {
    branch,
    ahead,
    behind,
    isRepo: true,
    staged,
    changes,
    untracked,
  };
}

export async function fetchGitStatus(cwd: string): Promise<GitStatus> {
  try {
    const check = await runWorkspaceCommand(
      "git rev-parse --is-inside-work-tree 2>/dev/null",
      cwd,
    );
    if (!check.includes("true")) {
      return emptyStatus(false);
    }
  } catch {
    return emptyStatus(false);
  }

  const branchOut = await runWorkspaceCommand(
    "git status -sb --porcelain=v1 2>/dev/null || true",
    cwd,
  );
  const lines = branchOut.split("\n").filter((l) => l.length > 0);
  const branchLine = lines.find((l) => l.startsWith("## ")) ?? "";
  const porcelain = lines.filter((l) => !l.startsWith("## ")).join("\n");
  return parseGitStatusPorcelain(porcelain, branchLine);
}

function emptyStatus(isRepo: boolean): GitStatus {
  return {
    branch: "",
    ahead: 0,
    behind: 0,
    isRepo,
    staged: [],
    changes: [],
    untracked: [],
  };
}

export async function gitInit(cwd: string): Promise<string> {
  return runWorkspaceCommand("git init", cwd);
}

export async function gitStage(cwd: string, path: string): Promise<string> {
  return runWorkspaceCommand(`git add -- ${JSON.stringify(path)}`, cwd);
}

export async function gitUnstage(cwd: string, path: string): Promise<string> {
  return runWorkspaceCommand(
    `git restore --staged -- ${JSON.stringify(path)} 2>/dev/null || git reset HEAD -- ${JSON.stringify(path)}`,
    cwd,
  );
}

export async function gitDiscard(cwd: string, path: string): Promise<string> {
  return runWorkspaceCommand(
    `git checkout -- ${JSON.stringify(path)} 2>/dev/null || git restore -- ${JSON.stringify(path)}`,
    cwd,
  );
}

export async function gitCommit(cwd: string, message: string): Promise<string> {
  const msg = message.replace(/"/g, '\\"');
  return runWorkspaceCommand(`git commit -m "${msg}"`, cwd);
}

export async function gitPull(cwd: string): Promise<string> {
  return runWorkspaceCommand("git pull --rebase=false", cwd);
}

export async function gitPush(cwd: string): Promise<string> {
  return runWorkspaceCommand("git push", cwd);
}

export async function gitDiffHead(
  cwd: string,
  path: string,
): Promise<{ original: string; modified: string }> {
  const original = await runWorkspaceCommand(
    `git show HEAD:${JSON.stringify(path).slice(1, -1)} 2>/dev/null || true`,
    cwd,
  );
  const modified = await runWorkspaceCommand(
    `cat ${JSON.stringify(path)} 2>/dev/null || true`,
    cwd,
  );
  // Prefer reading via our FS for modified — caller can pass content
  return {
    original: original.replace(/\n\[exit .*$/s, ""),
    modified: modified.replace(/\n\[exit .*$/s, ""),
  };
}
