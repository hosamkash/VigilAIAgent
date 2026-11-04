import { create } from "zustand";
import {
  estimateUsage,
  formatUsd,
  sumUsage,
  type UsageSnapshot,
} from "../lib/cost";
import { insertUsageLog, listUsageLogs } from "../lib/db";

interface CostState {
  sessionUsages: UsageSnapshot[];
  logs: Awaited<ReturnType<typeof listUsageLogs>>;
  sessionTotal: UsageSnapshot;
  recordUsage: (
    usage: UsageSnapshot,
    sessionId?: string,
  ) => Promise<void>;
  recordEstimate: (
    prompt: string,
    response: string,
    provider?: string,
    model?: string,
    sessionId?: string,
  ) => Promise<UsageSnapshot>;
  refreshLogs: () => Promise<void>;
  clearSession: () => void;
}

export const useCostStore = create<CostState>((set, get) => ({
  sessionUsages: [],
  logs: [],
  sessionTotal: { inputTokens: 0, outputTokens: 0, cost: 0 },
  recordUsage: async (usage, sessionId) => {
    set((s) => {
      const sessionUsages = [...s.sessionUsages, usage];
      return {
        sessionUsages,
        sessionTotal: sumUsage(sessionUsages),
      };
    });
    try {
      await insertUsageLog({ usage, sessionId });
      await get().refreshLogs();
    } catch {
      /* browser preview */
    }
  },
  recordEstimate: async (prompt, response, provider, model, sessionId) => {
    const usage = {
      ...estimateUsage(prompt, response, provider),
      model,
    };
    await get().recordUsage(usage, sessionId);
    return usage;
  },
  refreshLogs: async () => {
    try {
      const logs = await listUsageLogs();
      set({ logs });
    } catch {
      set({ logs: [] });
    }
  },
  clearSession: () =>
    set({
      sessionUsages: [],
      sessionTotal: { inputTokens: 0, outputTokens: 0, cost: 0 },
    }),
}));

export { formatUsd };
