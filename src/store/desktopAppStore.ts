import { create } from "zustand";

export type DesktopAppSession = {
  attached: boolean;
  pid: number | null;
  title: string | null;
  path: string | null;
};

type DesktopAppState = DesktopAppSession & {
  setSession: (partial: Partial<DesktopAppSession>) => void;
  clear: () => void;
};

const empty: DesktopAppSession = {
  attached: false,
  pid: null,
  title: null,
  path: null,
};

export const useDesktopAppStore = create<DesktopAppState>((set) => ({
  ...empty,
  setSession: (partial) => set((s) => ({ ...s, ...partial })),
  clear: () => set({ ...empty }),
}));
