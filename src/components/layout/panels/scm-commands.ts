import { useLayoutStore } from "../../../store/layoutStore";
import {
  assertGitOk,
  cloneDestination,
  gitAddRemote,
  gitAmend,
  gitCheckout,
  gitCheckoutRef,
  gitClone,
  gitCommit,
  gitCreateBranch,
  gitCreateTag,
  gitDeleteBranch,
  gitDeleteRemoteBranch,
  gitDeleteTag,
  gitDiscardAll,
  gitFetch,
  gitListBranches,
  gitListRemoteBranches,
  gitListRemotes,
  gitListStashes,
  gitListTags,
  gitListWorktrees,
  gitMerge,
  gitPublishBranch,
  gitPull,
  gitPullRebase,
  gitPush,
  gitPushTo,
  gitRebase,
  gitRemoveRemote,
  gitRenameBranch,
  gitStash,
  gitStashApply,
  gitStashClear,
  gitStashDrop,
  gitStashPop,
  gitStageAll,
  gitSync,
  gitUndoLastCommit,
  gitUnstageAll,
  gitWorktreeAdd,
  gitWorktreeRemove,
  validateBranchName,
  worktreeDestination,
  type GitRefKind,
  type GitStatus,
} from "../../../lib/git";
import type { ChangeSort, ChangeView } from "../../../lib/scm-view";
import type { ScmPromptRequest } from "./ScmMenu";

type Attempt = (
  label: string,
  fn: () => Promise<string>,
) => Promise<{ ok: boolean; error?: string }>;

export async function runScmCommand(
  id: string,
  opts: {
    root: string;
    status: GitStatus | null;
    message: string;
    busy: boolean;
    setMessage: (value: string) => void;
    setUiError: (value: string | null) => void;
    setViewMode: (value: ChangeView) => void;
    setSortBy: (value: ChangeSort) => void;
    ask: (request: ScmPromptRequest) => Promise<string | null>;
    attempt: Attempt;
  },
): Promise<void> {
  if (
    opts.busy &&
    id !== "showOutput" &&
    !id.startsWith("view") &&
    !id.startsWith("sort")
  ) {
    return;
  }

  const { root, status, ask, attempt, setUiError, setMessage } = opts;
  const message = opts.message.trim();

  const requireMessage = () => {
    if (!message) {
      setUiError("Enter a commit message");
      return null;
    }
    return message;
  };

  const finishCommit = async (label: string, fn: () => Promise<string>) => {
    const result = await attempt(label, fn);
    if (result.ok) setMessage("");
  };

  if (id.startsWith("checkout:")) {
    const name = id.slice("checkout:".length);
    await attempt("Checking out…", () => gitCheckout(root, name));
    return;
  }

  switch (id) {
    case "viewList":
      opts.setViewMode("list");
      return;
    case "viewTree":
      opts.setViewMode("tree");
      return;
    case "sortName":
      opts.setSortBy("name");
      return;
    case "sortPath":
      opts.setSortBy("path");
      return;
    case "sortStatus":
      opts.setSortBy("status");
      return;
    case "showOutput":
      useLayoutStore.getState().setBottomTab("output");
      return;
    case "pull":
      await attempt("Pulling…", () => gitPull(root));
      return;
    case "push":
      await attempt("Pushing…", () => gitPush(root));
      return;
    case "fetch":
      await attempt("Fetching…", () => gitFetch(root));
      return;
    case "fetchPrune":
      await attempt("Fetching…", () => gitFetch(root, true));
      return;
    case "pullRebase":
      await attempt("Pulling…", () => gitPullRebase(root));
      return;
    case "sync":
      await attempt("Syncing…", () => gitSync(root));
      return;
    case "clone": {
      const url = await ask({
        kind: "input",
        title: "Clone",
        placeholder: "https://github.com/org/repo.git",
        confirm: "Clone",
      });
      if (!url) return;
      const dest = cloneDestination(root, url);
      await attempt("Cloning…", () => gitClone(url, dest));
      return;
    }
    case "checkout": {
      const [locals, remotes, tags] = await Promise.all([
        gitListBranches(root),
        gitListRemoteBranches(root),
        gitListTags(root),
      ]);
      const picked = await ask({
        kind: "pick",
        title: "Checkout to...",
        allowCustom: true,
        empty: "No branches or tags",
        options: [
          ...locals.map((branch) => ({
            id: `branch:${branch}`,
            label: branch,
            detail: "branch",
          })),
          ...remotes.map((branch) => ({
            id: `remote:${branch}`,
            label: branch,
            detail: "remote",
          })),
          ...tags.map((tag) => ({
            id: `tag:${tag}`,
            label: tag,
            detail: "tag",
          })),
        ],
      });
      if (!picked) return;
      if (picked.startsWith("commit:")) {
        await attempt("Checking out…", () =>
          gitCheckoutRef(root, picked.slice("commit:".length), "commit"),
        );
        return;
      }
      const split = picked.indexOf(":");
      const kind = picked.slice(0, split) as GitRefKind;
      const ref = picked.slice(split + 1);
      await attempt("Checking out…", () => gitCheckoutRef(root, ref, kind));
      return;
    }
    case "commit":
    case "commitAll":
    case "commitStaged": {
      if (id === "commitStaged" && !(status?.staged.length)) {
        setUiError("No staged changes to commit");
        return;
      }
      const text = requireMessage();
      if (!text) return;
      await finishCommit("Committing…", async () => {
        if (id === "commitAll" || (id === "commit" && !status?.staged.length)) {
          assertGitOk(await gitStageAll(root));
        }
        return gitCommit(root, text);
      });
      return;
    }
    case "commitAmend":
    case "commitAllAmend":
    case "commitStagedAmend": {
      if ((status?.ahead ?? 0) === 0) {
        const yes = await ask({
          kind: "confirm",
          title: "Commit (Amend)",
          message:
            "Amend the last commit? If it was already pushed, updating the remote needs a force push.",
          confirm: "Amend",
        });
        if (!yes) return;
      }
      await finishCommit("Amending…", async () => {
        if (id === "commitAllAmend") assertGitOk(await gitStageAll(root));
        return gitAmend(root, message || undefined);
      });
      return;
    }
    case "undoCommit": {
      const yes = await ask({
        kind: "confirm",
        title: "Undo Last Commit",
        message: "Undo the last commit? Its changes stay staged.",
        confirm: "Undo",
      });
      if (!yes) return;
      await attempt("Undoing commit…", () => gitUndoLastCommit(root));
      return;
    }
    case "stageAll":
      await attempt("Staging…", () => gitStageAll(root));
      return;
    case "unstageAll":
      await attempt("Unstaging…", () => gitUnstageAll(root));
      return;
    case "discardAll": {
      const yes = await ask({
        kind: "confirm",
        title: "Discard All Changes",
        message:
          "Discard all tracked and untracked changes in this repository? This cannot be undone.",
        confirm: "Discard",
        danger: true,
      });
      if (!yes) return;
      await attempt("Discarding…", () =>
        gitDiscardAll(root, !!status?.hasCommits),
      );
      return;
    }
    case "pushTo":
    case "publishBranch": {
      const remotes = await gitListRemotes(root);
      if (remotes.length === 0) {
        setUiError("No remotes. Add a remote first.");
        return;
      }
      const remote =
        remotes.length === 1
          ? remotes[0]
          : await ask({
              kind: "pick",
              title: id === "pushTo" ? "Push to..." : "Publish Branch...",
              options: remotes.map((name) => ({ id: name, label: name })),
            });
      if (!remote) return;
      if (id === "publishBranch") {
        await attempt("Publishing…", () => gitPublishBranch(root, remote));
        return;
      }
      const branch = status?.branch;
      if (!branch) return;
      await attempt("Pushing…", () => gitPushTo(root, remote, branch));
      return;
    }
    case "merge":
    case "rebase":
    case "createBranchFrom":
    case "deleteBranch":
    case "deleteRemoteBranch": {
      if (id === "createBranchFrom") {
        const [locals, remotes] = await Promise.all([
          gitListBranches(root),
          gitListRemoteBranches(root),
        ]);
        const from = await ask({
          kind: "pick",
          title: "Create Branch From...",
          empty: "No branches",
          options: [
            ...locals.map((branch) => ({
              id: branch,
              label: branch,
              detail: "local",
            })),
            ...remotes.map((branch) => ({
              id: branch,
              label: branch,
              detail: "remote",
            })),
          ],
        });
        if (!from) return;
        const name = await ask({
          kind: "input",
          title: "Create Branch",
          placeholder: "feat/new-branch",
          confirm: "Create",
        });
        if (!name) return;
        const valid = validateBranchName(name);
        if (!valid.ok) {
          setUiError(valid.error ?? "Invalid branch name");
          return;
        }
        await attempt("Creating branch…", () =>
          gitCreateBranch(root, valid.suggested ?? name, {
            checkout: true,
            startPoint: from,
          }),
        );
        return;
      }
      if (id === "deleteBranch") {
        const locals = (await gitListBranches(root)).filter(
          (branch) => branch !== status?.branch,
        );
        const name = await ask({
          kind: "pick",
          title: "Delete Branch...",
          empty: "No other branches",
          options: locals.map((branch) => ({ id: branch, label: branch })),
        });
        if (!name) return;
        const yes = await ask({
          kind: "confirm",
          title: "Delete Branch",
          message: `Delete branch '${name}'?`,
          confirm: "Delete",
          danger: true,
        });
        if (!yes) return;
        const result = await attempt("Deleting branch…", () =>
          gitDeleteBranch(root, name, false),
        );
        if (!result.ok && /not fully merged/i.test(result.error ?? "")) {
          setUiError(null);
          const force = await ask({
            kind: "confirm",
            title: "Delete Branch",
            message: `Branch '${name}' is not fully merged. Delete it anyway?`,
            confirm: "Force Delete",
            danger: true,
          });
          if (force) {
            await attempt("Deleting branch…", () =>
              gitDeleteBranch(root, name, true),
            );
          }
        }
        return;
      }
      if (id === "deleteRemoteBranch") {
        const remotes = await gitListRemoteBranches(root);
        const name = await ask({
          kind: "pick",
          title: "Delete Remote Branch...",
          empty: "No remote branches",
          options: remotes.map((branch) => ({ id: branch, label: branch })),
        });
        if (!name) return;
        const yes = await ask({
          kind: "confirm",
          title: "Delete Remote Branch",
          message: `Delete remote branch '${name}'?`,
          confirm: "Delete",
          danger: true,
        });
        if (!yes) return;
        await attempt("Deleting remote branch…", () =>
          gitDeleteRemoteBranch(root, name),
        );
        return;
      }
      const [locals, remotes] = await Promise.all([
        gitListBranches(root),
        gitListRemoteBranches(root),
      ]);
      const picked = await ask({
        kind: "pick",
        title: id === "merge" ? "Merge..." : "Rebase Branch...",
        empty: "No branches",
        options: [
          ...locals
            .filter((branch) => branch !== status?.branch)
            .map((branch) => ({ id: branch, label: branch, detail: "local" })),
          ...remotes.map((branch) => ({
            id: branch,
            label: branch,
            detail: "remote",
          })),
        ],
      });
      if (!picked) return;
      await attempt(id === "merge" ? "Merging…" : "Rebasing…", () =>
        id === "merge" ? gitMerge(root, picked) : gitRebase(root, picked),
      );
      return;
    }
    case "createBranch":
    case "renameBranch": {
      const name = await ask({
        kind: "input",
        title: id === "createBranch" ? "Create Branch" : "Rename Branch",
        placeholder: "feat/new-branch",
        initial: id === "renameBranch" ? status?.branch : "",
        confirm: id === "createBranch" ? "Create" : "Rename",
      });
      if (!name) return;
      const valid = validateBranchName(name);
      if (!valid.ok) {
        setUiError(valid.error ?? "Invalid branch name");
        return;
      }
      const next = valid.suggested ?? name;
      await attempt(
        id === "createBranch" ? "Creating branch…" : "Renaming branch…",
        () =>
          id === "createBranch"
            ? gitCreateBranch(root, next, { checkout: true })
            : gitRenameBranch(root, next),
      );
      return;
    }
    case "addRemote": {
      const name = await ask({
        kind: "input",
        title: "Add Remote",
        placeholder: "origin",
        confirm: "Next",
      });
      if (!name) return;
      const url = await ask({
        kind: "input",
        title: `Remote URL for '${name}'`,
        placeholder: "https://github.com/org/repo.git",
        confirm: "Add",
      });
      if (!url) return;
      await attempt("Adding remote…", () => gitAddRemote(root, name, url));
      return;
    }
    case "removeRemote": {
      const remotes = await gitListRemotes(root);
      const name = await ask({
        kind: "pick",
        title: "Remove Remote...",
        empty: "No remotes",
        options: remotes.map((remote) => ({ id: remote, label: remote })),
      });
      if (!name) return;
      const yes = await ask({
        kind: "confirm",
        title: "Remove Remote",
        message: `Remove remote '${name}'?`,
        confirm: "Remove",
        danger: true,
      });
      if (!yes) return;
      await attempt("Removing remote…", () => gitRemoveRemote(root, name));
      return;
    }
    case "stash":
      await attempt("Stashing…", () => gitStash(root));
      return;
    case "stashUntracked":
      await attempt("Stashing…", () =>
        gitStash(root, undefined, { includeUntracked: true }),
      );
      return;
    case "stashApplyLatest":
      await attempt("Applying stash…", () => gitStashApply(root, "stash@{0}"));
      return;
    case "stashPopLatest":
      await attempt("Popping stash…", () => gitStashPop(root));
      return;
    case "stashApply":
    case "stashPop":
    case "stashDrop": {
      const stashes = await gitListStashes(root);
      if (stashes.length === 0) {
        setUiError("No stashes");
        return;
      }
      const title =
        id === "stashApply"
          ? "Apply Stash..."
          : id === "stashPop"
            ? "Pop Stash..."
            : "Drop Stash...";
      const ref = await ask({
        kind: "pick",
        title,
        options: stashes.map((stash) => ({
          id: stash.ref,
          label: stash.ref,
          detail: stash.message,
        })),
      });
      if (!ref) return;
      if (id === "stashDrop") {
        const yes = await ask({
          kind: "confirm",
          title: "Drop Stash",
          message: `Drop ${ref}?`,
          confirm: "Drop",
          danger: true,
        });
        if (!yes) return;
        await attempt("Dropping stash…", () => gitStashDrop(root, ref));
        return;
      }
      await attempt(id === "stashApply" ? "Applying stash…" : "Popping stash…", () =>
        id === "stashApply" ? gitStashApply(root, ref) : gitStashPop(root, ref),
      );
      return;
    }
    case "stashDropAll": {
      const yes = await ask({
        kind: "confirm",
        title: "Drop All Stashes",
        message: "Drop every stash? This cannot be undone.",
        confirm: "Drop All",
        danger: true,
      });
      if (!yes) return;
      await attempt("Dropping stashes…", () => gitStashClear(root));
      return;
    }
    case "createTag": {
      const name = await ask({
        kind: "input",
        title: "Create Tag",
        placeholder: "v1.0.0",
        confirm: "Create",
      });
      if (!name) return;
      await attempt("Creating tag…", () => gitCreateTag(root, name));
      return;
    }
    case "deleteTag": {
      const tags = await gitListTags(root);
      const name = await ask({
        kind: "pick",
        title: "Delete Tag...",
        empty: "No tags",
        options: tags.map((tag) => ({ id: tag, label: tag })),
      });
      if (!name) return;
      const yes = await ask({
        kind: "confirm",
        title: "Delete Tag",
        message: `Delete tag '${name}'?`,
        confirm: "Delete",
        danger: true,
      });
      if (!yes) return;
      await attempt("Deleting tag…", () => gitDeleteTag(root, name));
      return;
    }
    case "createWorktree": {
      const name = await ask({
        kind: "input",
        title: "Create Worktree",
        placeholder: "branch name",
        confirm: "Create",
      });
      if (!name) return;
      const valid = validateBranchName(name);
      if (!valid.ok) {
        setUiError(valid.error ?? "Invalid branch name");
        return;
      }
      const branch = valid.suggested ?? name;
      const locals = await gitListBranches(root);
      const path = worktreeDestination(root, branch);
      await attempt("Creating worktree…", () =>
        gitWorktreeAdd(root, path, branch, !locals.includes(branch)),
      );
      return;
    }
    case "deleteWorktree": {
      const trees = (await gitListWorktrees(root)).filter(
        (tree) => tree.path.replace(/\/$/, "") !== root.replace(/\/$/, ""),
      );
      const path = await ask({
        kind: "pick",
        title: "Delete Worktree...",
        empty: "No linked worktrees",
        options: trees.map((tree) => ({
          id: tree.path,
          label: tree.branch || tree.path,
          detail: tree.path,
        })),
      });
      if (!path) return;
      const yes = await ask({
        kind: "confirm",
        title: "Delete Worktree",
        message: `Remove the worktree at ${path}?`,
        confirm: "Delete",
        danger: true,
      });
      if (!yes) return;
      await attempt("Removing worktree…", () => gitWorktreeRemove(root, path));
      return;
    }
    default:
      return;
  }
}
