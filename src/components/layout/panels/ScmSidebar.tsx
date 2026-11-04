import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useExplorerStore } from "../../../store/explorerStore";
import { useEditorTabsStore } from "../../../store/editorTabsStore";
import { readTextFile, runWorkspaceCommand } from "../../../lib/workspace-fs";
import {
  fetchGitStatus,
  gitCommit,
  gitDiscard,
  gitInit,
  gitPull,
  gitPush,
  gitStage,
  gitUnstage,
  type GitChange,
  type GitStatus,
} from "../../../lib/git";

function ChangeRow({
  change,
  root,
  onRefresh,
}: {
  change: GitChange;
  root: string;
  onRefresh: () => void;
}) {
  const openFile = useEditorTabsStore((s) => s.openFile);
  const showAgentDiff = useEditorTabsStore((s) => s.showAgentDiff);

  async function openDiff() {
    const abs = `${root.replace(/\/$/, "")}/${change.path}`;
    try {
      const modified = await readTextFile(abs);
      const original = await runWorkspaceCommand(
        `git show HEAD:${JSON.stringify(change.path).slice(1, -1)} 2>/dev/null || true`,
        root,
      );
      showAgentDiff(
        abs,
        original.replace(/\n\[exit[\s\S]*$/, ""),
        modified,
      );
    } catch {
      try {
        const content = await readTextFile(abs);
        openFile({ path: abs, content });
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div className="group flex items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-[var(--vigil-hover)]">
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
        {change.path}
      </button>
      <div className="hidden shrink-0 gap-0.5 group-hover:flex">
        {!change.staged && change.status !== "?" && (
          <button
            type="button"
            className="px-1 text-[10px]"
            title="Stage"
            onClick={() => void gitStage(root, change.path).then(onRefresh)}
          >
            +
          </button>
        )}
        {change.status === "?" && (
          <button
            type="button"
            className="px-1 text-[10px]"
            title="Stage"
            onClick={() => void gitStage(root, change.path).then(onRefresh)}
          >
            +
          </button>
        )}
        {change.staged && (
          <button
            type="button"
            className="px-1 text-[10px]"
            title="Unstage"
            onClick={() => void gitUnstage(root, change.path).then(onRefresh)}
          >
            −
          </button>
        )}
        {!change.staged && change.status !== "?" && (
          <button
            type="button"
            className="px-1 text-[10px] text-[var(--vigil-danger)]"
            title="Discard"
            onClick={() => {
              if (window.confirm(`Discard changes to ${change.path}?`)) {
                void gitDiscard(root, change.path).then(onRefresh);
              }
            }}
          >
            ↺
          </button>
        )}
      </div>
    </div>
  );
}

export function ScmSidebar() {
  const root = useExplorerStore((s) => s.root);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!root) return;
    setBusy(true);
    try {
      setStatus(await fetchGitStatus(root));
      setLog(null);
    } catch (err) {
      setLog(String(err));
    } finally {
      setBusy(false);
    }
  }, [root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!root) {
    return (
      <div className="p-3 text-xs text-[var(--vigil-muted)]">No workspace</div>
    );
  }

  if (status && !status.isRepo) {
    return (
      <div className="flex h-full flex-col p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
          Source Control
        </div>
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
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
        <span>Source Control</span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="normal-case hover:text-[var(--vigil-text)]"
        >
          {busy ? "…" : "Refresh"}
        </button>
      </div>

      <div className="mb-2 flex items-center gap-1 text-[11px]">
        <span className="rounded bg-[var(--vigil-hover)] px-1.5 py-0.5 font-mono">
          {status?.branch || "…"}
        </span>
        {(status?.ahead ?? 0) > 0 && (
          <span className="text-[var(--vigil-muted)]">↑{status?.ahead}</span>
        )}
        {(status?.behind ?? 0) > 0 && (
          <span className="text-[var(--vigil-muted)]">↓{status?.behind}</span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px]"
          onClick={() =>
            void gitPull(root).then((o) => {
              setLog(o);
              void refresh();
            })
          }
        >
          Pull
        </button>
        <button
          type="button"
          className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px]"
          onClick={() =>
            void gitPush(root).then((o) => {
              setLog(o);
              void refresh();
            })
          }
        >
          Push
        </button>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Commit message"
        rows={2}
        className="mb-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1 text-xs"
      />
      <button
        type="button"
        disabled={!message.trim() || !(status?.staged.length)}
        className="mb-2 rounded bg-[var(--vigil-accent)] px-2 py-1 text-xs text-white disabled:opacity-40"
        onClick={() =>
          void gitCommit(root, message).then((o) => {
            setLog(o);
            setMessage("");
            void refresh();
          })
        }
      >
        Commit
      </button>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto">
        <Section title="Staged" count={status?.staged.length ?? 0}>
          {status?.staged.map((c) => (
            <ChangeRow
              key={`s-${c.path}`}
              change={c}
              root={root}
              onRefresh={() => void refresh()}
            />
          ))}
        </Section>
        <Section title="Changes" count={status?.changes.length ?? 0}>
          {status?.changes.map((c) => (
            <ChangeRow
              key={`c-${c.path}`}
              change={c}
              root={root}
              onRefresh={() => void refresh()}
            />
          ))}
        </Section>
        <Section title="Untracked" count={status?.untracked.length ?? 0}>
          {status?.untracked.map((c) => (
            <ChangeRow
              key={`u-${c.path}`}
              change={c}
              root={root}
              onRefresh={() => void refresh()}
            />
          ))}
        </Section>
      </div>
      {log && (
        <pre className="mt-2 max-h-20 overflow-auto border-t border-[var(--vigil-border)] pt-1 font-mono text-[10px] text-[var(--vigil-muted)]">
          {log}
        </pre>
      )}
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
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
        {title} ({count})
      </div>
      {count === 0 ? (
        <div className="px-1 text-[10px] text-[var(--vigil-muted)]">None</div>
      ) : (
        children
      )}
    </div>
  );
}
