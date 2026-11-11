import { useEffect, useRef } from "react";
import { Sparkles, X } from "lucide-react";
import { runInlineEdit } from "../lib/inline-edit";
import { replaceMonacoSelection } from "../lib/monaco-bridge";
import { notify } from "../lib/ide-commands";
import { useInlineEditStore } from "../store/inlineEditStore";

export function InlineEditPopover() {
  const open = useInlineEditStore((s) => s.open);
  const busy = useInlineEditStore((s) => s.busy);
  const error = useInlineEditStore((s) => s.error);
  const instruction = useInlineEditStore((s) => s.instruction);
  const target = useInlineEditStore((s) => s.target);
  const setInstruction = useInlineEditStore((s) => s.setInstruction);
  const setBusy = useInlineEditStore((s) => s.setBusy);
  const setError = useInlineEditStore((s) => s.setError);
  const close = useInlineEditStore((s) => s.close);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open || !target) return null;

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { code, model } = await runInlineEdit({
        path: target!.path,
        language: target!.language,
        instruction,
        selection: target!.text,
        startLine: target!.startLine,
        endLine: target!.endLine,
        before: target!.before,
        after: target!.after,
      });
      if (!replaceMonacoSelection(code)) {
        throw new Error("Could not apply edit in the editor");
      }
      notify(`Inline edit applied (${model})`);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div
      className="absolute z-30 w-[min(420px,calc(100%-16px))] rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-2 shadow-xl"
      style={{ top: target.top, left: target.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold text-[var(--vigil-muted)]">
        <span className="inline-flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5 text-[var(--vigil-accent)]" />
          Inline Edit
          <span className="font-normal">
            · L{target.startLine}
            {target.endLine !== target.startLine ? `–${target.endLine}` : ""}
          </span>
        </span>
        <button
          type="button"
          className="rounded p-0.5 hover:bg-[var(--vigil-hover)]"
          onClick={close}
          aria-label="Close inline edit"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={inputRef}
          value={instruction}
          disabled={busy}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          placeholder="Edit instruction… (e.g. extract function, add types)"
          className="min-w-0 flex-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-[12px] text-[var(--vigil-text)] outline-none focus:border-[var(--vigil-accent)]"
        />
        <button
          type="submit"
          disabled={busy || !instruction.trim()}
          className="shrink-0 rounded bg-[var(--vigil-accent)] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
        >
          {busy ? "…" : "Apply"}
        </button>
      </form>
      {error ? (
        <div className="mt-1.5 text-[11px] text-[var(--vigil-danger)]">{error}</div>
      ) : (
        <div className="mt-1 text-[10px] text-[var(--vigil-muted)]">
          Enter to apply · Esc to cancel · ⌘K / Ctrl+K
        </div>
      )}
    </div>
  );
}
