import { useEffect } from "react";
import { Boxes } from "lucide-react";
import { EMPTY_EDITOR_SHORTCUTS } from "../lib/empty-editor-shortcuts";
import {
  accelMatches,
  formatAccelParts,
  isMacPlatform,
  type PressedKey,
} from "../lib/menu-accel";
import { runCommand } from "../lib/ide-commands";

/**
 * Cursor-style empty editor tips: centered rows + OS-aware key chips.
 * Edit rows in `src/lib/empty-editor-shortcuts.ts`.
 */
export function EmptyEditorShortcuts() {
  const mac = isMacPlatform();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const pressed: PressedKey = {
        key: e.key,
        meta: e.metaKey,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        code: e.code,
      };
      for (const row of EMPTY_EDITOR_SHORTCUTS) {
        if (!accelMatches(pressed, row.accel, mac)) continue;
        e.preventDefault();
        e.stopPropagation();
        void runCommand(row.commandId);
        return;
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mac]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 px-6 text-[var(--vigil-muted)]">
      <Boxes
        className="h-14 w-14 opacity-35"
        strokeWidth={1.15}
        aria-hidden
      />
      <ul className="flex flex-col gap-3.5">
        {EMPTY_EDITOR_SHORTCUTS.map((row) => {
          const parts = formatAccelParts(row.accel, mac);
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => void runCommand(row.commandId)}
                className="group flex w-full min-w-[16rem] items-center justify-between gap-10 text-left text-[13px] text-[var(--vigil-muted)] transition-colors hover:text-[var(--vigil-text)]"
              >
                <span>{row.label}</span>
                <span className="flex items-center gap-1" aria-hidden>
                  {parts.map((part, i) => (
                    <kbd
                      key={`${row.id}-${part}-${i}`}
                      className="inline-flex min-w-[1.35rem] items-center justify-center rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--vigil-muted)] shadow-[0_1px_0_var(--vigil-border)] group-hover:text-[var(--vigil-text)]"
                    >
                      {part}
                    </kbd>
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
