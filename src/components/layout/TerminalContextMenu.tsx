import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import type { Clip } from "../../lib/clip-shelf";

function preview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 72 ? `${line.slice(0, 72)}…` : line;
}

export type TerminalContextMenuProps = {
  x: number;
  y: number;
  hasSelection: boolean;
  link: string | null;
  clips: Clip[];
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onPasteClip: (text: string) => void;
  onOpenLink: (url: string) => void;
  onClear: () => void;
  onAddToChat: () => void;
};

export function TerminalContextMenu({
  x,
  y,
  hasSelection,
  link,
  clips,
  onClose,
  onCopy,
  onPaste,
  onPasteClip,
  onOpenLink,
  onClear,
  onAddToChat,
}: TerminalContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [shelfOpen, setShelfOpen] = useState(false);
  const textClips = clips.filter((clip) => clip.text.trim());

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y, shelfOpen]);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const timer = window.setTimeout(() => {
      window.addEventListener("mousedown", onPointer);
      window.addEventListener("keydown", onKey);
      window.addEventListener("resize", onClose);
      window.addEventListener("blur", onClose);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      data-clip-shelf
      role="menu"
      aria-label="Terminal actions"
      className="fixed z-[80] min-w-[200px] rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] py-1 text-[12px] text-[var(--vigil-text)] shadow-lg select-none"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {link && (
        <MenuItem
          label="Open Link"
          onSelect={() => run(() => onOpenLink(link))}
        />
      )}
      <MenuItem
        label="Copy"
        disabled={!hasSelection}
        onSelect={() => run(onCopy)}
      />
      <MenuItem label="Paste" onSelect={() => run(onPaste)} />
      <MenuItem
        label="Copied items"
        trailing={<ChevronRight className="h-3.5 w-3.5 opacity-70" />}
        onSelect={() => setShelfOpen((open) => !open)}
        keepOpen
      />
      {shelfOpen && (
        <div className="mx-1 mb-1 max-h-56 overflow-y-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)]">
          {textClips.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-[var(--vigil-muted)]">
              No copied text yet. Copy something first.
            </p>
          ) : (
            textClips.map((clip) => (
              <button
                key={clip.id}
                type="button"
                role="menuitem"
                className="block w-full truncate px-3 py-1.5 text-left hover:bg-[var(--vigil-hover)]"
                title={clip.text}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  run(() => onPasteClip(clip.text));
                }}
              >
                {preview(clip.text)}
              </button>
            ))
          )}
        </div>
      )}
      <div className="my-1 border-t border-[var(--vigil-border)]" />
      <MenuItem
        label="Add to Chat"
        disabled={!hasSelection}
        onSelect={() => run(onAddToChat)}
      />
      <MenuItem label="Clear Terminal" onSelect={() => run(onClear)} />
    </div>,
    document.body,
  );
}

function MenuItem({
  label,
  disabled,
  trailing,
  keepOpen,
  onSelect,
}: {
  label: string;
  disabled?: boolean;
  trailing?: ReactNode;
  keepOpen?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-[var(--vigil-hover)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent`}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (disabled) return;
        onSelect();
        if (keepOpen) event.stopPropagation();
      }}
    >
      <span>{label}</span>
      {trailing}
    </button>
  );
}
