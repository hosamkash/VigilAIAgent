import { create } from "zustand";

export interface EditorCaret {
  line: number;
  column: number;
  tabSize: number;
  insertSpaces: boolean;
  eol: "LF" | "CRLF";
}

interface EditorStatusState {
  caret: EditorCaret | null;
  setCaret: (caret: EditorCaret) => void;
  clear: () => void;
}

export const useEditorStatusStore = create<EditorStatusState>((set) => ({
  caret: null,
  setCaret: (caret) => set({ caret }),
  clear: () => set({ caret: null }),
}));
