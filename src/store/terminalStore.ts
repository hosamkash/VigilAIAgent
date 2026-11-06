import { create } from "zustand";

export interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
  history: string;
}

interface TerminalState {
  terminals: TerminalSession[];
  activeId: string | null;
  problems: string[];
  output: string;
  ensureDefault: (cwd: string) => void;
  addTerminal: (cwd: string) => void;
  closeTerminal: (id: string) => void;
  setActive: (id: string) => void;
  appendHistory: (id: string, chunk: string) => void;
  appendOutput: (chunk: string) => void;
  addProblem: (msg: string) => void;
  clearProblems: () => void;
  clearSignal: number;
  requestClear: () => void;
}

let termCount = 0;

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: [],
  activeId: null,
  problems: [],
  output: "",
  clearSignal: 0,
  ensureDefault: (cwd) => {
    if (get().terminals.length > 0) return;
    const id = crypto.randomUUID();
    termCount = 1;
    set({
      terminals: [{ id, title: "bash", cwd, history: `$ ready (${cwd})\n` }],
      activeId: id,
    });
  },
  addTerminal: (cwd) => {
    termCount += 1;
    const id = crypto.randomUUID();
    set((s) => ({
      terminals: [
        ...s.terminals,
        {
          id,
          title: `bash ${termCount}`,
          cwd,
          history: `$ ready (${cwd})\n`,
        },
      ],
      activeId: id,
    }));
  },
  closeTerminal: (id) =>
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id);
      return {
        terminals,
        activeId:
          s.activeId === id
            ? (terminals[terminals.length - 1]?.id ?? null)
            : s.activeId,
      };
    }),
  setActive: (activeId) => set({ activeId }),
  appendHistory: (id, chunk) =>
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id ? { ...t, history: `${t.history}${chunk}` } : t,
      ),
    })),
  appendOutput: (chunk) =>
    set((s) => ({ output: `${s.output}${chunk}` })),
  addProblem: (msg) => set((s) => ({ problems: [...s.problems, msg] })),
  clearProblems: () => set({ problems: [] }),
  requestClear: () =>
    set((s) => ({
      clearSignal: s.clearSignal + 1,
      terminals: s.terminals.map((t) =>
        t.id === s.activeId ? { ...t, history: "$ " } : t,
      ),
    })),
}));
