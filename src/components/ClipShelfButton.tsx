import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, Pencil, Pin, Trash2 } from "lucide-react";
import { pasteClip, refreshClipboardImages, useClipShelf } from "../lib/clip-shelf";
import { useExplorerStore } from "../store/explorerStore";

function preview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

export function ClipShelfButton() {
  const root = useExplorerStore((s) => s.root);
  const clips = useClipShelf((s) => s.clips);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState("");
  const [menuBox, setMenuBox] = useState<{
    left: number;
    width: number;
    bottom: number;
    maxHeight: number;
  } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    useClipShelf.getState().load(root?.trim() || "none");
  }, [root]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (boxRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const placeMenu = () => {
    const anchor = boxRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const width = Math.min(340, window.innerWidth - 16);
    const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
    setMenuBox({
      left,
      width,
      bottom: window.innerHeight - anchor.top + 8,
      maxHeight: Math.max(180, anchor.top - 16),
    });
  };

  const paste = (clip: { text: string; image?: string }) => {
    if (!pasteClip(clip)) {
      setHint(
        clip.image
          ? "Open the chat to drop the image."
          : "Click in a file, chat field, or the terminal first.",
      );
      return;
    }
    setHint("");
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative" data-clip-shelf>
      <button
        type="button"
        title="Copied items"
        aria-label="Copied items"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-600 !text-white hover:bg-violet-700"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setHint("");
          setEditingId(null);
          if (open) {
            setOpen(false);
            return;
          }
          placeMenu();
          setOpen(true);
          void refreshClipboardImages(true);
        }}
      >
        <ClipboardPaste className="h-4 w-4" />
      </button>
      {open &&
        menuBox &&
        createPortal(
        <div
          ref={menuRef}
          data-clip-shelf
          className="fixed z-[80] flex flex-col overflow-hidden rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] shadow-xl"
          style={{
            left: menuBox.left,
            width: menuBox.width,
            bottom: menuBox.bottom,
            maxHeight: menuBox.maxHeight,
          }}
        >
          <div className="border-b border-[var(--vigil-border)] px-3 py-2 text-sm text-[var(--vigil-text)]">
            Copied items · {clips.length}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {clips.length === 0 && (
              <p className="px-3 py-4 text-sm text-[var(--vigil-muted)]">
                Copy text or an image. The latest 15 stay here.
              </p>
            )}
            {clips.map((clip) => (
              <div
                key={clip.id}
                className="border-b border-[var(--vigil-border)] px-3 py-2 last:border-b-0"
              >
                {editingId === clip.id && !clip.image ? (
                  <div className="flex flex-col gap-1">
                    <textarea
                      value={draft}
                      rows={3}
                      className="w-full resize-y rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-sm text-[var(--vigil-text)] outline-none"
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className="self-end rounded bg-[var(--vigil-accent)] px-2 py-0.5 text-[11px] !text-white"
                      onClick={() => {
                        useClipShelf.getState().update(clip.id, draft);
                        setEditingId(null);
                      }}
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      title={
                        clip.image
                          ? "Insert image"
                          : "Insert into the focused editor or terminal"
                      }
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-[var(--vigil-text)] hover:underline"
                      onClick={() => paste(clip)}
                    >
                      {clip.image && (
                        <img
                          src={clip.image}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded object-cover"
                        />
                      )}
                      <span className="truncate">
                        {clip.text.trim() ? preview(clip.text) : "Image"}
                      </span>
                    </button>
                    <button
                      type="button"
                      title={clip.pinned ? "Unpin" : "Pin"}
                      aria-label={clip.pinned ? "Unpin" : "Pin"}
                      className={`p-0.5 ${
                        clip.pinned
                          ? "text-[var(--vigil-accent)]"
                          : "text-[var(--vigil-muted)]"
                      }`}
                      onClick={() => useClipShelf.getState().togglePin(clip.id)}
                    >
                      <Pin className="h-4 w-4" />
                    </button>
                    {!clip.image && (
                      <button
                        type="button"
                        title="Edit"
                        aria-label="Edit"
                        className="p-0.5 text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
                        onClick={() => {
                          setEditingId(clip.id);
                          setDraft(clip.text);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Delete"
                      aria-label="Delete"
                      className="p-0.5 text-[var(--vigil-muted)] hover:text-[var(--vigil-danger)]"
                      onClick={() => useClipShelf.getState().remove(clip.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {hint && (
            <p className="border-t border-[var(--vigil-border)] px-3 py-2 text-sm text-[var(--vigil-danger)]">
              {hint}
            </p>
          )}
        </div>,
          document.body,
        )}
    </div>
  );
}
