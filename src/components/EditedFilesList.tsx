import type { ChatEditedFile } from "../store/chatStore";
import { openAndRevealFile } from "../lib/open-workspace-file";

/** Clickable agent edit list — never uses <a href> (that opens the system browser). */
export function EditedFilesList({ files }: { files: ChatEditedFile[] }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5">
      <div className="mb-1 text-[11px] font-semibold text-[var(--vigil-muted)]">
        Edited files
      </div>
      <ul className="space-y-0.5">
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              title={`Open ${file.label} in editor`}
              className="max-w-full truncate font-mono text-[12px] text-[var(--vigil-accent)] underline hover:brightness-110"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void openAndRevealFile(file.path);
              }}
            >
              {file.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
