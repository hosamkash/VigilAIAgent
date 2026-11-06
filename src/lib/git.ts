import { invoke } from "@tauri-apps/api/core";
import { parseOnelineLog, type GitLogLine } from "./git-hunks";
import { runWorkspaceCommand } from "./workspace-fs";

export interface GitRepoInfoNative {
  isRepo: boolean;
  hasCommits: boolean;
  branch: string;
  branches: string[];
}

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
  /** Tracking ref such as `origin/main`, when the branch has an upstream. */
  upstream: string | null;
  isRepo: boolean;
  /** False when on an unborn branch (no commits yet). */
  hasCommits: boolean;
  staged: GitChange[];
  changes: GitChange[];
  untracked: GitChange[];
  conflicted: GitChange[];
}

export interface BranchNameValidation {
  ok: boolean;
  error?: string;
  suggested?: string;
}

const BRANCH_INVALID =
  /[\s~^:?*\[\\]|@{|\.\.|^\.|\/\.|\.$|\/$|^@$|^\//;

/** Validate branch names; warn on commas and other git-ref illegal chars. */
export function validateBranchName(name: string): BranchNameValidation {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: "Branch name cannot be empty" };
  }
  if (trimmed.includes(",")) {
    const suggested = sanitizeBranchName(trimmed);
    return {
      ok: false,
      error: `Cannot create branch '${trimmed}' — comma not allowed, use hyphen`,
      suggested,
    };
  }
  if (trimmed.includes(" ")) {
    return {
      ok: false,
      error: "Spaces not allowed in branch names — use hyphens",
      suggested: sanitizeBranchName(trimmed),
    };
  }
  if (BRANCH_INVALID.test(trimmed) || trimmed.includes("//")) {
    return {
      ok: false,
      error: `Invalid branch name '${trimmed}' — avoid ~ ^ : ? * [ \\ .. @{ }`,
      suggested: sanitizeBranchName(trimmed),
    };
  }
  if (trimmed.length > 200) {
    return { ok: false, error: "Branch name is too long" };
  }
  return { ok: true, suggested: trimmed };
}

/** Turn a free-form description into a safe branch slug. */
export function sanitizeBranchName(raw: string): string {
  return raw
    .trim()
    .replace(/,/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^[-./]+|[-./]+$/g, "")
    .slice(0, 80) || "branch";
}

export function parseGitStatusPorcelain(
  porcelain: string,
  branchLine = "",
  hasCommits = true,
): GitStatus {
  const staged: GitChange[] = [];
  const changes: GitChange[] = [];
  const untracked: GitChange[] = [];
  const conflicted: GitChange[] = [];

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

    if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
      conflicted.push({
        path,
        status: "U",
        staged: false,
        raw: trimmed,
      });
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
  let upstream: string | null = null;
  if (branchLine.startsWith("## ")) {
    let rest = branchLine.slice(3).trim();
    const bracket = rest.match(/\s+\[([^\]]+)\]$/);
    const tracking = bracket?.[1] ?? "";
    if (bracket) rest = rest.slice(0, bracket.index).trim();
    const dots = rest.indexOf("...");
    const name = dots >= 0 ? rest.slice(0, dots) : rest;
    if (dots >= 0) {
      const remote = rest.slice(dots + 3).trim();
      upstream = remote || null;
    }
    branch = name.replace(/^No commits yet on /, "") || "HEAD";
    if (name.startsWith("No commits yet on ")) {
      hasCommits = false;
    }
    if (name === "HEAD (no branch)") branch = "HEAD";
    const aheadM = tracking.match(/ahead\s+(\d+)/);
    const behindM = tracking.match(/behind\s+(\d+)/);
    if (aheadM) ahead = Number(aheadM[1]);
    if (behindM) behind = Number(behindM[1]);
  }

  return {
    branch,
    ahead,
    behind,
    upstream,
    isRepo: true,
    hasCommits,
    staged,
    changes,
    untracked,
    conflicted,
  };
}

function stripExit(text: string): string {
  return text.replace(/\n\[exit[\s\S]*$/, "").replace(/\r/g, "");
}

/** Throw when a workspace command reported a non-zero exit. */
export function assertGitOk(out: string): string {
  const match = out.match(/\[exit (-?\d+)\]\s*$/);
  if (match && match[1] !== "0") {
    const msg = out.replace(/\n?\[exit -?\d+\]\s*$/, "").trim();
    throw new Error(msg || `Git failed (exit ${match[1]})`);
  }
  return out.replace(/\n?\[exit 0\]\s*$/, "").trim();
}

function sh(value: string): string {
  if (!value || /[\n\r\0]/.test(value)) {
    throw new Error("Invalid git argument");
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runGit(command: string, cwd: string): Promise<string> {
  return assertGitOk(await runWorkspaceCommand(command, cwd));
}

async function gitText(cwd: string, command: string): Promise<string> {
  try {
    return await runGit(command, cwd);
  } catch {
    return "";
  }
}

function commitCommand(message: string, amend = false): string {
  const safe = message.replace(/\0/g, "");
  const b64 = btoa(unescape(encodeURIComponent(safe)));
  const amendFlag = amend ? "--amend " : "";
  return `printf '%s' ${JSON.stringify(b64)} | base64 -d | git commit ${amendFlag}-F -`;
}

function emptyStatus(isRepo: boolean): GitStatus {
  return {
    branch: "",
    ahead: 0,
    behind: 0,
    upstream: null,
    isRepo,
    hasCommits: false,
    staged: [],
    changes: [],
    untracked: [],
    conflicted: [],
  };
}

export async function gitHasCommits(cwd: string): Promise<boolean> {
  try {
    return await invoke<boolean>("git_has_commits", { cwd });
  } catch {
    const out = await runWorkspaceCommand(
      "git rev-parse HEAD >/dev/null 2>&1; echo $?",
      cwd,
    );
    return stripExit(out).trim().split("\n").pop() === "0";
  }
}

export async function gitRepoInfoNative(
  cwd: string,
): Promise<GitRepoInfoNative | null> {
  try {
    return await invoke<GitRepoInfoNative>("git_repo_info", { cwd });
  } catch {
    return null;
  }
}

export async function fetchGitStatus(cwd: string): Promise<GitStatus> {
  try {
    const check = await runWorkspaceCommand(
      "git rev-parse --is-inside-work-tree 2>/dev/null",
      cwd,
    );
    if (!stripExit(check).includes("true")) {
      return emptyStatus(false);
    }
  } catch {
    return emptyStatus(false);
  }

  const hasCommits = await gitHasCommits(cwd);
  const branchOut = await runWorkspaceCommand(
    "git status -sb --porcelain=v1 2>/dev/null || true",
    cwd,
  );
  const lines = stripExit(branchOut).split("\n").filter((l) => l.length > 0);
  const branchLine = lines.find((l) => l.startsWith("## ")) ?? "";
  const porcelain = lines.filter((l) => !l.startsWith("## ")).join("\n");
  return parseGitStatusPorcelain(porcelain, branchLine, hasCommits);
}

export async function gitInit(cwd: string): Promise<string> {
  return runWorkspaceCommand("git init", cwd);
}

export async function gitStage(cwd: string, path: string): Promise<string> {
  return runWorkspaceCommand(`git add -- ${JSON.stringify(path)}`, cwd);
}

export async function gitStageAll(cwd: string): Promise<string> {
  return runWorkspaceCommand("git add -A", cwd);
}

export async function gitUnstage(cwd: string, path: string): Promise<string> {
  return runWorkspaceCommand(
    `git restore --staged -- ${JSON.stringify(path)} 2>/dev/null || git reset HEAD -- ${JSON.stringify(path)}`,
    cwd,
  );
}

export async function gitUnstageAll(cwd: string): Promise<string> {
  return runWorkspaceCommand(
    "git restore --staged . 2>/dev/null || git reset HEAD",
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
  return runWorkspaceCommand(commitCommand(message), cwd);
}

export async function gitAmend(cwd: string, message?: string): Promise<string> {
  if (message?.trim()) return runGit(commitCommand(message.trim(), true), cwd);
  return runGit("git commit --amend --no-edit", cwd);
}

export async function gitUndoLastCommit(cwd: string): Promise<string> {
  return runGit("git reset --soft HEAD~1", cwd);
}

export async function gitPull(cwd: string): Promise<string> {
  return runWorkspaceCommand("git pull --rebase=false", cwd);
}

export async function gitPush(cwd: string): Promise<string> {
  return runWorkspaceCommand("git push", cwd);
}

export async function gitStash(
  cwd: string,
  message?: string,
  options?: { includeUntracked?: boolean },
): Promise<string> {
  const extra = options?.includeUntracked ? "--include-untracked " : "";
  if (message?.trim()) {
    return runGit(`git stash push ${extra}-m ${sh(message.trim())}`, cwd);
  }
  return runGit(`git stash push ${extra}`.trim(), cwd);
}

export async function gitStagedDiff(cwd: string): Promise<string> {
  const out = await runWorkspaceCommand(
    "git diff --cached 2>/dev/null; git diff 2>/dev/null",
    cwd,
  );
  return stripExit(out);
}

export async function gitDiffPath(
  cwd: string,
  path: string,
  staged: boolean,
): Promise<{ original: string; modified: string }> {
  const showCmd = staged
    ? `git show :${JSON.stringify(path).slice(1, -1)} 2>/dev/null || true`
    : `git show HEAD:${JSON.stringify(path).slice(1, -1)} 2>/dev/null || true`;
  const original = stripExit(await runWorkspaceCommand(showCmd, cwd));
  const modified = stripExit(
    await runWorkspaceCommand(`cat ${JSON.stringify(path)} 2>/dev/null || true`, cwd),
  );
  return { original, modified };
}

export async function gitDiffHead(
  cwd: string,
  path: string,
): Promise<{ original: string; modified: string }> {
  return gitDiffPath(cwd, path, false);
}

export async function gitListBranches(cwd: string): Promise<string[]> {
  const out = await runWorkspaceCommand(
    "git branch --format='%(refname:short)' 2>/dev/null || true",
    cwd,
  );
  return stripExit(out)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function gitCheckout(cwd: string, branch: string): Promise<string> {
  const v = validateBranchName(branch);
  if (!v.ok) throw new Error(v.error);
  return runWorkspaceCommand(`git checkout ${JSON.stringify(branch)}`, cwd);
}

/**
 * Create a branch from a valid commit.
 * If the repo has no commits yet, refuses (caller should create initial commit first)
 * unless `allowOrphan` is used via creating the first commit separately.
 */
export async function gitCreateBranch(
  cwd: string,
  name: string,
  options: { checkout?: boolean; startPoint?: string } = {},
): Promise<string> {
  const v = validateBranchName(name);
  if (!v.ok) throw new Error(v.error);

  const hasCommits = await gitHasCommits(cwd);
  if (!hasCommits) {
    throw new Error(
      "No commits yet — create an initial commit before creating a branch",
    );
  }

  const start = options.startPoint?.trim() || "HEAD";
  // Prefer libgit2 when creating from HEAD (no custom start point).
  if (start === "HEAD") {
    try {
      return await invoke<string>("git_create_branch", {
        cwd,
        name: v.suggested ?? name,
        checkout: options.checkout !== false,
      });
    } catch (err) {
      const msg = String(err);
      if (msg.includes("comma") || msg.includes("No commits")) throw new Error(msg);
      // fall through to CLI
    }
  }

  const cmd =
    options.checkout === false
      ? `git branch ${JSON.stringify(name)} ${JSON.stringify(start)}`
      : `git checkout -b ${JSON.stringify(name)} ${JSON.stringify(start)}`;
  return runWorkspaceCommand(cmd, cwd);
}

export async function gitLogGraphRaw(
  cwd: string,
  maxCount = 80,
): Promise<string> {
  const out = await runWorkspaceCommand(
    `git log --graph --oneline --decorate --all -n ${maxCount} 2>/dev/null || true`,
    cwd,
  );
  return stripExit(out);
}

export async function gitShowCommit(
  cwd: string,
  hash: string,
): Promise<string> {
  const h = hash.replace(/[^0-9a-fA-F]/g, "").slice(0, 40);
  if (!h) return "";
  return stripExit(
    await runWorkspaceCommand(`git show --stat --patch ${h}`, cwd),
  );
}

export async function gitReadConflictSides(
  cwd: string,
  path: string,
): Promise<{ ours: string; theirs: string; base: string }> {
  const p = JSON.stringify(path).slice(1, -1);
  const [ours, theirs, base] = await Promise.all([
    runWorkspaceCommand(`git show :2:${p} 2>/dev/null || true`, cwd),
    runWorkspaceCommand(`git show :3:${p} 2>/dev/null || true`, cwd),
    runWorkspaceCommand(`git show :1:${p} 2>/dev/null || true`, cwd),
  ]);
  return {
    ours: stripExit(ours),
    theirs: stripExit(theirs),
    base: stripExit(base),
  };
}

export type GitRefKind = "branch" | "remote" | "tag" | "commit";

export interface GitStashEntry {
  ref: string;
  message: string;
}

export interface GitWorktree {
  path: string;
  head: string;
  branch: string;
}

export function parseStashList(raw: string): GitStashEntry[] {
  return raw
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab < 0) return { ref: line.trim(), message: line.trim() };
      return {
        ref: line.slice(0, tab).trim(),
        message: line.slice(tab + 1).trim(),
      };
    });
}

export function parseWorktreeList(raw: string): GitWorktree[] {
  const entries: GitWorktree[] = [];
  let current: GitWorktree | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length).trim(), head: "", branch: "" };
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (current && line.startsWith("branch ")) {
      current.branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "");
    } else if (current && line.startsWith("detached")) {
      current.branch = "HEAD";
    }
  }
  if (current) entries.push(current);
  return entries;
}

export function cloneDestination(workspace: string, url: string): string {
  const parent =
    workspace.replace(/\/$/, "").split("/").slice(0, -1).join("/") || workspace;
  let name = url.trim().replace(/\/$/, "").replace(/\.git$/, "");
  name = name.split("/").pop() || "repository";
  if (name.includes(":")) name = name.split(":").pop() || name;
  name = name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-|-$/g, "") || "repository";
  return `${parent}/${name}`;
}

export function worktreeDestination(workspace: string, branch: string): string {
  const base = workspace.replace(/\/$/, "");
  const slash = base.lastIndexOf("/");
  const parent = slash >= 0 ? base.slice(0, slash) : base;
  const repoName = slash >= 0 ? base.slice(slash + 1) : base;
  const safe =
    branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "worktree";
  return `${parent}/${repoName}.worktrees/${safe}`;
}

export async function gitFetch(cwd: string, prune = false): Promise<string> {
  return runGit(prune ? "git fetch --all --prune" : "git fetch --all", cwd);
}

export async function gitPullRebase(cwd: string): Promise<string> {
  return runGit("git pull --rebase", cwd);
}

export async function gitSync(cwd: string): Promise<string> {
  const pull = await runGit("git pull --rebase=false", cwd);
  const push = await runGit("git push", cwd);
  return [pull, push].filter(Boolean).join("\n");
}

export async function gitPushTo(
  cwd: string,
  remote: string,
  branch: string,
): Promise<string> {
  return runGit(`git push -u ${sh(remote)} ${sh(branch)}`, cwd);
}

export async function gitPublishBranch(
  cwd: string,
  remote: string,
): Promise<string> {
  return runGit(`git push -u ${sh(remote)} HEAD`, cwd);
}

export async function gitDiscardAll(
  cwd: string,
  hasCommits: boolean,
): Promise<string> {
  const parts: string[] = [];
  if (hasCommits) {
    parts.push(await runGit("git restore --source=HEAD --staged --worktree .", cwd));
  }
  parts.push(await runGit("git clean -fd", cwd));
  return parts.filter(Boolean).join("\n");
}

export async function gitListRemoteBranches(cwd: string): Promise<string[]> {
  const out = await gitText(cwd, "git branch -r --format='%(refname:short)'");
  return out
    .split("\n")
    .map((line) => line.trim().replace(/^'|'$/g, ""))
    .filter((name) => name.length > 0 && !name.endsWith("/HEAD") && !name.includes("->"));
}

export async function gitListRemotes(cwd: string): Promise<string[]> {
  const out = await gitText(cwd, "git remote");
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function gitListTags(cwd: string): Promise<string[]> {
  const out = await gitText(cwd, "git tag --list");
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function gitCheckoutRef(
  cwd: string,
  ref: string,
  kind: GitRefKind,
): Promise<string> {
  if (ref.startsWith("-")) throw new Error("Invalid git ref");
  if (kind === "tag" || kind === "commit") {
    return runGit(`git checkout --detach ${sh(ref)}`, cwd);
  }
  if (kind === "remote") {
    const slash = ref.indexOf("/");
    const local = slash >= 0 ? ref.slice(slash + 1) : ref;
    const locals = await gitListBranches(cwd);
    if (locals.includes(local)) return runGit(`git checkout ${sh(local)}`, cwd);
    return runGit(`git checkout --track ${sh(ref)}`, cwd);
  }
  return runGit(`git checkout ${sh(ref)}`, cwd);
}

export async function gitRenameBranch(cwd: string, name: string): Promise<string> {
  const v = validateBranchName(name);
  if (!v.ok) throw new Error(v.error);
  return runGit(`git branch -m ${sh(v.suggested ?? name)}`, cwd);
}

export async function gitDeleteBranch(
  cwd: string,
  name: string,
  force = false,
): Promise<string> {
  const v = validateBranchName(name);
  if (!v.ok) throw new Error(v.error);
  return runGit(`git branch ${force ? "-D" : "-d"} ${sh(v.suggested ?? name)}`, cwd);
}

export async function gitDeleteRemoteBranch(
  cwd: string,
  remoteRef: string,
): Promise<string> {
  const slash = remoteRef.indexOf("/");
  if (slash <= 0) throw new Error("Expected remote/branch");
  const remote = remoteRef.slice(0, slash);
  const branch = remoteRef.slice(slash + 1);
  return runGit(`git push ${sh(remote)} --delete ${sh(branch)}`, cwd);
}

export async function gitMerge(cwd: string, branch: string): Promise<string> {
  return runGit(`git merge ${sh(branch)}`, cwd);
}

export async function gitRebase(cwd: string, branch: string): Promise<string> {
  return runGit(`git rebase ${sh(branch)}`, cwd);
}

export async function gitAddRemote(
  cwd: string,
  name: string,
  url: string,
): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("Invalid remote name");
  return runGit(`git remote add ${sh(name)} ${sh(url)}`, cwd);
}

export async function gitRemoveRemote(cwd: string, name: string): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("Invalid remote name");
  return runGit(`git remote remove ${sh(name)}`, cwd);
}

export async function gitCreateTag(cwd: string, name: string): Promise<string> {
  if (!name.trim() || name.startsWith("-") || /[\s~^:?*\[\\]/.test(name)) {
    throw new Error("Invalid tag name");
  }
  return runGit(`git tag ${sh(name.trim())}`, cwd);
}

export async function gitDeleteTag(cwd: string, name: string): Promise<string> {
  return runGit(`git tag -d ${sh(name)}`, cwd);
}

export async function gitListStashes(cwd: string): Promise<GitStashEntry[]> {
  const out = await gitText(cwd, "git stash list --pretty=format:%gd%x09%s");
  return parseStashList(out);
}

export async function gitStashApply(cwd: string, ref: string): Promise<string> {
  return runGit(`git stash apply ${sh(ref)}`, cwd);
}

export async function gitStashPop(cwd: string, ref?: string): Promise<string> {
  return runGit(ref ? `git stash pop ${sh(ref)}` : "git stash pop", cwd);
}

export async function gitStashDrop(cwd: string, ref: string): Promise<string> {
  return runGit(`git stash drop ${sh(ref)}`, cwd);
}

export async function gitStashClear(cwd: string): Promise<string> {
  return runGit("git stash clear", cwd);
}

export async function gitListWorktrees(cwd: string): Promise<GitWorktree[]> {
  const out = await gitText(cwd, "git worktree list --porcelain");
  return parseWorktreeList(out);
}

export async function gitWorktreeAdd(
  cwd: string,
  path: string,
  branch: string,
  create: boolean,
): Promise<string> {
  const parent = path.slice(0, path.lastIndexOf("/"));
  if (parent) await runGit(`mkdir -p ${sh(parent)}`, cwd);
  if (create) {
    return runGit(`git worktree add -b ${sh(branch)} ${sh(path)} HEAD`, cwd);
  }
  return runGit(`git worktree add ${sh(path)} ${sh(branch)}`, cwd);
}

export async function gitWorktreeRemove(cwd: string, path: string): Promise<string> {
  return runGit(`git worktree remove ${sh(path)}`, cwd);
}

export async function gitClone(url: string, dest: string): Promise<string> {
  const parent = dest.slice(0, dest.lastIndexOf("/")) || ".";
  await runGit(`mkdir -p ${sh(parent)}`, parent);
  return runGit(`git clone ${sh(url.trim())} ${sh(dest)}`, parent);
}

export type { GitLogLine };

export async function gitLogRange(
  cwd: string,
  range: string,
): Promise<GitLogLine[]> {
  const out = await gitText(
    cwd,
    `git log --oneline --no-decorate -n 30 ${sh(range)}`,
  );
  return parseOnelineLog(out);
}

export async function gitDiffUnified(
  cwd: string,
  path: string,
  staged: boolean,
): Promise<string> {
  const cached = staged ? "--cached " : "";
  return gitText(cwd, `git diff -U3 ${cached}-- ${sh(path)}`);
}

export async function gitShowSpec(cwd: string, spec: string): Promise<string> {
  return gitText(cwd, `git show ${sh(spec)}`);
}

export async function gitApplyPatch(
  cwd: string,
  patch: string,
  mode: "stage" | "unstage" | "discard",
): Promise<string> {
  const b64 = btoa(unescape(encodeURIComponent(patch)));
  const flags =
    mode === "stage"
      ? "--cached"
      : mode === "unstage"
        ? "--cached --reverse"
        : "--reverse";
  return runGit(
    `printf '%s' ${JSON.stringify(b64)} | base64 -d | git apply ${flags} --whitespace=nowarn`,
    cwd,
  );
}

export async function gitCleanFile(cwd: string, path: string): Promise<string> {
  return runGit(`git clean -f -- ${sh(path)}`, cwd);
}

function commitHash(hash: string): string {
  const h = hash.replace(/[^0-9a-fA-F]/g, "").slice(0, 40);
  if (h.length < 7) throw new Error("Invalid commit");
  return h;
}

export async function gitCherryPick(cwd: string, hash: string): Promise<string> {
  return runGit(`git cherry-pick ${commitHash(hash)}`, cwd);
}

export async function gitCheckoutCommit(
  cwd: string,
  hash: string,
): Promise<string> {
  return runGit(`git checkout --detach ${commitHash(hash)}`, cwd);
}
