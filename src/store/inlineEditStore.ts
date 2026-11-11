import { create } from "zustand";

export type InlineEditTarget = {
  path: string;
  language: string;
  text: string;
  startLine: number;
  endLine: number;
  before: string;
  after: string;
  /** Overlay anchor inside the editor host. */
  top: number;
  left: number;
};

interface InlineEditState {
  open: boolean;
  busy: boolean;
  error: string | null;
  instruction: string;
  target: InlineEditTarget | null;
  openAt: (target: InlineEditTarget) => void;
  setInstruction: (instruction: string) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  close: () => void;
}

export const useInlineEditStore = create<InlineEditState>((set) => ({
  open: false,
  busy: false,
  error: null,
  instruction: "",
  target: null,
  openAt: (target) =>
    set({
      open: true,
      busy: false,
      error: null,
      instruction: "",
      target,
    }),
  setInstruction: (instruction) => set({ instruction }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  close: () =>
    set({
      open: false,
      busy: false,
      error: null,
      instruction: "",
      target: null,
    }),
}));
