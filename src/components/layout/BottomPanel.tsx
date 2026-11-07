import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Copy, ExternalLink, MessageSquarePlus } from "lucide-react";
import { useLayoutStore } from "../../store/layoutStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useExplorerStore } from "../../store/explorerStore";
import { useThemeStore, getTheme } from "../../store/themeStore";
import { useComposerContextStore } from "../../store/composerContextStore";
import {
  setClipTerminalSink,
  useClipShelf,
} from "../../lib/clip-shelf";
import { streamWorkspaceCommand } from "../../lib/terminal-run";
import { stepCommandHistory } from "../../lib/terminal-history";
import {
  extractHttpUrl,
  openTerminalUrl,
  sanitizeTerminalUrl,
} from "../../lib/terminal-links";
import { resolveTerminalShortcut } from "../../lib/terminal-shortcuts";
import { notify } from "../../lib/ide-commands";
import { PaneToggleButton } from "./PaneToggleButton";
import { TerminalContextMenu } from "./TerminalContextMenu";

type TerminalSelection = {
  text: string;
  startLine: number;
  endLine: number;
};

export function BottomPanel({ fill = false }: { fill?: boolean }) {
  const { bottomVisible, bottomTab, bottomHeight, setBottomTab, toggleBottom } =
    useLayoutStore();
  const {
    terminals,
    activeId,
    problems,
    output,
    pendingRun,
    ensureDefault,
    addTerminal,
    closeTerminal,
    setActive,
    appendHistory,
    clearProblems,
    clearSignal,
    resolvePendingRun,
    requestClear,
  } = useTerminalStore();
  const root = useExplorerStore((s) => s.root);
  const themeId = useThemeStore((s) => s.themeId);
  const clips = useClipShelf((s) => s.clips);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lineRef = useRef("");
  const busyRef = useRef(false);
  const historyIndexRef = useRef(-1);
  const historyDraftRef = useRef("");
  const [cmd, setCmd] = useState("");
  const [termReady, setTermReady] = useState(false);
  const [selection, setSelection] = useState<TerminalSelection | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    link: string | null;
  } | null>(null);
  const [linkHover, setLinkHover] = useState<{
    url: string;
    x: number;
    y: number;
  } | null>(null);
  const hoveredLinkRef = useRef<string | null>(null);
  const linkLeaveTimer = useRef(0);

  function rewriteInputLine(term: Terminal, next: string) {
    term.write(`\r\x1b[2K$ ${next}`);
    lineRef.current = next;
    setCmd(next);
  }

  function resetHistoryBrowse() {
    historyIndexRef.current = -1;
    historyDraftRef.current = "";
  }

  const insertIntoInput = useCallback((raw: string): boolean => {
    const term = termRef.current;
    if (!term || busyRef.current) return false;
    const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, " ");
    if (!text) return false;
    if (historyIndexRef.current >= 0) {
      historyIndexRef.current = -1;
      historyDraftRef.current = lineRef.current + text;
    }
    for (const ch of text) {
      if (ch >= " " || ch === "\t") {
        lineRef.current += ch;
        term.write(ch);
      }
    }
    setCmd(lineRef.current);
    return true;
  }, []);
  const insertIntoInputRef = useRef(insertIntoInput);
  insertIntoInputRef.current = insertIntoInput;

  useEffect(() => {
    if (!termReady) return;
    setClipTerminalSink(insertIntoInput);
    return () => setClipTerminalSink(null);
  }, [termReady, insertIntoInput]);

  useEffect(() => {
    useClipShelf.getState().load(root?.trim() || "none");
  }, [root]);

  async function runVisibleCommand(
    command: string,
    cwd: string,
    options?: { echoPrompt?: boolean },
  ) {
    const term = termRef.current;
    const state = useTerminalStore.getState();
    const session = state.terminals.find((item) => item.id === state.activeId);
    if (!term || !session || !command.trim() || busyRef.current) return;
    busyRef.current = true;
    const line = command.trim();
    useTerminalStore.getState().rememberCommand(line);
    resetHistoryBrowse();
    if (options?.echoPrompt !== false) {
      // Replace the idle "$ " prompt already on the last line.
      term.write(`\r\x1b[2K$ ${line}\r\n`);
    }
    appendHistory(session.id, `$ ${line}\n`);
    try {
      const code = await streamWorkspaceCommand(line, cwd || session.cwd, (chunk) => {
        term.write(chunk.replace(/\n/g, "\r\n"));
        appendHistory(session.id, chunk);
      });
      if (code !== 0) {
        const note = `[exit ${code}]\r\n`;
        term.write(note);
        appendHistory(session.id, `[exit ${code}]\n`);
      }
    } catch (err) {
      const msg = String(err);
      term.write(`${msg.replace(/\n/g, "\r\n")}\r\n`);
      appendHistory(session.id, `${msg}\n`);
    } finally {
      term.write("$ ");
      appendHistory(session.id, "$ ");
      busyRef.current = false;
    }
  }

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
    const clearLinkLeave = () => {
      window.clearTimeout(linkLeaveTimer.current);
    };
    const webLinks = new WebLinksAddon(
      (_event, uri) => {
        void openTerminalUrl(uri).then((ok) => {
          if (!ok) notify("Could not open link");
        });
      },
      {
        hover: (event, text) => {
          clearLinkLeave();
          const url = sanitizeTerminalUrl(text);
          if (!url) return;
          hoveredLinkRef.current = url;
          setLinkHover({ url, x: event.clientX, y: event.clientY });
        },
        leave: () => {
          clearLinkLeave();
          // Keep the Open Link chip briefly so it can be clicked.
          linkLeaveTimer.current = window.setTimeout(() => {
            hoveredLinkRef.current = null;
            setLinkHover(null);
          }, 250);
        },
      },
    );
    term.loadAddon(webLinks);
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    setTermReady(true);

    const fitHost = hostRef.current.parentElement ?? hostRef.current;
    let fittedWidth = 0;
    let fittedHeight = 0;
    let fitFrame = 0;
    const fitNow = () => {
      const width = fitHost.clientWidth;
      const height = fitHost.clientHeight;
      if (width < 2 || height < 2) return;
      if (width === fittedWidth && height === fittedHeight) return;
      fittedWidth = width;
      fittedHeight = height;
      try {
        fit.fit();
      } catch {
        /* The terminal can close while a fit is queued. */
      }
    };
    fitFrame = requestAnimationFrame(fitNow);

    const active = useTerminalStore
      .getState()
      .terminals.find((t) => t.id === useTerminalStore.getState().activeId);
    if (active?.history) term.write(active.history.replace(/\n/g, "\r\n"));
    else term.write("$ ");

    const syncSelection = () => {
      const text = term.getSelection();
      if (!text.trim()) {
        setSelection(null);
        return;
      }
      const pos = term.getSelectionPosition();
      const lineCount = Math.max(1, text.replace(/\r\n/g, "\n").split("\n").length);
      const startLine = pos ? Math.min(pos.start.y, pos.end.y) + 1 : 1;
      const endLine = pos
        ? Math.max(pos.start.y, pos.end.y) + 1
        : startLine + lineCount - 1;
      setSelection({ text, startLine, endLine });
    };
    term.onSelectionChange(syncSelection);

    term.attachCustomKeyEventHandler((event) => {
      const shortcut = resolveTerminalShortcut(
        event,
        !!term.getSelection()?.length,
      );
      if (!shortcut) return true;

      if (shortcut.action === "interrupt") {
        // Let xterm emit \u0003 (Ctrl+C) into onData.
        return true;
      }

      event.preventDefault();
      event.stopPropagation();

      if (shortcut.action === "swallow") return false;

      if (shortcut.action === "selectAll") {
        term.selectAll();
        return false;
      }

      if (shortcut.action === "copy") {
        const text = term.getSelection();
        if (text) {
          void navigator.clipboard?.writeText(text).then(
            () => {
              useClipShelf.getState().add(text);
              notify("Copied");
            },
            () => notify("Could not copy"),
          );
        }
        return false;
      }

      if (shortcut.action === "paste") {
        void navigator.clipboard
          ?.readText()
          .then((text) => {
            if (!insertIntoInputRef.current(text)) {
              notify(busyRef.current ? "Terminal is busy" : "Nothing to paste");
            }
          })
          .catch(() => notify("Could not read clipboard"));
        return false;
      }

      return false;
    });

    term.onData((data) => {
      if (busyRef.current && data !== "\u0003") return;

      // ↑ / ↓ — cycle previous commands like a real shell
      // (CSI and SS3 / application cursor keys).
      if (
        data === "\x1b[A" ||
        data === "\x1b[B" ||
        data === "\x1bOA" ||
        data === "\x1bOB"
      ) {
        const commands = useTerminalStore.getState().commands;
        if (historyIndexRef.current < 0) {
          historyDraftRef.current = lineRef.current;
        }
        const up = data === "\x1b[A" || data === "\x1bOA";
        const stepped = stepCommandHistory(
          commands,
          historyIndexRef.current,
          up ? "up" : "down",
          historyDraftRef.current,
        );
        historyIndexRef.current = stepped.index;
        historyDraftRef.current = stepped.draft;
        rewriteInputLine(term, stepped.value);
        return;
      }

      if (data === "\r") {
        const command = lineRef.current;
        term.write("\r\n");
        lineRef.current = "";
        setCmd("");
        resetHistoryBrowse();
        if (!command.trim()) {
          term.write("$ ");
          return;
        }
        if (busyRef.current) {
          term.write("(busy — wait for the current command)\r\n$ ");
          return;
        }
        const state = useTerminalStore.getState();
        const t = state.terminals.find((x) => x.id === state.activeId);
        if (!t) {
          term.write("$ ");
          return;
        }
        void runVisibleCommand(command, t.cwd, { echoPrompt: false });
        return;
      }
      if (data === "\u007f") {
        if (lineRef.current.length > 0) {
          lineRef.current = lineRef.current.slice(0, -1);
          setCmd(lineRef.current);
          term.write("\b \b");
          if (historyIndexRef.current >= 0) {
            historyDraftRef.current = lineRef.current;
            historyIndexRef.current = -1;
          }
        }
        return;
      }
      if (data >= " " || data === "\t") {
        if (historyIndexRef.current >= 0) {
          historyIndexRef.current = -1;
          historyDraftRef.current = lineRef.current + data;
        }
        lineRef.current += data;
        setCmd(lineRef.current);
        term.write(data);
      }
    });

    const scheduleFit = () => {
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(fitNow);
    };
    window.addEventListener("resize", scheduleFit);
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(fitHost);
    return () => {
      cancelAnimationFrame(fitFrame);
      window.clearTimeout(linkLeaveTimer.current);
      window.removeEventListener("resize", scheduleFit);
      ro.disconnect();
      setTermReady(false);
      setSelection(null);
      setLinkHover(null);
      hoveredLinkRef.current = null;
      webLinks.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [bottomVisible, bottomTab, activeId, appendHistory, themeId, fill]);

  function copySelection() {
    if (!selection?.text) return;
    void navigator.clipboard?.writeText(selection.text).then(
      () => {
        useClipShelf.getState().add(selection.text);
        notify("Copied");
      },
      () => notify("Could not copy"),
    );
  }

  function addSelectionToChat() {
    if (!selection?.text) return;
    const title =
      terminals.find((item) => item.id === activeId)?.title || "Terminal";
    const id = useComposerContextStore.getState().addTerminalSelection({
      text: selection.text,
      startLine: selection.startLine,
      endLine: selection.endLine,
      terminalTitle: title,
    });
    if (!id) return;
    const layout = useLayoutStore.getState();
    if (!layout.chatVisible) layout.toggleChat();
    termRef.current?.clearSelection();
    setSelection(null);
    notify("Added to chat as a terminal reference");
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!insertIntoInput(text)) notify("Nothing to paste");
    } catch {
      notify("Could not read clipboard");
    }
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  function openHoveredOrMenuLink(url: string) {
    void openTerminalUrl(url).then((ok) => {
      if (!ok) notify("Could not open link");
      else {
        setLinkHover(null);
        hoveredLinkRef.current = null;
      }
    });
  }

  useEffect(() => {
    const term = termRef.current;
    if (!term || clearSignal === 0) return;
    term.clear();
    lineRef.current = "";
    historyIndexRef.current = -1;
    historyDraftRef.current = "";
    setCmd("");
    term.write("$ ");
  }, [clearSignal]);

  useEffect(() => {
    if (!pendingRun || !termReady) return;
    if ((!fill && !bottomVisible) || bottomTab !== "terminal") return;
    const term = termRef.current;
    if (!term) return;
    const job = pendingRun;
    const state = useTerminalStore.getState();
    const session = state.terminals.find((item) => item.id === state.activeId);

    if (job.mode === "write") {
      const line = job.command.trim();
      if (line) {
        term.write(`\r\x1b[2K$ ${line}\r\n`);
        if (session) appendHistory(session.id, `$ ${line}\n`);
      }
      resolvePendingRun(job.id);
      return;
    }

    if (job.mode === "prompt") {
      term.write("$ ");
      if (session) appendHistory(session.id, "$ ");
      resolvePendingRun(job.id);
      return;
    }

    if (job.mode === "execute") {
      resolvePendingRun(job.id);
      void runVisibleCommand(job.command, job.cwd, { echoPrompt: false });
      return;
    }

    resolvePendingRun(job.id);
  }, [
    pendingRun,
    termReady,
    bottomVisible,
    bottomTab,
    fill,
    activeId,
    resolvePendingRun,
    appendHistory,
  ]);

  if (!fill && !bottomVisible) {
    return (
      <div className="flex h-8 items-center justify-end border-t border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2">
        <PaneToggleButton direction="up" label="Expand panel" onClick={toggleBottom} />
      </div>
    );
  }

  return (
    <div
      data-vigil-bottom-panel
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
        <span className="ml-2 shrink-0">
          <PaneToggleButton direction="down" label="Collapse panel" onClick={toggleBottom} />
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-1.5">
        {bottomTab === "terminal" && (
          <div
            data-vigil-terminal
            className="vigil-terminal relative h-full overflow-hidden rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-terminal-bg)]"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const fromHover = hoveredLinkRef.current;
              const fromSelection = selection?.text
                ? extractHttpUrl(selection.text)
                : null;
              setLinkHover(null);
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                link: fromHover ?? fromSelection,
              });
            }}
          >
            <div ref={hostRef} className="h-full w-full overflow-hidden" />
            {linkHover &&
              createPortal(
                <div
                  className="xterm-hover fixed z-[85]"
                  style={{
                    left: Math.min(linkHover.x + 12, window.innerWidth - 140),
                    top: Math.max(8, linkHover.y - 36),
                  }}
                  onMouseEnter={() => window.clearTimeout(linkLeaveTimer.current)}
                  onMouseLeave={() => {
                    linkLeaveTimer.current = window.setTimeout(() => {
                      hoveredLinkRef.current = null;
                      setLinkHover(null);
                    }, 150);
                  }}
                >
                  <button
                    type="button"
                    title={linkHover.url}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1 text-[11px] !text-[var(--vigil-text)] shadow-lg hover:bg-[var(--vigil-hover)]"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openHoveredOrMenuLink(linkHover.url)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Link
                  </button>
                </div>,
                document.body,
              )}
            {selection && (
              <div className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-1 shadow-lg">
                <button
                  type="button"
                  title="Copy"
                  aria-label="Copy selection"
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] !text-[var(--vigil-text)] hover:bg-[var(--vigil-hover)]"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={copySelection}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </button>
                <button
                  type="button"
                  title="Add to Chat"
                  aria-label="Add selection to chat"
                  className="inline-flex items-center gap-1 rounded bg-[var(--vigil-accent)] px-2 py-1 text-[11px] !text-white hover:brightness-110"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={addSelectionToChat}
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  Add to Chat
                </button>
              </div>
            )}
            <div className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-[var(--vigil-muted)]">
              {cmd ? `typing: ${cmd}` : ""}
            </div>
            {contextMenu && (
              <TerminalContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                hasSelection={!!selection?.text.trim()}
                link={contextMenu.link}
                clips={clips}
                onClose={closeContextMenu}
                onCopy={copySelection}
                onPaste={() => {
                  void pasteFromClipboard();
                }}
                onPasteClip={(text) => {
                  if (!insertIntoInput(text)) notify("Could not paste");
                }}
                onOpenLink={(url) => openHoveredOrMenuLink(url)}
                onClear={requestClear}
                onAddToChat={addSelectionToChat}
              />
            )}
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
