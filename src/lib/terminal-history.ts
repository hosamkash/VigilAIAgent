/** Shell-style command history for up/down arrow recall. */

export const TERMINAL_HISTORY_LIMIT = 200;

export function pushCommandHistory(
  history: string[],
  command: string,
  limit = TERMINAL_HISTORY_LIMIT,
): string[] {
  const line = command.trim();
  if (!line) return history;
  if (history[history.length - 1] === line) return history;
  const next = [...history, line];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * Move through history like bash.
 * `index` is -1 while editing a fresh draft; otherwise an index into `history`.
 */
export function stepCommandHistory(
  history: string[],
  index: number,
  direction: "up" | "down",
  draft: string,
): { index: number; value: string; draft: string } {
  if (history.length === 0) {
    return { index: -1, value: draft, draft };
  }

  if (direction === "up") {
    if (index < 0) {
      return {
        index: history.length - 1,
        value: history[history.length - 1]!,
        draft,
      };
    }
    if (index === 0) {
      return { index: 0, value: history[0]!, draft };
    }
    return {
      index: index - 1,
      value: history[index - 1]!,
      draft,
    };
  }

  if (index < 0) {
    return { index: -1, value: draft, draft };
  }
  if (index >= history.length - 1) {
    return { index: -1, value: draft, draft };
  }
  return {
    index: index + 1,
    value: history[index + 1]!,
    draft,
  };
}
