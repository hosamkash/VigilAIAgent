import { create } from "zustand";
import { pushCommandHistory } from "../lib/terminal-history";

export interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
  history: string;
}

export type PendingTerminalMode = "write" | "execute" | "prompt";

export type PendingTerminalRun = {
  id: string;
  command: string;
  cwd: string;
  mode: PendingTerminalMode;
};

interface TerminalState {
  terminals: TerminalSession[];
  activeId: string | null;
  problems: string[];
  output: string;
  /** Previously run shell commands for ↑ / ↓ recall. */
  commands: string[];
  pendingRun: PendingTerminalRun | null;
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
  rememberCommand: (command: string) => void;
  /** Queue a terminal action and resolve after the panel handles it. */
  enqueueTerminalJob: (
    command: string,
    cwd: string,
    mode: PendingTerminalMode,
  ) => Promise<void>;
  clearPendingRun: (id?: string) => void;
  /** Called by the terminal panel after applying a pending job. */
  resolvePendingRun: (id: string) => void;
}

const COMMANDS_KEY = "vigil.terminal.commands";

function loadCommands(): string[] {
  try {
    const raw = localStorage.getItem(COMMANDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function saveCommands(commands: string[]) {
  try {
    localStorage.setItem(COMMANDS_KEY, JSON.stringify(commands));
  } catch {
    /* Ignore quota / private mode. */
  }
}

let termCount = 0;
const pendingWaiters = new Map<string, () => void>();

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: [],
  activeId: null,
  problems: [],
  output: "",
  commands: loadCommands(),
  pendingRun: null,
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
  rememberCommand: (command) => {
    const commands = pushCommandHistory(get().commands, command);
    if (commands === get().commands) return;
    saveCommands(commands);
    set({ commands });
  },
  enqueueTerminalJob: (command, cwd, mode) =>
    new Promise<void>((resolve) => {
      const id = crypto.randomUUID();
      const finish = () => {
        window.clearTimeout(timer);
        pendingWaiters.delete(id);
        resolve();
      };
      const timer = window.setTimeout(finish, 8000);
      pendingWaiters.set(id, finish);
      set({
        pendingRun: {
          id,
          command,
          cwd,
          mode,
        },
      });
    }),
  clearPendingRun: (id) =>
    set((s) => {
      if (!s.pendingRun) return s;
      if (id && s.pendingRun.id !== id) return s;
      return { pendingRun: null };
    }),
  resolvePendingRun: (id) => {
    const waiter = pendingWaiters.get(id);
    set((s) => {
      if (!s.pendingRun || s.pendingRun.id !== id) return s;
      return { pendingRun: null };
    });
    waiter?.();
  },
}));
