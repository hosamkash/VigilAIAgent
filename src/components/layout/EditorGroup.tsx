import { useRef } from "react";
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import { useEditorTabsStore } from "../../store/editorTabsStore";
import { useThemeStore, getTheme } from "../../store/themeStore";
import { writeTextFile } from "../../lib/workspace-fs";

export function EditorGroup() {
  const {
    tabs,
    activeId,
    minimapEnabled,
    setActive,
    closeTab,
    updateContent,
    markSaved,
    clearRevealLine,
    toggleMinimap,
  } = useEditorTabsStore();
  const themeId = useThemeStore((s) => s.themeId);
  const monacoTheme = getTheme(themeId).mode === "light" ? "vs" : "vs-dark";
  const active = tabs.find((t) => t.id === activeId) ?? null;
  const revealDone = useRef<string | null>(null);

  async function saveActive() {
    if (!active || active.mode === "diff") return;
    await writeTextFile(active.path, active.content);
    markSaved(active.id);
  }

  const onMount: OnMount = (editor) => {
    if (!active?.revealLine) return;
    const key = `${active.id}:${active.revealLine}`;
    if (revealDone.current === key) return;
    revealDone.current = key;
    const line = active.revealLine;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    clearRevealLine(active.id);
  };

  const crumbs = active
    ? active.path.replace(/\\/g, "/").split("/").filter(Boolean).slice(-4)
    : [];

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--vigil-editor)]">
      <div className="flex h-9 items-end overflow-x-auto border-b border-[var(--vigil-border)] bg-[var(--vigil-tab-inactive)]">
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
              onClick={() => closeTab(tab.id)}
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
              onClick={() => void saveActive()}
              className="rounded border border-[var(--vigil-border)] px-2 py-0.5 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            >
              Save
            </button>
          )}
        </div>
      </div>

      {active && (
        <div className="flex h-6 items-center gap-1 overflow-hidden border-b border-[var(--vigil-border-soft)] px-3 text-[11px] text-[var(--vigil-muted)]">
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

      <div className="min-h-0 flex-1">
        {!active && (
          <div className="flex h-full items-center justify-center text-sm text-[var(--vigil-muted)]">
            Vigil AI Agent — open a file to start editing
          </div>
        )}
        {active?.mode === "file" && (
          <Editor
            key={`${active.id}-${monacoTheme}-${active.revealLine ?? 0}`}
            height="100%"
            path={active.path}
            language={active.language}
            theme={monacoTheme}
            value={active.content}
            onMount={onMount}
            onChange={(v) => updateContent(active.id, v ?? "")}
            options={{
              fontSize: 13,
              minimap: { enabled: minimapEnabled },
              automaticLayout: true,
              scrollBeyondLastLine: false,
            }}
          />
        )}
        {active?.mode === "diff" && (
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
        )}
      </div>
    </section>
  );
}
