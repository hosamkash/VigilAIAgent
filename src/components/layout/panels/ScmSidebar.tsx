import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { File, GitCompare, Minus, MoreHorizontal, Plus, RefreshCw, Sparkles, Undo2 } from "lucide-react";
import { useExplorerStore } from "../../../store/explorerStore";
import { useLayoutStore } from "../../../store/layoutStore";
import { useEditorTabsStore } from "../../../store/editorTabsStore";
import { useCostStore } from "../../../store/costStore";
import { useTerminalStore } from "../../../store/terminalStore";
import { readTextFile, writeTextFile } from "../../../lib/workspace-fs";
import {
  assertGitOk,
  fetchGitStatus,
  gitCheckout,
  gitCheckoutCommit,
  gitCherryPick,
  gitCleanFile,
  gitCommit,
  gitCreateBranch,
  gitDiscard,
  gitInit,
  gitListBranches,
  gitLogGraphRaw,
  gitLogRange,
  gitReadConflictSides,
  gitShowSpec,
  gitShowCommit,
  gitStage,
  gitStageAll,
  gitStagedDiff,
  gitStash,
  gitUnstage,
  gitUnstageAll,
  validateBranchName,
  type GitChange,
  type GitStatus,
} from "../../../lib/git";
import { buildBranchMenu, buildScmMenu } from "../../../lib/scm-menu";
import type { GitLogLine } from "../../../lib/git-hunks";
import {
  buildChangeTree,
  sortChanges,
  type ChangeSort,
  type ChangeTreeNode,
  type ChangeView,
} from "../../../lib/scm-view";
import { parseGitGraphLog, type GitGraphNode } from "../../../lib/git-graph";
import {
  generateCommitMessage,
  reviewDiffWithAi,
  resolveConflictWithAi,
  suggestBranchName,
} from "../../../lib/git-ai";
import { GitGraphView } from "./GitGraphView";
import { ScmOverflowMenu, ScmPromptDialog, type ScmPromptRequest } from "./ScmMenu";
import { runScmCommand } from "./scm-commands";
import { useSpeechDictation } from "../../../lib/hooks/useSpeechDictation";
import { useNativeLiveDictation } from "../../../lib/hooks/useNativeLiveDictation";
import { SpeechDictationMicButton } from "../../SpeechDictationMicButton";

type ScmTab = "changes" | "graph" | "branches";

function IconButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={`rounded p-0.5 hover:bg-[var(--vigil-hover)] ${
        danger ? "text-[var(--vigil-danger)]" : ""
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ChangeRow({
  change,
  root,
  onRefresh,
  checked,
  onToggle,
  label,
}: {
  change: GitChange;
  root: string;
  onRefresh: () => void;
  checked: boolean;
  onToggle: () => void;
  label?: string;
}) {
  const openFile = useEditorTabsStore((s) => s.openFile);
  const showGitDiff = useEditorTabsStore((s) => s.showGitDiff);
  const abs = `${root.replace(/\/$/, "")}/${change.path}`;

  async function openWorkingFile() {
    try {
      const content = await readTextFile(abs);
      openFile({ path: abs, content });
    } catch {
      /* deleted or unreadable */
    }
  }

  async function openDiff() {
    const head =
      change.status === "?"
        ? ""
        : await gitShowSpec(root, `HEAD:${change.path}`);
    let modified = "";
    if (change.status === "D" && !change.staged) {
      modified = "";
    } else if (change.staged) {
      modified = await gitShowSpec(root, `:${change.path}`);
    } else {
      modified = await readTextFile(abs).catch(() => "");
    }
    showGitDiff(abs, head, modified, {
      repoRoot: root,
      relPath: change.path,
      staged: change.staged,
      conflicted: change.status === "U",
    });
  }

  return (
    <div className="group flex items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-[var(--vigil-hover)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="shrink-0"
        title={change.staged ? "Unstage" : "Stage"}
      />
      <span
        className="w-4 shrink-0 font-mono text-[10px] text-[var(--vigil-accent)]"
        title={change.raw}
      >
        {change.status}
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left"
        onClick={() => void openDiff()}
        title={change.path}
      >
        {label ?? change.path}
      </button>
      <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <IconButton title="Open file" onClick={() => void openWorkingFile()}>
          <File className="h-3 w-3" />
        </IconButton>
        <IconButton title="Open changes" onClick={() => void openDiff()}>
          <GitCompare className="h-3 w-3" />
        </IconButton>
        {!change.staged ? (
          <IconButton
            title="Stage"
            onClick={() => void gitStage(root, change.path).then(onRefresh)}
          >
            <Plus className="h-3 w-3" />
          </IconButton>
        ) : (
          <IconButton
            title="Unstage"
            onClick={() => void gitUnstage(root, change.path).then(onRefresh)}
          >
            <Minus className="h-3 w-3" />
          </IconButton>
        )}
        <IconButton
          title={change.status === "?" ? "Delete untracked file" : "Discard"}
          danger
          onClick={() => {
            if (change.status === "?") {
              if (window.confirm(`Delete untracked file ${change.path}?`)) {
                void gitCleanFile(root, change.path).then(onRefresh);
              }
              return;
            }
            if (window.confirm(`Discard changes to ${change.path}?`)) {
              void gitDiscard(root, change.path).then(onRefresh);
            }
          }}
        >
          <Undo2 className="h-3 w-3" />
        </IconButton>
      </div>
    </div>
  );
}

export function ScmSidebar() {
  const root = useExplorerStore((s) => s.root);
  const showAgentDiff = useEditorTabsStore((s) => s.showAgentDiff);
  const showGitDiff = useEditorTabsStore((s) => s.showGitDiff);
  const recordEstimate = useCostStore((s) => s.recordEstimate);

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [uiError, setUiError] = useState<string | null>(null);
  const messageRef = useRef(message);
  messageRef.current = message;
  const inTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const nativeDictation = useNativeLiveDictation({
    getBaseText: () => messageRef.current,
    onText: setMessage,
    onError: (msg) => setUiError(msg),
  });
  const webDictation = useSpeechDictation({
    getBaseText: () => messageRef.current,
    onText: setMessage,
    mode: "append",
    stopOnSilence: false,
  });
  const listening = inTauri
    ? nativeDictation.listening
    : webDictation.listening;

  function toggleDictation() {
    setUiError(null);
    if (inTauri) nativeDictation.toggle();
    else webDictation.toggle();
  }
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [tab, setTab] = useState<ScmTab>("changes");
  const [autoStage, setAutoStage] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const [branchDesc, setBranchDesc] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [graphRaw, setGraphRaw] = useState("");
  const [incoming, setIncoming] = useState<GitLogLine[]>([]);
  const [outgoing, setOutgoing] = useState<GitLogLine[]>([]);
  const [stashMsg, setStashMsg] = useState("");
  const [viewMode, setViewMode] = useState<ChangeView>("list");
  const [sortBy, setSortBy] = useState<ChangeSort>("path");
  const [menu, setMenu] = useState<{
    kind: "more" | "branch";
    top: number;
    left: number;
  } | null>(null);
  const [prompt, setPrompt] = useState<ScmPromptRequest | null>(null);
  const promptResolve = useRef<((value: string | null) => void) | null>(null);

  const noCommits = !!(status && !status.hasCommits);

  const refresh = useCallback(async () => {
    if (!root) return;
    setBusy(true);
    try {
      const st = await fetchGitStatus(root);
      setStatus(st);
      setUiError(null);
      if (st.hasCommits) {
        const [br, gr, inn, out] = await Promise.all([
          gitListBranches(root),
          gitLogGraphRaw(root),
          st.upstream
            ? gitLogRange(root, `HEAD..${st.upstream}`)
            : Promise.resolve([]),
          st.upstream
            ? gitLogRange(root, `${st.upstream}..HEAD`)
            : Promise.resolve([]),
        ]);
        setBranches(br);
        setGraphRaw(gr);
        setIncoming(inn);
        setOutgoing(out);
      } else {
        setBranches([]);
        setGraphRaw("");
        setIncoming([]);
        setOutgoing([]);
      }
    } catch (err) {
      setLog(String(err));
    } finally {
      setBusy(false);
    }
  }, [root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onGit = () => void refresh();
    window.addEventListener("vigil:git-changed", onGit);
    return () => window.removeEventListener("vigil:git-changed", onGit);
  }, [refresh]);

  useEffect(() => {
    if (!branchName) {
      setBranchError(null);
      return;
    }
    const v = validateBranchName(branchName);
    setBranchError(v.ok ? null : v.error ?? "Invalid name");
  }, [branchName]);

  function ask(request: ScmPromptRequest) {
    return new Promise<string | null>((resolve) => {
      promptResolve.current = resolve;
      setPrompt(request);
    });
  }

  function closePrompt(value: string | null) {
    setPrompt(null);
    const resolve = promptResolve.current;
    promptResolve.current = null;
    resolve?.(value);
  }

  function openMenu(kind: "more" | "branch", el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const width = 232;
    const left =
      kind === "more"
        ? Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
        : Math.max(8, rect.left);
    setMenu({ kind, top: rect.bottom + 4, left });
  }

  async function withProgress(label: string, fn: () => Promise<string>) {
    setProgress(label);
    setUiError(null);
    const appendOutput = useTerminalStore.getState().appendOutput;
    appendOutput(`\n$ ${label}\n`);
    try {
      const out = assertGitOk(await fn());
      appendOutput(`${out || "ok"}\n`);
      setLog(out);
      await refresh();
      return { ok: true as const, error: undefined };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendOutput(`${msg}\n`);
      setUiError(msg);
      useLayoutStore.getState().setBottomTab("output");
      return { ok: false as const, error: msg };
    } finally {
      setProgress(null);
    }
  }

  function runCommand(id: string) {
    if (!root) return;
    void runScmCommand(id, {
      root,
      status,
      message,
      busy: !!progress,
      setMessage,
      setUiError,
      setViewMode,
      setSortBy,
      ask,
      attempt: withProgress,
    });
  }

  async function handleCommit() {
    if (!root || !message.trim()) {
      setUiError("Enter a commit message");
      return;
    }
    const result = await withProgress("Committing…", async () => {
      if (autoStage || noCommits) assertGitOk(await gitStageAll(root));
      return gitCommit(root, message.trim());
    });
    if (result.ok) setMessage("");
  }

  async function handleGenerateCommit() {
    if (!root) return;
    setAiBusy(true);
    setUiError(null);
    try {
      if (!status?.hasCommits && !(status?.staged.length)) {
        await gitStageAll(root);
        await refresh();
      }
      const diff = await gitStagedDiff(root);
      const { message: msg, model } = await generateCommitMessage(diff);
      setMessage(msg);
      void recordEstimate(diff.slice(0, 2000), msg, "gemini", model);
    } catch (err) {
      if (!status?.hasCommits) {
        setMessage("Initial commit: Project setup");
      } else {
        setUiError(String(err));
      }
    } finally {
      setAiBusy(false);
    }
  }

  async function handleCreateBranch() {
    if (!root) return;
    const v = validateBranchName(branchName);
    if (!v.ok) {
      setBranchError(v.error ?? "Invalid");
      setUiError(v.error ?? "Invalid branch name");
      if (v.suggested) setBranchName(v.suggested);
      return;
    }
    if (!status?.hasCommits) {
      setUiError(
        "No commits yet — create an initial commit first before creating a branch",
      );
      setTab("changes");
      return;
    }
    setProgress("Creating branch…");
    setUiError(null);
    try {
      const out = await gitCreateBranch(root, v.suggested ?? branchName, {
        checkout: true,
      });
      setLog(out);
      setBranchName("");
      setBranchDesc("");
      await refresh();
    } catch (err) {
      setUiError(String(err));
    } finally {
      setProgress(null);
    }
  }

  async function handleSuggestBranch() {
    setAiBusy(true);
    try {
      const { name, model } = await suggestBranchName(branchDesc || branchName);
      setBranchName(name);
      void recordEstimate(branchDesc, name, "gemini", model);
    } catch (err) {
      setUiError(String(err));
    } finally {
      setAiBusy(false);
    }
  }

  async function handleFindIssues() {
    if (!root) return;
    setAiBusy(true);
    setReview(null);
    try {
      const diff = await gitStagedDiff(root);
      const { review: text, model } = await reviewDiffWithAi(diff);
      setReview(text);
      void recordEstimate(diff.slice(0, 2000), text, "gemini", model);
    } catch (err) {
      setUiError(String(err));
    } finally {
      setAiBusy(false);
    }
  }

  async function handleResolveConflict(path: string) {
    if (!root) return;
    setAiBusy(true);
    try {
      const sides = await gitReadConflictSides(root, path);
      const { merged, model } = await resolveConflictWithAi({
        path,
        ...sides,
      });
      const abs = `${root.replace(/\/$/, "")}/${path}`;
      await writeTextFile(abs, merged);
      showAgentDiff(abs, sides.ours, merged);
      void recordEstimate(sides.ours.slice(0, 500), merged.slice(0, 500), "gemini", model);
      setLog(`AI resolved ${path} — review diff, then stage`);
    } catch (err) {
      setUiError(String(err));
    } finally {
      setAiBusy(false);
    }
  }

  async function onSelectCommit(node: GitGraphNode) {
    if (!root) return;
    try {
      const patch = await gitShowCommit(root, node.hash);
      showAgentDiff(
        `commit:${node.shortHash}`,
        "",
        patch.slice(0, 200_000),
      );
    } catch (err) {
      setUiError(String(err));
    }
  }

  async function openConflict(path: string) {
    if (!root) return;
    const abs = `${root.replace(/\/$/, "")}/${path}`;
    const sides = await gitReadConflictSides(root, path);
    const working = await readTextFile(abs).catch(() => "");
    showGitDiff(abs, sides.ours, working || sides.theirs, {
      repoRoot: root,
      relPath: path,
      staged: false,
      conflicted: true,
    });
  }

  async function checkoutGraphCommit(node: GitGraphNode) {
    if (!root) return;
    const yes = await ask({
      kind: "confirm",
      title: "Checkout commit",
      message: `Detach HEAD at ${node.shortHash}?`,
      confirm: "Checkout",
    });
    if (!yes) return;
    await withProgress("Checking out…", () => gitCheckoutCommit(root, node.hash));
  }

  async function branchFromCommit(node: GitGraphNode) {
    if (!root) return;
    const name = await ask({
      kind: "input",
      title: "Create branch from commit",
      placeholder: "feat/from-commit",
      confirm: "Create",
    });
    if (!name) return;
    const valid = validateBranchName(name);
    if (!valid.ok) {
      setUiError(valid.error ?? "Invalid branch name");
      return;
    }
    await withProgress("Creating branch…", () =>
      gitCreateBranch(root, valid.suggested ?? name, {
        checkout: true,
        startPoint: node.hash,
      }),
    );
  }

  async function cherryPickCommit(node: GitGraphNode) {
    if (!root) return;
    const yes = await ask({
      kind: "confirm",
      title: "Cherry-pick",
      message: `Cherry-pick ${node.shortHash} onto ${status?.branch || "HEAD"}?`,
      confirm: "Cherry-pick",
    });
    if (!yes) return;
    await withProgress("Cherry-picking…", () => gitCherryPick(root, node.hash));
  }

  const menuItems =
    menu?.kind === "branch"
      ? buildBranchMenu({
          branches,
          current: status?.branch ?? "",
          locked: !!noCommits || !!progress,
        })
      : buildScmMenu({
          repo: !!status?.isRepo,
          hasCommits: !!status?.hasCommits,
          busy: !!progress,
          viewMode,
          sortBy,
        });

  const overlays = (
    <>
      {menu && (
        <ScmOverflowMenu
          items={menuItems}
          top={menu.top}
          left={menu.left}
          onClose={() => setMenu(null)}
          onSelect={runCommand}
        />
      )}
      {prompt && (
        <ScmPromptDialog
          request={prompt}
          onCancel={() => closePrompt(null)}
          onConfirm={(value) => closePrompt(value)}
        />
      )}
    </>
  );

  if (!root) {
    return (
      <div className="p-3 text-xs text-[var(--vigil-muted)]">
        <p className="mb-2">No project is open.</p>
        <button
          type="button"
          className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-white"
          onClick={() => useExplorerStore.getState().openLauncher()}
        >
          Choose a project or Git host
        </button>
      </div>
    );
  }

  if (status && !status.isRepo) {
    return (
      <div className="flex h-full flex-col p-3">
        <ScmToolbar
          busy={busy}
          onRefresh={() => void refresh()}
          onMore={(el) => openMenu("more", el)}
        />
        <p className="mb-3 text-xs text-[var(--vigil-muted)]">
          This folder is not a Git repository.
        </p>
        <button
          type="button"
          className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-xs text-white"
          onClick={() => void gitInit(root).then(refresh)}
        >
          Initialize Repository
        </button>
        {overlays}
      </div>
    );
  }

  const canCommit =
    !!message.trim() &&
    (!!status?.staged.length || autoStage || !!noCommits);
  const graph = graphRaw ? parseGitGraphLog(graphRaw) : null;

  return (
    <div className="flex h-full flex-col p-2">
      <ScmToolbar
        busy={busy}
        onRefresh={() => void refresh()}
        onMore={(el) => openMenu("more", el)}
      />

      {noCommits && (
        <div className="mb-2 rounded border border-[var(--vigil-accent)] bg-[var(--vigil-accent-soft)] px-2 py-1.5 text-[11px] text-[var(--vigil-text)]">
          <div className="font-semibold">No commits yet</div>
          <div className="text-[var(--vigil-muted)]">
            Create an initial commit first — branch creation from HEAD is disabled.
          </div>
        </div>
      )}

      {uiError && (
        <div className="mb-2 rounded border border-[var(--vigil-danger)]/40 bg-[var(--vigil-danger)]/10 px-2 py-1.5 text-[11px] text-[var(--vigil-danger)]">
          {uiError}
        </div>
      )}

      {progress && (
        <div className="mb-1 text-[10px] text-[var(--vigil-accent)]">
          {progress}
        </div>
      )}

      <div className="mb-2 flex items-center gap-1 text-[11px]">
        <button
          type="button"
          disabled={!!noCommits || !!progress}
          title="Checkout branch"
          className={`flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono disabled:opacity-60 ${
            noCommits
              ? "bg-[var(--vigil-danger)]/15 text-[var(--vigil-danger)]"
              : "bg-[var(--vigil-hover)] hover:bg-[var(--vigil-accent)] hover:text-white"
          }`}
          onClick={(event) => openMenu("branch", event.currentTarget)}
        >
          <span className="truncate">
            {status?.branch || "…"}
            {noCommits ? " · unborn" : ""}
          </span>
          <span className="text-[9px] opacity-70">▾</span>
        </button>
        <button
          type="button"
          disabled={!!noCommits || !!progress}
          title="Sync: pull then push"
          className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] disabled:opacity-40"
          onClick={() => runCommand("sync")}
        >
          {(status?.behind ?? 0) > 0 || (status?.ahead ?? 0) > 0
            ? `↓${status?.behind ?? 0} ↑${status?.ahead ?? 0}`
            : "Sync"}
        </button>
        {status?.hasCommits && !status.upstream && (
          <button
            type="button"
            disabled={!!progress}
            title="Publish this branch to a remote"
            className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] disabled:opacity-40"
            onClick={() => runCommand("publishBranch")}
          >
            Publish
          </button>
        )}
        {status?.upstream && (
          <span className="min-w-0 truncate font-mono text-[10px] text-[var(--vigil-muted)]" title="Upstream">
            {status.upstream}
          </span>
        )}
      </div>
      {status?.upstream && (
        <details className="mb-2 text-[10px]">
          <summary className="cursor-pointer text-[var(--vigil-muted)]">
            Incoming {incoming.length} · Outgoing {outgoing.length}
          </summary>
          <CommitList title="Incoming" lines={incoming} />
          <CommitList title="Outgoing" lines={outgoing} />
        </details>
      )}

      <div className="mb-2 flex gap-1 border-b border-[var(--vigil-border)] pb-1 text-[10px]">
        {(
          [
            ["changes", "Changes"],
            ["graph", "Graph"],
            ["branches", "Branches"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded px-2 py-0.5 ${
              tab === id
                ? "bg-[var(--vigil-accent)] text-white"
                : "hover:bg-[var(--vigil-hover)]"
            }`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "changes" && (
        <>
          <div className="mb-1 flex gap-1">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void handleCommit();
                }
              }}
              placeholder={
                noCommits
                  ? "Initial commit: Project setup"
                  : "Commit message"
              }
              title="⌘Enter or Ctrl+Enter to commit"
              rows={2}
              className="min-w-0 flex-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-xs"
            />
            <div className="flex shrink-0 flex-col justify-between">
              <button
                type="button"
                disabled={aiBusy}
                title="Generate conventional commit with Gemini Flash"
                aria-label="Generate conventional commit with Gemini Flash"
                className="flex h-7 w-7 items-center justify-center rounded border border-[var(--vigil-border)] hover:bg-[var(--vigil-hover)] disabled:opacity-40"
                onClick={() => void handleGenerateCommit()}
              >
                {aiBusy ? (
                  "…"
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
              </button>
              <SpeechDictationMicButton
                size="sm"
                active={listening}
                disabled={aiBusy}
                onClick={toggleDictation}
                title={
                  listening
                    ? "Stop voice to text"
                    : "Voice to text — commit message"
                }
              />
            </div>
          </div>

          <label className="mb-1 flex items-center gap-1.5 text-[10px] text-[var(--vigil-muted)]">
            <input
              type="checkbox"
              checked={autoStage}
              onChange={(e) => setAutoStage(e.target.checked)}
            />
            Auto-stage all before commit
          </label>

          <div className="mb-2 flex gap-1">
            <button
              type="button"
              disabled={!canCommit || !!progress}
              className="flex-1 rounded bg-[var(--vigil-accent)] px-2 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              onClick={() => void handleCommit()}
            >
              {noCommits ? "Initial Commit" : "Commit"}
            </button>
            <button
              type="button"
              disabled={aiBusy || !(status?.staged.length || status?.changes.length)}
              className="rounded border border-[var(--vigil-border)] px-2 py-1 text-[10px] disabled:opacity-40"
              title="AI review of staged/unstaged diff"
              onClick={() => void handleFindIssues()}
            >
              Find Issues
            </button>
          </div>

          {review && (
            <pre className="mb-2 max-h-28 overflow-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-1.5 font-mono text-[10px] whitespace-pre-wrap">
              {review}
            </pre>
          )}

          {(status?.conflicted.length ?? 0) > 0 && (
            <Section title="Conflicts" count={status?.conflicted.length ?? 0}>
              {status?.conflicted.map((c) => (
                <div
                  key={`cf-${c.path}`}
                  className="mb-1 rounded border border-[var(--vigil-danger)]/30 px-1 py-1"
                >
                  <div className="truncate text-[11px]">{c.path}</div>
                  <button
                    type="button"
                    className="mt-0.5 mr-2 text-[10px] text-[var(--vigil-accent)]"
                    onClick={() => void openConflict(c.path)}
                  >
                    Open diff
                  </button>
                  <button
                    type="button"
                    disabled={aiBusy}
                    className="mt-0.5 text-[10px] text-[var(--vigil-accent)]"
                    onClick={() => void handleResolveConflict(c.path)}
                  >
                    Resolve with AI (ours / theirs → merged)
                  </button>
                </div>
              ))}
            </Section>
          )}

          <div className="mb-1 flex gap-1 text-[10px]">
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5"
              onClick={() => void gitStageAll(root).then(refresh)}
            >
              Stage all
            </button>
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5"
              onClick={() => void gitUnstageAll(root).then(refresh)}
            >
              Unstage all
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-auto">
            <Section title="Staged" count={status?.staged.length ?? 0}>
              <ChangeNodes
                changes={status?.staged ?? []}
                viewMode={viewMode}
                sortBy={sortBy}
                staged
                root={root}
                onRefresh={() => void refresh()}
              />
            </Section>
            <Section title="Changes" count={status?.changes.length ?? 0}>
              <ChangeNodes
                changes={status?.changes ?? []}
                viewMode={viewMode}
                sortBy={sortBy}
                staged={false}
                root={root}
                onRefresh={() => void refresh()}
              />
            </Section>
            <Section title="Untracked" count={status?.untracked.length ?? 0}>
              <ChangeNodes
                changes={status?.untracked ?? []}
                viewMode={viewMode}
                sortBy={sortBy}
                staged={false}
                root={root}
                onRefresh={() => void refresh()}
              />
            </Section>
          </div>

          <div className="mt-2 flex gap-1 border-t border-[var(--vigil-border)] pt-2">
            <input
              value={stashMsg}
              onChange={(e) => setStashMsg(e.target.value)}
              placeholder="Stash message"
              className="min-w-0 flex-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-0.5 text-[10px]"
            />
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] px-2 py-0.5 text-[10px]"
              onClick={() =>
                void withProgress("Stashing…", () =>
                  gitStash(root, stashMsg || undefined),
                ).then(() => setStashMsg(""))
              }
            >
              Stash
            </button>
          </div>
        </>
      )}

      {tab === "graph" && (
        <GitGraphView
          graph={graph}
          currentBranch={status?.branch ?? ""}
          onSelectCommit={(n) => void onSelectCommit(n)}
          onCheckout={(n) => void checkoutGraphCommit(n)}
          onCreateBranch={(n) => void branchFromCommit(n)}
          onCherryPick={(n) => void cherryPickCommit(n)}
        />
      )}

      {tab === "branches" && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
          {noCommits ? (
            <div className="rounded border border-[var(--vigil-border)] px-2 py-2 text-[11px] text-[var(--vigil-muted)]">
              Branch creation is disabled until the first commit exists. Switch
              to <strong>Changes</strong> and use{" "}
              <strong>Initial Commit</strong>.
            </div>
          ) : (
            <>
              <label className="text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
                New branch
              </label>
              <input
                value={branchDesc}
                onChange={(e) => setBranchDesc(e.target.value)}
                placeholder='Describe work… e.g. "add login page"'
                className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-[11px]"
              />
              <div className="flex gap-1">
                <input
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="feat/add-login-page"
                  className="min-w-0 flex-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 font-mono text-[11px]"
                />
                <button
                  type="button"
                  disabled={aiBusy || !branchDesc.trim()}
                  className="rounded border border-[var(--vigil-border)] px-1.5 text-[10px] disabled:opacity-40"
                  onClick={() => void handleSuggestBranch()}
                >
                  AI name
                </button>
              </div>
              {branchError && (
                <div className="text-[10px] text-[var(--vigil-danger)]">
                  {branchError}
                </div>
              )}
              <button
                type="button"
                disabled={!!branchError || !branchName.trim() || !!progress}
                className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-xs text-white disabled:opacity-40"
                onClick={() => void handleCreateBranch()}
              >
                Create Branch
              </button>
            </>
          )}

          <div className="mt-2 text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
            Local branches
          </div>
          {branches.length === 0 ? (
            <div className="text-[10px] text-[var(--vigil-muted)]">None yet</div>
          ) : (
            branches.map((b) => (
              <button
                key={b}
                type="button"
                disabled={b === status?.branch || !!progress}
                className={`w-full rounded px-1.5 py-0.5 text-left font-mono text-[11px] disabled:opacity-100 ${
                  b === status?.branch
                    ? "bg-[var(--vigil-accent-soft)] text-[var(--vigil-accent)]"
                    : "hover:bg-[var(--vigil-hover)]"
                }`}
                onClick={() =>
                  void withProgress("Checking out…", () => gitCheckout(root, b))
                }
              >
                {b === status?.branch ? `● ${b}` : b}
              </button>
            ))
          )}
        </div>
      )}

      {log && (
        <pre className="mt-2 max-h-20 overflow-auto border-t border-[var(--vigil-border)] pt-1 font-mono text-[10px] text-[var(--vigil-muted)]">
          {log}
        </pre>
      )}
      {overlays}
    </div>
  );
}

function ScmToolbar({
  busy,
  onRefresh,
  onMore,
}: {
  busy: boolean;
  onRefresh: () => void;
  onMore: (el: HTMLElement) => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
      <span className="min-w-0 flex-1 truncate">Source Control</span>
      <button
        type="button"
        title="Refresh"
        className="rounded p-0.5 normal-case hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
        onClick={onRefresh}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      </button>
      <button
        type="button"
        title="Views and More Actions"
        aria-label="Views and More Actions"
        className="rounded p-0.5 normal-case hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
        onClick={(event) => onMore(event.currentTarget)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </div>
  );
}

function ChangeNodes({
  changes,
  viewMode,
  sortBy,
  staged,
  root,
  onRefresh,
}: {
  changes: GitChange[];
  viewMode: ChangeView;
  sortBy: ChangeSort;
  staged: boolean;
  root: string;
  onRefresh: () => void;
}) {
  const sorted = sortChanges(changes, sortBy);
  if (viewMode === "tree") {
    return (
      <ChangeTree
        nodes={buildChangeTree(sorted, sortBy)}
        root={root}
        staged={staged}
        onRefresh={onRefresh}
      />
    );
  }
  return (
    <>
      {sorted.map((change) => (
        <ChangeRow
          key={change.path}
          change={change}
          root={root}
          checked={staged}
          onToggle={() =>
            void (staged ? gitUnstage(root, change.path) : gitStage(root, change.path)).then(
              onRefresh,
            )
          }
          onRefresh={onRefresh}
        />
      ))}
    </>
  );
}

function ChangeTree({
  nodes,
  root,
  staged,
  onRefresh,
  depth = 0,
}: {
  nodes: ChangeTreeNode[];
  root: string;
  staged: boolean;
  onRefresh: () => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.type === "dir" ? (
          <ChangeDir
            key={node.path}
            node={node}
            root={root}
            staged={staged}
            depth={depth}
            onRefresh={onRefresh}
          />
        ) : (
          <div key={node.change.path} style={{ paddingLeft: depth * 10 }}>
            <ChangeRow
              change={node.change}
              root={root}
              label={node.change.path.split("/").pop()}
              checked={staged}
              onToggle={() =>
                void (staged
                  ? gitUnstage(root, node.change.path)
                  : gitStage(root, node.change.path)
                ).then(onRefresh)
              }
              onRefresh={onRefresh}
            />
          </div>
        ),
      )}
    </>
  );
}

function ChangeDir({
  node,
  root,
  staged,
  depth,
  onRefresh,
}: {
  node: Extract<ChangeTreeNode, { type: "dir" }>;
  root: string;
  staged: boolean;
  depth: number;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 truncate py-0.5 text-left text-[11px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
        style={{ paddingLeft: depth * 10 }}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="w-3 text-[9px]">{open ? "▾" : "▸"}</span>
        {node.name}
      </button>
      {open && (
        <ChangeTree
          nodes={node.children}
          root={root}
          staged={staged}
          depth={depth + 1}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}

function CommitList({ title, lines }: { title: string; lines: GitLogLine[] }) {
  if (lines.length === 0) {
    return (
      <div className="px-1 py-0.5 text-[var(--vigil-muted)]">{title}: none</div>
    );
  }
  return (
    <div className="mt-1">
      <div className="px-1 font-semibold uppercase text-[var(--vigil-muted)]">{title}</div>
      {lines.map((line) => (
        <div key={`${title}-${line.hash}`} className="truncate px-1 font-mono">
          <span className="text-[var(--vigil-accent)]">{line.hash.slice(0, 7)}</span>{" "}
          {line.message}
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded py-0.5 text-left text-[10px] font-semibold uppercase text-[var(--vigil-muted)] hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="w-3 shrink-0 text-[9px]">{open ? "▾" : "▸"}</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 font-normal tabular-nums">{count}</span>
      </button>
      {open && (
        <div className="pl-3">
          {count === 0 ? (
            <div className="px-1 py-0.5 text-[10px] text-[var(--vigil-muted)]">
              None
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}
