import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useLayoutStore } from "../../store/layoutStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useExplorerStore } from "../../store/explorerStore";
import { useThemeStore, getTheme } from "../../store/themeStore";
import { runWorkspaceCommand } from "../../lib/workspace-fs";

export function BottomPanel({ fill = false }: { fill?: boolean }) {
  const { bottomVisible, bottomTab, bottomHeight, setBottomTab, toggleBottom } =
    useLayoutStore();
  const {
    terminals,
    activeId,
    problems,
    output,
    ensureDefault,
    addTerminal,
    closeTerminal,
    setActive,
    appendHistory,
    clearProblems,
  } = useTerminalStore();
  const root = useExplorerStore((s) => s.root);
  const themeId = useThemeStore((s) => s.themeId);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lineRef = useRef("");
  const [cmd, setCmd] = useState("");

  useEffect(() => {
    if (root) ensureDefault(root);
  }, [root, ensureDefault]);

  useEffect(() => {
    if ((!fill && !bottomVisible) || bottomTab !== "terminal" || !hostRef.current)
      return;
    const theme = getTheme(themeId);
    const term = new Terminal({
      convertEol: true,
      fontSize: 12,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: theme.vars["--vigil-terminal-bg"] ?? "#1e1e1e",
        foreground: theme.vars["--vigil-terminal-fg"] ?? "#cccccc",
        cursor: theme.vars["--vigil-terminal-cursor"] ?? "#cccccc",
        selectionBackground: theme.vars["--vigil-selection"] ?? "#264f78",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    requestAnimationFrame(() => fit.fit());
    termRef.current = term;
    fitRef.current = fit;

    const active = useTerminalStore
      .getState()
      .terminals.find((t) => t.id === useTerminalStore.getState().activeId);
    if (active?.history) term.write(active.history.replace(/\n/g, "\r\n"));
    else term.write("$ ");

    term.onData((data) => {
      if (data === "\r") {
        const command = lineRef.current;
        term.write("\r\n");
        lineRef.current = "";
        setCmd("");
        void (async () => {
          const state = useTerminalStore.getState();
          const t = state.terminals.find((x) => x.id === state.activeId);
          if (!t || !command.trim()) {
            term.write("$ ");
            return;
          }
          appendHistory(t.id, `$ ${command}\n`);
          try {
            const out = await runWorkspaceCommand(command, t.cwd);
            appendHistory(t.id, `${out}\n`);
            term.write(`${out.replace(/\n/g, "\r\n")}\r\n`);
          } catch (err) {
            const msg = String(err);
            appendHistory(t.id, `${msg}\n`);
            term.write(`${msg}\r\n`);
          }
          term.write("$ ");
          appendHistory(t.id, "$ ");
        })();
        return;
      }
      if (data === "\u007f") {
        if (lineRef.current.length > 0) {
          lineRef.current = lineRef.current.slice(0, -1);
          setCmd(lineRef.current);
          term.write("\b \b");
        }
        return;
      }
      if (data >= " " || data === "\t") {
        lineRef.current += data;
        setCmd(lineRef.current);
        term.write(data);
      }
    });

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => fit.fit());
    if (hostRef.current) ro.observe(hostRef.current);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [bottomVisible, bottomTab, activeId, appendHistory, themeId, fill]);

  if (!fill && !bottomVisible) {
    return (
      <button
        type="button"
        onClick={toggleBottom}
        className="border-t border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-3 py-1 text-left text-[11px] text-[var(--vigil-muted)]"
      >
        Panel
      </button>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 shrink-0 flex-col border-t border-[var(--vigil-border)] bg-[var(--vigil-panel)]"
      style={fill ? undefined : { height: bottomHeight }}
    >
      <div className="flex items-center gap-1 border-b border-[var(--vigil-border)] px-2 text-[11px]">
        {(["terminal", "problems", "output"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setBottomTab(tab)}
            className={`px-2 py-1 uppercase tracking-wide ${
              bottomTab === tab
                ? "border-b border-[var(--vigil-accent)] text-[var(--vigil-text)]"
                : "text-[var(--vigil-muted)]"
            }`}
          >
            {tab}
          </button>
        ))}
        <div className="flex-1" />
        {bottomTab === "terminal" && (
          <>
            {terminals.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={`mr-1 rounded px-2 py-0.5 ${
                  t.id === activeId
                    ? "bg-[var(--vigil-hover)] text-[var(--vigil-text)]"
                    : "text-[var(--vigil-muted)]"
                }`}
              >
                {t.title}
                <span
                  className="ml-1 opacity-60"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTerminal(t.id);
                  }}
                >
                  ×
                </span>
              </button>
            ))}
            <button
              type="button"
              className="rounded px-2 py-0.5 text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
              onClick={() => root && addTerminal(root)}
              title="New Terminal"
            >
              +
            </button>
          </>
        )}
        <button
          type="button"
          className="px-2 text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
          onClick={toggleBottom}
        >
          ▾
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {bottomTab === "terminal" && (
          <div className="relative h-full">
            <div ref={hostRef} className="h-full w-full" />
            <div className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-[var(--vigil-muted)]">
              {cmd ? `typing: ${cmd}` : ""}
            </div>
          </div>
        )}
        {bottomTab === "problems" && (
          <div className="h-full overflow-auto p-2 text-xs">
            <div className="mb-2 flex justify-between">
              <span>{problems.length} problems</span>
              <button type="button" onClick={clearProblems}>
                Clear
              </button>
            </div>
            {problems.map((p, i) => (
              <div key={`${p}-${i}`} className="text-[var(--vigil-danger)]">
                {p}
              </div>
            ))}
          </div>
        )}
        {bottomTab === "output" && (
          <pre className="h-full overflow-auto p-2 font-mono text-[11px]">
            {output || "No output"}
          </pre>
        )}
      </div>
    </div>
  );
}
