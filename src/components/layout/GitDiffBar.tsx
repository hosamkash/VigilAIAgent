import { useCallback, useEffect, useState } from "react";
import { useLayoutStore } from "../../store/layoutStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useEditorTabsStore, type GitDiffMeta } from "../../store/editorTabsStore";
import { readTextFile, writeTextFile } from "../../lib/workspace-fs";
import {
  gitApplyPatch,
  gitDiffUnified,
  gitReadConflictSides,
  gitShowSpec,
  gitStage,
} from "../../lib/git";
import { splitUnifiedHunks, type GitHunk } from "../../lib/git-hunks";
import { resolveConflictWithAi, reviewDiffWithAi } from "../../lib/git-ai";

function note(text: string) {
  useTerminalStore.getState().appendOutput(`\n${text}\n`);
  useLayoutStore.getState().setBottomTab("output");
}

export function GitDiffBar({ meta }: { meta: GitDiffMeta }) {
  const showGitDiff = useEditorTabsStore((s) => s.showGitDiff);
  const [hunks, setHunks] = useState<GitHunk[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);

  const abs = `${meta.repoRoot.replace(/\/$/, "")}/${meta.relPath}`;

  const load = useCallback(async () => {
    if (meta.conflicted) {
      setHunks([]);
      return;
    }
    const diff = await gitDiffUnified(meta.repoRoot, meta.relPath, meta.staged);
    setHunks(splitUnifiedHunks(diff));
  }, [meta.conflicted, meta.relPath, meta.repoRoot, meta.staged]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refreshView(next: GitDiffMeta = meta) {
    const head = await gitShowSpec(next.repoRoot, `HEAD:${next.relPath}`);
    const modified = next.staged
      ? await gitShowSpec(next.repoRoot, `:${next.relPath}`)
      : await readTextFile(abs).catch(() => "");
    showGitDiff(abs, head, modified, next);
    window.dispatchEvent(new CustomEvent("vigil:git-changed"));
    if (!next.conflicted) {
      const diff = await gitDiffUnified(next.repoRoot, next.relPath, next.staged);
      setHunks(splitUnifiedHunks(diff));
    } else {
      setHunks([]);
    }
  }

  async function run(label: string, fn: () => Promise<GitDiffMeta | void>) {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      note(label);
      await refreshView(next ?? meta);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      note(msg);
    } finally {
      setBusy(false);
    }
  }

  async function reviewHunk(hunk: GitHunk) {
    setBusy(true);
    setError(null);
    try {
      const { review: text } = await reviewDiffWithAi(hunk.patch);
      setReview(text);
      note(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      note(msg);
    } finally {
      setBusy(false);
    }
  }

  async function acceptConflict(which: "ours" | "theirs" | "both") {
    await run(
      which === "both" ? "Kept both sides" : `Accepted ${which}`,
      async () => {
        const sides = await gitReadConflictSides(meta.repoRoot, meta.relPath);
        const next =
          which === "ours"
            ? sides.ours
            : which === "theirs"
              ? sides.theirs
              : `${sides.ours.replace(/\n$/, "")}\n${sides.theirs}`;
        await writeTextFile(abs, next);
        await gitStage(meta.repoRoot, meta.relPath);
        return { ...meta, conflicted: false, staged: true };
      },
    );
  }

  async function resolveWithAi() {
    await run("AI resolved the conflict", async () => {
      const sides = await gitReadConflictSides(meta.repoRoot, meta.relPath);
      const { merged } = await resolveConflictWithAi({
        path: meta.relPath,
        ...sides,
      });
      await writeTextFile(abs, merged);
      return { ...meta, conflicted: false, staged: false };
    });
  }

  return (
    <div className="max-h-36 shrink-0 overflow-auto border-b border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1">
      <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--vigil-muted)]">
        <span className="font-semibold uppercase">
          {meta.conflicted ? "Conflict" : meta.staged ? "Staged hunks" : "Hunks"}
        </span>
        <span className="truncate font-mono">{meta.relPath}</span>
      </div>
      {error && (
        <div className="mb-1 text-[10px] text-[var(--vigil-danger)]">{error}</div>
      )}
      {meta.conflicted ? (
        <div className="flex flex-wrap gap-1">
          <BarButton disabled={busy} onClick={() => void acceptConflict("ours")}>
            Accept current
          </BarButton>
          <BarButton disabled={busy} onClick={() => void acceptConflict("theirs")}>
            Accept incoming
          </BarButton>
          <BarButton disabled={busy} onClick={() => void acceptConflict("both")}>
            Accept both
          </BarButton>
          <BarButton disabled={busy} onClick={() => void resolveWithAi()}>
            Resolve with AI
          </BarButton>
        </div>
      ) : hunks.length === 0 ? (
        <div className="text-[10px] text-[var(--vigil-muted)]">
          No hunks to stage. Use the file row to stage or discard the whole file.
        </div>
      ) : (
        <div className="space-y-1">
          {hunks.map((hunk, index) => (
            <div key={`${hunk.header}-${index}`} className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px]" title={hunk.header}>
                {hunk.preview || hunk.header}
              </span>
              {meta.staged ? (
                <BarButton
                  disabled={busy}
                  onClick={() =>
                    void run("Unstaged hunk", () =>
                      gitApplyPatch(meta.repoRoot, hunk.patch, "unstage").then(() => undefined),
                    )
                  }
                >
                  Unstage
                </BarButton>
              ) : (
                <BarButton
                  disabled={busy}
                  onClick={() =>
                    void run("Staged hunk", () =>
                      gitApplyPatch(meta.repoRoot, hunk.patch, "stage").then(() => undefined),
                    )
                  }
                >
                  Stage
                </BarButton>
              )}
              {!meta.staged && (
                <BarButton
                  disabled={busy}
                  danger
                  onClick={() => {
                    if (!window.confirm("Discard this hunk?")) return;
                    void run("Discarded hunk", () =>
                      gitApplyPatch(meta.repoRoot, hunk.patch, "discard").then(() => undefined),
                    );
                  }}
                >
                  Discard
                </BarButton>
              )}
              <BarButton disabled={busy} onClick={() => void reviewHunk(hunk)}>
                AI review
              </BarButton>
            </div>
          ))}
        </div>
      )}
      {review && (
        <pre className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--vigil-text)]">
          {review}
        </pre>
      )}
    </div>
  );
}

function BarButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`shrink-0 rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] disabled:opacity-40 ${
        danger ? "text-[var(--vigil-danger)]" : ""
      }`}
    >
      {children}
    </button>
  );
}
