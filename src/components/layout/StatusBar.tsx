import { useEffect, useState } from "react";
import { AlertTriangle, GitBranch, XCircle } from "lucide-react";
import { fetchGitStatus, type GitStatus } from "../../lib/git";
import { chatModelLabel } from "../../lib/model-router";
import { projectName } from "../../lib/recent-projects";
import { runCommand } from "../../lib/ide-commands";
import {
  agentStats,
  codeIndexLabel,
  isWarningProblem,
  languageLabel,
  tabStats,
} from "../../lib/status-bar";
import { runWorkspaceCommand } from "../../lib/workspace-fs";
import { useChatStore } from "../../store/chatStore";
import { useCostStore } from "../../store/costStore";
import { useEditorStatusStore } from "../../store/editorStatusStore";
import { useEditorTabsStore } from "../../store/editorTabsStore";
import { useExplorerStore } from "../../store/explorerStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useWorkspaceIndexStore } from "../../store/workspaceIndexStore";
import { useDesktopAppStore } from "../../store/desktopAppStore";
import { useSqlSessionStore } from "../../store/sqlSessionStore";
import { reindexLocalCodeIndex } from "../../lib/cline-engine";
import { notify } from "../../lib/ide-commands";

const PROVIDER_LABEL: Record<string, string> = {
  auto: "Auto",
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

function StatusButton({
  label,
  title,
  onClick,
  tone = "default",
}: {
  label: string;
  title: string;
  onClick?: () => void;
  tone?: "default" | "danger" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-[var(--vigil-danger)]"
      : tone === "warning"
        ? "vigil-status-warning"
        : "";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-[22px] shrink-0 items-center gap-1 rounded px-1.5 hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)] ${toneClass}`}
    >
      {label}
    </button>
  );
}

export function StatusBar() {
  const root = useExplorerStore((s) => s.root);
  const tabs = useEditorTabsStore((s) => s.tabs);
  const activeId = useEditorTabsStore((s) => s.activeId);
  const caret = useEditorStatusStore((s) => s.caret);
  const problems = useTerminalStore((s) => s.problems);
  const session = useCostStore((s) => s.sessionTotal);
  const provider = useChatStore((s) => s.preferredProvider);
  const running = useChatStore((s) => s.isRunning);
  const semanticIndexing = useWorkspaceIndexStore((s) => s.semanticIndexing);
  const semantic = useWorkspaceIndexStore((s) => s.semantic);
  const indexError = useWorkspaceIndexStore((s) => s.error);
  const desktopAttached = useDesktopAppStore((s) => s.attached);
  const desktopTitle = useDesktopAppStore((s) => s.title);
  const desktopPid = useDesktopAppStore((s) => s.pid);
  const desktopPath = useDesktopAppStore((s) => s.path);
  const clearDesktop = useDesktopAppStore((s) => s.clear);
  const sqlConnected = useSqlSessionStore((s) => s.connected);
  const sqlLabel = useSqlSessionStore((s) => s.label);
  const sqlEngine = useSqlSessionStore((s) => s.engine);
  const sqlDb = useSqlSessionStore((s) => s.database);
  const clearSql = useSqlSessionStore((s) => s.clear);
  const [git, setGit] = useState<{ status: GitStatus; head: string | null } | null>(
    null,
  );

  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  const fileTabs = tabs.filter((tab) => tab.mode === "file");
  const savedTabs = fileTabs.filter((tab) => !tab.dirty).length;
  const warnings = problems.filter(isWarningProblem).length;
  const errors = problems.length - warnings;

  useEffect(() => {
    if (!root) {
      setGit(null);
      return;
    }
    const cwd = root;
    let cancel = false;
    async function load() {
      try {
        const status = await fetchGitStatus(cwd);
        let head: string | null = null;
        if (status.isRepo && status.hasCommits) {
          const out = await runWorkspaceCommand("git rev-parse --short HEAD", cwd);
          const token = out.trim().split(/\s+/)[0] ?? "";
          if (/^[0-9a-f]{4,}$/i.test(token)) head = token;
        }
        if (!cancel) setGit({ status, head });
      } catch {
        if (!cancel) setGit(null);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [root]);

  const branch = git?.status.isRepo ? git.status.branch || "HEAD" : null;
  const sync =
    git && (git.status.ahead > 0 || git.status.behind > 0)
      ? `${git.status.ahead > 0 ? ` ↑${git.status.ahead}` : ""}${git.status.behind > 0 ? ` ↓${git.status.behind}` : ""}`
      : "";

  return (
    <footer
      className="flex h-[22px] shrink-0 items-center justify-between gap-2 overflow-hidden border-t border-[var(--vigil-border)] bg-[var(--vigil-activity)] px-1 text-[11px] text-[var(--vigil-muted)] select-none"
      aria-label="Status bar"
    >
      <div className="flex min-w-0 items-center overflow-hidden">
        {branch && (
          <button
            type="button"
            title="Source Control"
            className="flex h-[22px] shrink-0 items-center gap-1 rounded px-1.5 hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
            onClick={() => {
              useExplorerStore.getState().closeLauncher();
              useLayoutStore.getState().showSidebar("scm");
            }}
          >
            <GitBranch className="h-3 w-3" aria-hidden />
            <span className="max-w-[180px] truncate">
              {branch}
              {sync}
            </span>
          </button>
        )}
        {root && (
          <span className="max-w-[180px] truncate px-1.5" title={root}>
            {projectName(root)}
          </span>
        )}
        {desktopAttached && (
          <button
            type="button"
            title={
              desktopPath
                ? `Desktop EXE attached · ${desktopPath}${desktopPid ? ` · pid ${desktopPid}` : ""}\nClick to clear status chip (ask agent app_close to quit the app)`
                : `Desktop EXE attached${desktopPid ? ` · pid ${desktopPid}` : ""}`
            }
            className="flex h-[22px] max-w-[220px] shrink-0 items-center gap-1 rounded px-1.5 text-[var(--vigil-accent)] hover:bg-[var(--vigil-hover)]"
            onClick={() => {
              clearDesktop();
              notify("Desktop session chip cleared. Ask the agent to app_close if the EXE is still open.");
            }}
          >
            <span className="truncate">
              EXE: {desktopTitle?.trim() || (desktopPid ? `pid ${desktopPid}` : "attached")}
            </span>
          </button>
        )}
        {sqlConnected && (
          <button
            type="button"
            title={`SQL ${sqlEngine || ""} · ${sqlLabel || ""}${sqlDb ? ` · ${sqlDb}` : ""}\nClick to clear chip (ask agent sql_disconnect to close pool)`}
            className="flex h-[22px] max-w-[220px] shrink-0 items-center gap-1 rounded px-1.5 text-[var(--vigil-accent)] hover:bg-[var(--vigil-hover)]"
            onClick={() => {
              clearSql();
              notify("SQL session chip cleared. Ask the agent to sql_disconnect if still connected.");
            }}
          >
            <span className="truncate">
              SQL: {sqlLabel?.trim() || sqlEngine || "connected"}
            </span>
          </button>
        )}
        <button
          type="button"
          title="Problems"
          aria-label={`${errors} errors, ${warnings} warnings`}
          className="flex h-[22px] items-center gap-2 rounded px-1.5 hover:bg-[var(--vigil-hover)]"
          onClick={() => useLayoutStore.getState().setBottomTab("problems")}
        >
          <span
            className={`flex items-center gap-0.5 ${errors > 0 ? "text-[var(--vigil-danger)]" : ""}`}
          >
            <XCircle className="h-3 w-3" aria-hidden />
            {errors}
          </span>
          <span
            className={`flex items-center gap-0.5 ${warnings > 0 ? "vigil-status-warning" : ""}`}
          >
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {warnings}
          </span>
        </button>
      </div>
      <div className="flex shrink-0 items-center">
        {active?.mode === "file" && caret && (
          <>
            <StatusButton
              label={`Ln ${caret.line}, Col ${caret.column}`}
              title="Go to Line"
              onClick={() => void runCommand("go.line")}
            />
            <StatusButton
              label={
                caret.insertSpaces
                  ? `Spaces: ${caret.tabSize}`
                  : `Tab Size: ${caret.tabSize}`
              }
              title="Indentation"
            />
            <StatusButton label="UTF-8" title="Encoding" />
            <StatusButton label={caret.eol} title="Line ending" />
            <StatusButton
              label={languageLabel(active.path, active.language)}
              title="Language"
            />
          </>
        )}
        <StatusButton
          label={tabStats(fileTabs.length, savedTabs)}
          title="Saved files over open files"
        />
        <StatusButton
          label={running ? "Agent: running" : agentStats(session.inputTokens, session.outputTokens)}
          title="Tokens used by the agent this session"
        />
        {root && (
          <StatusButton
            label={codeIndexLabel(
              semanticIndexing,
              semantic?.chunkCount ?? null,
              !!semantic?.deep || (semantic?.vectorCount ?? 0) > 0,
            )}
            title={
              semanticIndexing
                ? "Building deep local code index…"
                : indexError
                  ? `Index error: ${indexError}`
                  : `Deep local index (BM25+vectors+imports) · click to rebuild${
                      semantic?.fileCount != null
                        ? ` · ${semantic.fileCount} files`
                        : ""
                    }${
                      semantic?.edgeCount
                        ? ` · ${semantic.edgeCount} edges`
                        : ""
                    }`
            }
            onClick={() => {
              void (async () => {
                useWorkspaceIndexStore.setState({ semanticIndexing: true });
                try {
                  const next = await reindexLocalCodeIndex();
                  useWorkspaceIndexStore.setState({
                    semantic: next,
                    semanticIndexing: false,
                  });
                  notify(
                    `Deep index · ${next.fileCount ?? 0} files · ${next.chunkCount ?? 0} chunks · ${next.vectorCount ?? 0} vectors`,
                  );
                } catch (err) {
                  useWorkspaceIndexStore.setState({ semanticIndexing: false });
                  notify(
                    `Index rebuild failed: ${
                      err instanceof Error ? err.message : String(err)
                    }`,
                  );
                }
              })();
            }}
          />
        )}
        {git?.head && <StatusButton label={git.head} title="Current commit" />}
        <StatusButton
          label={PROVIDER_LABEL[provider] ?? chatModelLabel(provider)}
          title="Active model"
        />
      </div>
    </footer>
  );
}
