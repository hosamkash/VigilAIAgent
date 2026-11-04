import { create } from "zustand";

interface EditorState {
  original: string;
  modified: string;
  language: string;
  filePath: string | null;
  terminalOutput: string;
  setDiff: (original: string, modified: string, filePath?: string) => void;
  setLanguage: (language: string) => void;
  appendTerminal: (chunk: string) => void;
  clearTerminal: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  original: "// original\n",
  modified: "// modified — agent diffs appear here\n",
  language: "typescript",
  filePath: null,
  terminalOutput: "",
  setDiff: (original, modified, filePath) =>
    set({
      original,
      modified,
      filePath: filePath ?? null,
    }),
  setLanguage: (language) => set({ language }),
  appendTerminal: (chunk) =>
    set((s) => ({ terminalOutput: `${s.terminalOutput}${chunk}` })),
  clearTerminal: () => set({ terminalOutput: "" }),
}));
