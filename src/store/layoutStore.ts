import { create } from "zustand";
import {
  DEFAULT_LAYOUT,
  loadLayoutSizes,
  loadTerminalHeightPx,
  saveLayoutSizes,
  saveTerminalHeightPx,
  type LayoutSizes,
} from "../lib/layout-persist";

export type SidebarView =
  | "explorer"
  | "search"
  | "scm"
  | "run"
  | "extensions"
  | "history";

export type BottomTab = "terminal" | "problems" | "output";

interface LayoutState {
  sidebarView: SidebarView;
  sidebarVisible: boolean;
  bottomVisible: boolean;
  bottomTab: BottomTab;
  bottomHeight: number;
  chatWidth: number;
  layoutSizes: LayoutSizes;
  setSidebarView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  toggleBottom: () => void;
  setBottomTab: (tab: BottomTab) => void;
  setBottomHeight: (h: number) => void;
  setChatWidth: (w: number) => void;
  setHorizontalSizes: (percents: [number, number, number]) => void;
  setVerticalSizes: (percents: [number, number], terminalPx?: number) => void;
  resetLayout: () => void;
  initLayout: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarView: "explorer",
  sidebarVisible: true,
  bottomVisible: true,
  bottomTab: "terminal",
  bottomHeight: loadTerminalHeightPx(220),
  chatWidth: 360,
  layoutSizes: loadLayoutSizes(),
  setSidebarView: (sidebarView) =>
    set((s) => ({
      sidebarView,
      sidebarVisible:
        s.sidebarView === sidebarView ? !s.sidebarVisible : true,
    })),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleBottom: () => set((s) => ({ bottomVisible: !s.bottomVisible })),
  setBottomTab: (bottomTab) => set({ bottomTab, bottomVisible: true }),
  setBottomHeight: (bottomHeight) => {
    const h = Math.min(480, Math.max(120, bottomHeight));
    saveTerminalHeightPx(h);
    set({ bottomHeight: h });
  },
  setChatWidth: (chatWidth) =>
    set({ chatWidth: Math.min(560, Math.max(280, chatWidth)) }),
  setHorizontalSizes: (horizontal) =>
    set((s) => {
      const layoutSizes = { ...s.layoutSizes, horizontal };
      saveLayoutSizes(layoutSizes);
      return { layoutSizes };
    }),
  setVerticalSizes: (vertical, terminalPx) =>
    set((s) => {
      const layoutSizes = { ...s.layoutSizes, vertical };
      saveLayoutSizes(layoutSizes);
      if (typeof terminalPx === "number") {
        saveTerminalHeightPx(terminalPx);
        return { layoutSizes, bottomHeight: terminalPx };
      }
      return { layoutSizes };
    }),
  resetLayout: () => {
    saveLayoutSizes(DEFAULT_LAYOUT);
    saveTerminalHeightPx(220);
    set({
      layoutSizes: { ...DEFAULT_LAYOUT },
      bottomHeight: 220,
    });
  },
  initLayout: () => {
    set({
      layoutSizes: loadLayoutSizes(),
      bottomHeight: loadTerminalHeightPx(220),
    });
  },
}));
