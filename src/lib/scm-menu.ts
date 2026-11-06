import type { ChangeSort, ChangeView } from "./scm-view";

export interface ScmMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  separatorBefore?: boolean;
  children?: ScmMenuItem[];
}

export function buildScmMenu(opts: {
  repo: boolean;
  hasCommits: boolean;
  busy: boolean;
  viewMode: ChangeView;
  sortBy: ChangeSort;
}): ScmMenuItem[] {
  const history = !opts.repo || !opts.hasCommits || opts.busy;
  const repoBusy = !opts.repo || opts.busy;
  const viewLocked = opts.busy;

  return [
    {
      id: "view",
      label: "View & Sort",
      disabled: viewLocked,
      children: [
        {
          id: "viewList",
          label: "View as List",
          checked: opts.viewMode === "list",
        },
        {
          id: "viewTree",
          label: "View as Tree",
          checked: opts.viewMode === "tree",
        },
        {
          id: "sortName",
          label: "Sort by Name",
          checked: opts.sortBy === "name",
          separatorBefore: true,
        },
        {
          id: "sortPath",
          label: "Sort by Path",
          checked: opts.sortBy === "path",
        },
        {
          id: "sortStatus",
          label: "Sort by Status",
          checked: opts.sortBy === "status",
        },
      ],
    },
    { id: "pull", label: "Pull", disabled: history, separatorBefore: true },
    { id: "push", label: "Push", disabled: history },
    { id: "clone", label: "Clone", disabled: opts.busy },
    { id: "checkout", label: "Checkout to...", disabled: history },
    { id: "fetch", label: "Fetch", disabled: history },
    {
      id: "commitMenu",
      label: "Commit",
      disabled: repoBusy,
      separatorBefore: true,
      children: [
        { id: "commit", label: "Commit" },
        { id: "commitAll", label: "Commit All" },
        { id: "commitStaged", label: "Commit Staged" },
        {
          id: "commitAmend",
          label: "Commit (Amend)",
          disabled: history,
          separatorBefore: true,
        },
        { id: "commitAllAmend", label: "Commit All (Amend)", disabled: history },
        {
          id: "commitStagedAmend",
          label: "Commit Staged (Amend)",
          disabled: history,
        },
        {
          id: "undoCommit",
          label: "Undo Last Commit",
          disabled: history,
          separatorBefore: true,
        },
      ],
    },
    {
      id: "changesMenu",
      label: "Changes",
      disabled: repoBusy,
      children: [
        { id: "stageAll", label: "Stage All Changes" },
        { id: "unstageAll", label: "Unstage All Changes" },
        { id: "discardAll", label: "Discard All Changes", danger: true },
      ],
    },
    {
      id: "syncMenu",
      label: "Pull, Push",
      disabled: history,
      children: [
        { id: "sync", label: "Sync" },
        { id: "pull", label: "Pull" },
        { id: "pullRebase", label: "Pull (Rebase)" },
        { id: "push", label: "Push" },
        { id: "pushTo", label: "Push to..." },
        { id: "fetch", label: "Fetch", separatorBefore: true },
        { id: "fetchPrune", label: "Fetch (Prune)" },
      ],
    },
    {
      id: "branchMenu",
      label: "Branch",
      disabled: history,
      children: [
        { id: "merge", label: "Merge..." },
        { id: "rebase", label: "Rebase Branch..." },
        { id: "createBranch", label: "Create Branch...", separatorBefore: true },
        { id: "createBranchFrom", label: "Create Branch From..." },
        { id: "renameBranch", label: "Rename Branch..." },
        { id: "deleteBranch", label: "Delete Branch...", separatorBefore: true },
        { id: "deleteRemoteBranch", label: "Delete Remote Branch..." },
        {
          id: "publishBranch",
          label: "Publish Branch...",
          separatorBefore: true,
        },
      ],
    },
    {
      id: "remoteMenu",
      label: "Remote",
      disabled: repoBusy,
      children: [
        { id: "addRemote", label: "Add Remote..." },
        { id: "removeRemote", label: "Remove Remote..." },
      ],
    },
    {
      id: "stashMenu",
      label: "Stash",
      disabled: history,
      children: [
        { id: "stash", label: "Stash" },
        { id: "stashUntracked", label: "Stash (Include Untracked)" },
        {
          id: "stashApplyLatest",
          label: "Apply Latest Stash",
          separatorBefore: true,
        },
        { id: "stashApply", label: "Apply Stash..." },
        { id: "stashPopLatest", label: "Pop Latest Stash" },
        { id: "stashPop", label: "Pop Stash..." },
        { id: "stashDrop", label: "Drop Stash...", separatorBefore: true },
        { id: "stashDropAll", label: "Drop All Stashes", danger: true },
      ],
    },
    {
      id: "tagsMenu",
      label: "Tags",
      disabled: history,
      children: [
        { id: "createTag", label: "Create Tag..." },
        { id: "deleteTag", label: "Delete Tag..." },
      ],
    },
    {
      id: "worktreeMenu",
      label: "Worktrees",
      disabled: history,
      children: [
        { id: "createWorktree", label: "Create Worktree..." },
        { id: "deleteWorktree", label: "Delete Worktree..." },
      ],
    },
    {
      id: "showOutput",
      label: "Show Git Output",
      separatorBefore: true,
    },
  ];
}

export function buildBranchMenu(opts: {
  branches: string[];
  current: string;
  locked: boolean;
}): ScmMenuItem[] {
  const items: ScmMenuItem[] = opts.branches.map((branch, index) => ({
    id: `checkout:${branch}`,
    label: branch,
    checked: branch === opts.current,
    disabled: opts.locked || branch === opts.current,
    separatorBefore: index === 0 ? false : undefined,
  }));
  items.push(
    {
      id: "createBranch",
      label: "Create Branch...",
      disabled: opts.locked,
      separatorBefore: true,
    },
    {
      id: "createBranchFrom",
      label: "Create Branch From...",
      disabled: opts.locked,
    },
    { id: "checkout", label: "Checkout to...", disabled: opts.locked },
  );
  return items;
}
