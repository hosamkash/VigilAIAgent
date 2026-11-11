import { useEffect, useRef, useState } from "react";
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { useEditorTabsStore } from "../../store/editorTabsStore";
import { useThemeStore, getTheme } from "../../store/themeStore";
import { notify, runCommand } from "../../lib/ide-commands";
import { setMonacoBridge } from "../../lib/monaco-bridge";
import { configureMonacoTsJs } from "../../lib/monaco-diagnostics";
import { ensureProjectTsModels } from "../../lib/monaco-project-ts";
import { useEditorStatusStore } from "../../store/editorStatusStore";
import { ExtensionDetailView } from "../ExtensionDetailView";
import { BrowserView } from "../BrowserView";
import { destroyExtHostWebview } from "../../lib/embedded-site";
import { destroyVigilEmbedWebview } from "../../lib/vigil-embed-webview";
import { GitDiffBar } from "./GitDiffBar";
import { StartScreen } from "../StartScreen";
import { useExplorerStore } from "../../store/explorerStore";
import { useWorkspaceIndexStore } from "../../store/workspaceIndexStore";
import { useComposerContextStore } from "../../store/composerContextStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useInlineEditStore } from "../../store/inlineEditStore";
import { InlineEditPopover } from "../InlineEditPopover";
import type { Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";

type SelectionChipUi = {
  text: string;
  startLine: number;
  endLine: number;
  top: number;
  left: number;
};

type LineRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export function EditorGroup() {
  const {
    tabs,
    activeId,
    minimapEnabled,
    setActive,
    closeTab,
    updateContent,
    clearRevealLine,
    toggleMinimap,
    wordWrap,
  } = useEditorTabsStore();
  const root = useExplorerStore((s) => s.root);
  const launcherOpen = useExplorerStore((s) => s.launcherOpen);
  const indexReadyAt = useWorkspaceIndexStore((s) => s.lastIndexedAt);
  const themeId = useThemeStore((s) => s.themeId);
  const monacoTheme = getTheme(themeId).mode === "light" ? "vs" : "vs-dark";
  const active = tabs.find((t) => t.id === activeId) ?? null;
  const revealDone = useRef<string | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const [selectionUi, setSelectionUi] = useState<SelectionChipUi | null>(null);
  const inlineOpen = useInlineEditStore((s) => s.open);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !root || !indexReadyAt) return;
    void ensureProjectTsModels(monaco, root);
  }, [root, indexReadyAt]);

  // Never leave a child webview covering the IDE chrome.
  useEffect(() => {
    void destroyExtHostWebview();
    void destroyVigilEmbedWebview();
  }, [activeId, active?.mode]);

  useEffect(() => {
    if (active?.mode !== "file") {
      setMonacoBridge(null);
      useEditorStatusStore.getState().clear();
      setSelectionUi(null);
      useInlineEditStore.getState().close();
    }
  }, [active?.id, active?.mode]);

  useEffect(() => {
    return () => {
      setMonacoBridge(null);
      useEditorStatusStore.getState().clear();
    };
  }, []);

  function anchorFromSelection(
    editor: MonacoEditor.IStandaloneCodeEditor,
    range: LineRange,
  ) {
    const end = {
      lineNumber: range.endLineNumber,
      column: range.endColumn,
    };
    const visible = editor.getScrolledVisiblePosition(end);
    const host = editorHostRef.current;
    const hostWidth = host?.clientWidth ?? 640;
    const hostHeight = host?.clientHeight ?? 400;
    if (!visible) {
      return { top: 12, left: 12 };
    }
    return {
      left: Math.min(Math.max(8, visible.left), Math.max(8, hostWidth - 280)),
      top: Math.min(
        Math.max(8, visible.top - 8),
        Math.max(8, hostHeight - 120),
      ),
    };
  }

  function resolveEditRange(
    editor: MonacoEditor.IStandaloneCodeEditor,
  ): LineRange | null {
    const model = editor.getModel();
    const selection = editor.getSelection();
    if (!model || !selection) return null;
    if (!selection.isEmpty()) {
      return {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn,
      };
    }
    const line = selection.startLineNumber;
    const range = {
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: model.getLineMaxColumn(line),
    };
    editor.setSelection(range);
    return range;
  }

  function openInlineEditFromEditor(
    editor: MonacoEditor.IStandaloneCodeEditor,
    tabPath: string,
    language: string,
  ) {
    const model = editor.getModel();
    const range = resolveEditRange(editor);
    if (!model || !range) return false;
    const text = model.getValueInRange(range);
    if (!text.trim()) {
      notify("Select code to edit, or place the cursor on a line");
      return false;
    }
    const before = model.getValueInRange({
      startLineNumber: Math.max(1, range.startLineNumber - 12),
      startColumn: 1,
      endLineNumber: range.startLineNumber,
      endColumn: range.startColumn,
    });
    const afterEnd = Math.min(model.getLineCount(), range.endLineNumber + 12);
    const after = model.getValueInRange({
      startLineNumber: range.endLineNumber,
      startColumn: range.endColumn,
      endLineNumber: afterEnd,
      endColumn: model.getLineMaxColumn(afterEnd),
    });
    const anchor = anchorFromSelection(editor, range);
    useInlineEditStore.getState().openAt({
      path: tabPath,
      language,
      text,
      startLine: range.startLineNumber,
      endLine: range.endLineNumber,
      before,
      after,
      top: anchor.top,
      left: Math.min(anchor.left, 24),
    });
    setSelectionUi(null);
    return true;
  }

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    setMonacoBridge({
      trigger: (command) => {
        void editor.trigger("menu", command, null);
        editor.focus();
      },
      readSelection: () => {
        const model = editor.getModel();
        const selection = editor.getSelection();
        if (!model || !selection || selection.isEmpty()) return "";
        return model.getValueInRange(selection);
      },
      insert: (text) => {
        const selection = editor.getSelection();
        if (!selection) return false;
        editor.executeEdits("clip-shelf", [
          { range: selection, text, forceMoveMarkers: true },
        ]);
        const model = editor.getModel();
        const tabId = useEditorTabsStore.getState().activeId;
        if (model && tabId) {
          useEditorTabsStore.getState().updateContent(tabId, model.getValue());
        }
        editor.focus();
        return true;
      },
      replaceSelection: (text) => {
        const selection = editor.getSelection();
        if (!selection) return false;
        editor.executeEdits("inline-edit", [
          { range: selection, text, forceMoveMarkers: true },
        ]);
        const model = editor.getModel();
        const tabId = useEditorTabsStore.getState().activeId;
        if (model && tabId) {
          useEditorTabsStore.getState().updateContent(tabId, model.getValue());
        }
        editor.focus();
        return true;
      },
      getSelectionContext: () => {
        const tab = useEditorTabsStore.getState().tabs.find(
          (t) => t.id === useEditorTabsStore.getState().activeId,
        );
        if (!tab || tab.mode !== "file") return null;
        const model = editor.getModel();
        const range = resolveEditRange(editor);
        if (!model || !range) return null;
        const text = model.getValueInRange(range);
        if (!text.trim()) return null;
        const before = model.getValueInRange({
          startLineNumber: Math.max(1, range.startLineNumber - 12),
          startColumn: 1,
          endLineNumber: range.startLineNumber,
          endColumn: range.startColumn,
        });
        const afterEnd = Math.min(model.getLineCount(), range.endLineNumber + 12);
        const after = model.getValueInRange({
          startLineNumber: range.endLineNumber,
          startColumn: range.endColumn,
          endLineNumber: afterEnd,
          endColumn: model.getLineMaxColumn(afterEnd),
        });
        const anchor = anchorFromSelection(editor, range);
        return {
          text,
          startLine: range.startLineNumber,
          endLine: range.endLineNumber,
          before,
          after,
          path: tab.path,
          language: tab.language || "plaintext",
          top: anchor.top,
          left: Math.min(anchor.left, 24),
        };
      },
    });
    const publish = () => {
      const pos = editor.getPosition();
      const model = editor.getModel();
      if (!pos || !model) return;
      useEditorStatusStore.getState().setCaret({
        line: pos.lineNumber,
        column: pos.column,
        tabSize: model.getOptions().tabSize,
        insertSpaces: model.getOptions().insertSpaces,
        eol: model.getEOL() === "\r\n" ? "CRLF" : "LF",
      });
    };
    const syncSelectionUi = () => {
      if (useInlineEditStore.getState().open) {
        setSelectionUi(null);
        return;
      }
      const model = editor.getModel();
      const selection = editor.getSelection();
      if (!model || !selection || selection.isEmpty()) {
        setSelectionUi(null);
        return;
      }
      const text = model.getValueInRange(selection);
      if (!text.trim()) {
        setSelectionUi(null);
        return;
      }
      const end = selection.getEndPosition();
      const visible = editor.getScrolledVisiblePosition(end);
      if (!visible) {
        setSelectionUi(null);
        return;
      }
      const host = editorHostRef.current;
      const hostWidth = host?.clientWidth ?? 640;
      const hostHeight = host?.clientHeight ?? 400;
      const left = Math.min(
        Math.max(8, visible.left),
        Math.max(8, hostWidth - 220),
      );
      const top = Math.min(
        Math.max(8, visible.top - 36),
        Math.max(8, hostHeight - 40),
      );
      setSelectionUi({
        text,
        startLine: selection.startLineNumber,
        endLine: selection.endLineNumber,
        top,
        left,
      });
    };
    editor.onDidChangeCursorPosition(publish);
    editor.onDidChangeModelContent(publish);
    editor.onDidChangeCursorSelection(syncSelectionUi);
    editor.onDidScrollChange(syncSelectionUi);
    publish();
    syncSelectionUi();
    if (!active?.revealLine) return;
    const key = `${active.id}:${active.revealLine}`;
    if (revealDone.current === key) return;
    revealDone.current = key;
    const line = active.revealLine;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    clearRevealLine(active.id);
  };

  function addSelectionToChat() {
    if (!selectionUi || !active || active.mode !== "file") return;
    const id = useComposerContextStore.getState().addCodeSelection({
      path: active.path,
      text: selectionUi.text,
      startLine: selectionUi.startLine,
      endLine: selectionUi.endLine,
      workspaceRoot: root,
    });
    if (!id) return;
    const layout = useLayoutStore.getState();
    if (!layout.chatVisible) layout.toggleChat();
    setSelectionUi(null);
    notify("Added code selection to chat");
  }

  function editSelectionInline() {
    const editor = editorRef.current;
    if (!editor || !active || active.mode !== "file") {
      notify("Open a file to use Inline Edit");
      return;
    }
    openInlineEditFromEditor(editor, active.path, active.language || "plaintext");
  }

  if (launcherOpen || (!root && tabs.length === 0)) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--vigil-editor)]">
        <StartScreen />
      </section>
    );
  }

  const crumbs = active
    ? active.path.replace(/\\/g, "/").split("/").filter(Boolean).slice(-4)
    : [];

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--vigil-editor)]">
      <div className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-[var(--vigil-border)] bg-[var(--vigil-tab-inactive)]">
        {tabs.length === 0 && (
          <div className="px-3 py-2 text-xs text-[var(--vigil-muted)]">
            Open a file from the Explorer
          </div>
        )}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`group flex max-w-[200px] items-center gap-1 border-r border-[var(--vigil-border)] px-3 py-2 text-xs ${
              tab.id === activeId
                ? "bg-[var(--vigil-tab-active)] text-[var(--vigil-text)]"
                : "bg-[var(--vigil-tab-inactive)] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            }`}
          >
            <button
              type="button"
              className="truncate"
              onClick={() => setActive(tab.id)}
              title={tab.path}
            >
              {tab.dirty ? "● " : ""}
              {tab.title}
            </button>
            <button
              type="button"
              className="rounded px-1 opacity-60 hover:bg-[var(--vigil-hover)] hover:opacity-100"
              onClick={() => {
                void destroyExtHostWebview();
                closeTab(tab.id);
              }}
              aria-label={`Close ${tab.title}`}
            >
              ×
            </button>
          </div>
        ))}
        <div className="ml-auto mb-1 mr-2 flex items-center gap-1">
          <button
            type="button"
            onClick={toggleMinimap}
            className="rounded border border-[var(--vigil-border)] px-2 py-0.5 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            title="Toggle minimap"
          >
            Minimap {minimapEnabled ? "On" : "Off"}
          </button>
          {active && active.mode === "file" && (
            <button
              type="button"
              onClick={() => void runCommand("file.save")}
              className="rounded border border-[var(--vigil-border)] px-2 py-0.5 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            >
              Save
            </button>
          )}
        </div>
      </div>

      {active && active.mode !== "extension" && active.mode !== "browser" && (
        <div className="flex h-6 shrink-0 items-center gap-1 overflow-hidden border-b border-[var(--vigil-border-soft)] px-3 text-[11px] text-[var(--vigil-muted)]">
          {crumbs.map((c, i) => (
            <span key={`${c}-${i}`} className="flex items-center gap-1">
              {i > 0 && <span>/</span>}
              <span
                className={
                  i === crumbs.length - 1 ? "text-[var(--vigil-text)]" : ""
                }
              >
                {c}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {!active && (
          <div className="flex h-full items-center justify-center text-sm text-[var(--vigil-muted)]">
            Vigil AI Agent — open a file to start editing
          </div>
        )}
        {active?.mode === "extension" && active.extension && (
          <ExtensionDetailView
            key={active.extension.extensionId}
            meta={active.extension}
          />
        )}
        {active?.mode === "browser" && (
          <BrowserView
            key={active.id}
            tabId={active.id}
            initialUrl={active.browser?.url ?? ""}
          />
        )}
        {active?.mode === "file" && (
          <div ref={editorHostRef} className="relative h-full min-h-0">
            <Editor
              key={`${active.id}-${monacoTheme}-${active.revealLine ?? 0}`}
              height="100%"
              path={active.path}
              language={active.language}
              theme={monacoTheme}
              value={active.content}
              beforeMount={(monaco) => {
                monacoRef.current = monaco;
                configureMonacoTsJs(monaco);
                if (root) void ensureProjectTsModels(monaco, root);
              }}
              onMount={onMount}
              onChange={(v) => updateContent(active.id, v ?? "")}
              options={{
                fontSize: 13,
                minimap: { enabled: minimapEnabled },
                wordWrap: wordWrap ? "on" : "off",
                automaticLayout: true,
                scrollBeyondLastLine: false,
              }}
            />
            {!inlineOpen && selectionUi && (
              <div
                className="absolute z-20 flex items-center gap-1"
                style={{ top: selectionUi.top, left: selectionUi.left }}
                onMouseDown={(e) => {
                  // Keep the Monaco selection while clicking chips.
                  e.preventDefault();
                }}
              >
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1 text-[11px] font-medium text-[var(--vigil-text)] shadow-lg hover:bg-[var(--vigil-hover)]"
                  title="Inline Edit (⌘K)"
                  onClick={editSelectionInline}
                >
                  <Sparkles className="h-3.5 w-3.5 text-[var(--vigil-accent)]" />
                  Edit
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1 text-[11px] font-medium text-[var(--vigil-text)] shadow-lg hover:bg-[var(--vigil-hover)]"
                  title="Add selection to chat as a code reference"
                  onClick={addSelectionToChat}
                >
                  <MessageSquarePlus className="h-3.5 w-3.5 text-[var(--vigil-accent)]" />
                  Add to Chat
                </button>
              </div>
            )}
            <InlineEditPopover />
          </div>
        )}
        {active?.mode === "diff" && (
          <div className="flex h-full min-h-0 flex-col">
            {active.gitDiff && <GitDiffBar meta={active.gitDiff} />}
            <div className="min-h-0 flex-1">
              <DiffEditor
                key={`diff-${active.id}-${monacoTheme}`}
                height="100%"
                language={active.language}
                theme={monacoTheme}
                original={active.original}
                modified={active.content}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  automaticLayout: true,
                  minimap: { enabled: minimapEnabled },
                  fontSize: 13,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
