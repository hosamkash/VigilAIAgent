/**
 * Pointer-based explorer → chat drag (not HTML5 DnD).
 * Tauri/WKWebView does not reliably deliver drop events across panes.
 */

import { create } from "zustand";
import type { VigilExplorerDragItem } from "./explorer-dnd";

const DRAG_THRESHOLD_PX = 5;
const DRAG_UI_CLASS = "vigil-explorer-dragging";

let selectLockInstalled = false;

function onSelectStart(event: Event) {
  event.preventDefault();
}

function clearDomSelection() {
  try {
    window.getSelection()?.removeAllRanges();
  } catch {
    /* ignore */
  }
}

/** Block webpage-style text selection while dragging across panes (esp. Monaco). */
export function lockExplorerDragUi() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.add(DRAG_UI_CLASS);
  clearDomSelection();
  if (!selectLockInstalled) {
    document.addEventListener("selectstart", onSelectStart, true);
    selectLockInstalled = true;
  }
}

export function unlockExplorerDragUi() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove(DRAG_UI_CLASS);
  if (selectLockInstalled) {
    document.removeEventListener("selectstart", onSelectStart, true);
    selectLockInstalled = false;
  }
  clearDomSelection();
}

type ExplorerDragState = {
  items: VigilExplorerDragItem[];
  active: boolean;
  /** True once the pointer moved past the threshold. */
  dragging: boolean;
  x: number;
  y: number;
  overComposer: boolean;
  startX: number;
  startY: number;
  beginPointer: (items: VigilExplorerDragItem[], x: number, y: number) => void;
  movePointer: (x: number, y: number, overComposer: boolean) => void;
  endPointer: () => VigilExplorerDragItem[];
  cancel: () => void;
};

export const useExplorerDragStore = create<ExplorerDragState>((set, get) => ({
  items: [],
  active: false,
  dragging: false,
  x: 0,
  y: 0,
  overComposer: false,
  startX: 0,
  startY: 0,
  beginPointer: (items, x, y) => {
    if (items.length === 0) return;
    set({
      items: items.map((item) => ({ ...item })),
      active: true,
      dragging: false,
      x,
      y,
      startX: x,
      startY: y,
      overComposer: false,
    });
  },
  movePointer: (x, y, overComposer) => {
    const state = get();
    if (!state.active) return;
    const dist = Math.hypot(x - state.startX, y - state.startY);
    const dragging = state.dragging || dist >= DRAG_THRESHOLD_PX;
    if (dragging && !state.dragging) lockExplorerDragUi();
    if (dragging) clearDomSelection();
    set({
      x,
      y,
      overComposer,
      dragging,
    });
  },
  endPointer: () => {
    const state = get();
    const items =
      state.active && state.dragging && state.overComposer
        ? state.items.slice()
        : [];
    unlockExplorerDragUi();
    set({
      items: [],
      active: false,
      dragging: false,
      overComposer: false,
      x: 0,
      y: 0,
      startX: 0,
      startY: 0,
    });
    return items;
  },
  cancel: () => {
    unlockExplorerDragUi();
    set({
      items: [],
      active: false,
      dragging: false,
      overComposer: false,
      x: 0,
      y: 0,
      startX: 0,
      startY: 0,
    });
  },
}));

export function isOverChatComposer(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  return Boolean(el.closest("[data-chat-composer]"));
}

/** Hit-test composer under the cursor (elementsFromPoint ignores the ghost). */
export function isComposerUnderPoint(x: number, y: number): boolean {
  if (typeof document === "undefined") return false;
  const stack = document.elementsFromPoint(x, y);
  return stack.some((node) => {
    const el = node as HTMLElement;
    return Boolean(el.closest?.("[data-chat-composer]"));
  });
}
