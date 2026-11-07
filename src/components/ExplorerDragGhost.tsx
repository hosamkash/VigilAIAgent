import { createPortal } from "react-dom";
import { useExplorerDragStore } from "../lib/explorer-drag-session";

/** Floating chip that follows the pointer while dragging from Explorer. */
export function ExplorerDragGhost() {
  const dragging = useExplorerDragStore((s) => s.dragging);
  const items = useExplorerDragStore((s) => s.items);
  const x = useExplorerDragStore((s) => s.x);
  const y = useExplorerDragStore((s) => s.y);
  const overComposer = useExplorerDragStore((s) => s.overComposer);

  if (!dragging || items.length === 0) return null;

  const first = items[0]!;
  const label =
    items.length === 1
      ? `${first.isDir ? "📁" : "📄"} ${first.name}`
      : `${items.length} items`;

  return createPortal(
    <div
      aria-hidden
      className={`pointer-events-none fixed z-[100000] max-w-[240px] truncate rounded-md border px-2 py-1 text-[12px] shadow-lg ${
        overComposer
          ? "border-[var(--vigil-accent)] bg-[var(--vigil-accent-soft)] text-[var(--vigil-accent)]"
          : "border-[var(--vigil-border)] bg-[var(--vigil-panel)] text-[var(--vigil-text)]"
      }`}
      style={{ left: x + 12, top: y + 12 }}
    >
      {label}
    </div>,
    document.body,
  );
}
