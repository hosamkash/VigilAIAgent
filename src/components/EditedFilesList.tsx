import type { ChatEditedFile } from "../store/chatStore";
import { openAndRevealFile } from "../lib/open-workspace-file";
import { useEditorTabsStore } from "../store/editorTabsStore";

/** Clickable agent edit list — never uses <a href> (that opens the system browser). */
export function EditedFilesList({ files }: { files: ChatEditedFile[] }) {
  const showAgentDiff = useEditorTabsStore((s) => s.showAgentDiff);
  if (files.length === 0) return null;
  return (
    <div className="mt-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold text-[var(--vigil-muted)]">
        <span>
          Edited files · {files.length}
        </span>
      </div>
      <ul className="space-y-0.5">
        {files.map((file) => (
          <li key={file.path} className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              title={`Open ${file.label} in editor`}
              className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-[var(--vigil-accent)] underline hover:brightness-110"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void openAndRevealFile(file.path);
              }}
            >
              {file.label}
            </button>
            {typeof file.original === "string" &&
              typeof file.modified === "string" && (
                <button
                  type="button"
                  title="Show diff"
                  className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    showAgentDiff(file.path, file.original!, file.modified!);
                  }}
                >
                  Diff
                </button>
              )}
          </li>
        ))}
      </ul>
    </div>
  );
}
