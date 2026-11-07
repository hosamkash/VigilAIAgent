/** OS-style edit shortcuts for the terminal (⌘/Ctrl+A/C/V). */

export type TerminalShortcut =
  | { action: "selectAll" }
  | { action: "copy" }
  | { action: "paste" }
  | { action: "interrupt" }
  | { action: "swallow" };

type ShortcutEvent = Pick<
  KeyboardEvent,
  "type" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

/**
 * Map a keydown to a terminal edit action.
 * Cmd (macOS) or Ctrl (any OS) + A/C/V — same idea as a normal text field.
 * Ctrl+C with no selection stays interrupt (SIGINT), like a real shell.
 */
export function resolveTerminalShortcut(
  event: ShortcutEvent,
  hasSelection: boolean,
): TerminalShortcut | null {
  if (event.type !== "keydown") return null;
  if (event.altKey || event.shiftKey) return null;
  if (!event.metaKey && !event.ctrlKey) return null;
  // Ignore weird Cmd+Ctrl chords.
  if (event.metaKey && event.ctrlKey) return null;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === "a") return { action: "selectAll" };
  if (key === "v") return { action: "paste" };
  if (key === "c") {
    if (hasSelection) return { action: "copy" };
    if (event.ctrlKey) return { action: "interrupt" };
    return { action: "swallow" };
  }
  return null;
}
