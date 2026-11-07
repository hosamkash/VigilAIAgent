import { describe, expect, it } from "vitest";
import { resolveTerminalShortcut } from "./terminal-shortcuts";

function key(
  partial: Partial<{
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }>,
) {
  return {
    type: "keydown" as const,
    key: "a",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

describe("resolveTerminalShortcut", () => {
  it("selects all with Ctrl/Cmd+A", () => {
    expect(resolveTerminalShortcut(key({ key: "a", ctrlKey: true }), false)).toEqual({
      action: "selectAll",
    });
    expect(resolveTerminalShortcut(key({ key: "a", metaKey: true }), false)).toEqual({
      action: "selectAll",
    });
  });

  it("copies with Ctrl/Cmd+C when there is a selection", () => {
    expect(resolveTerminalShortcut(key({ key: "c", ctrlKey: true }), true)).toEqual({
      action: "copy",
    });
  });

  it("interrupts with Ctrl+C when nothing is selected", () => {
    expect(resolveTerminalShortcut(key({ key: "c", ctrlKey: true }), false)).toEqual({
      action: "interrupt",
    });
  });

  it("swallows Cmd+C when nothing is selected", () => {
    expect(resolveTerminalShortcut(key({ key: "c", metaKey: true }), false)).toEqual({
      action: "swallow",
    });
  });

  it("pastes with Ctrl/Cmd+V", () => {
    expect(resolveTerminalShortcut(key({ key: "v", ctrlKey: true }), false)).toEqual({
      action: "paste",
    });
  });
});
