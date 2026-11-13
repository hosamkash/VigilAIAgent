import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
});

const { useAgentSettingsStore } = await import("./agentSettingsStore");

describe("agentSettingsStore", () => {
  beforeEach(() => {
    memory.clear();
    useAgentSettingsStore.setState({
      agentAutoRun: false,
      chatMode: "agent",
      autoSuggestPlanMode: true,
      commandAllowlist: ["npm test"],
      pathDenylist: [".env"],
    });
  });

  it("defaults Auto-run to off", () => {
    expect(useAgentSettingsStore.getState().agentAutoRun).toBe(false);
  });

  it("persists Auto-run to localStorage", () => {
    useAgentSettingsStore.getState().setAgentAutoRun(true);
    expect(memory.get("vigil.agent.autoRun")).toBe("1");
    expect(useAgentSettingsStore.getState().agentAutoRun).toBe(true);

    useAgentSettingsStore.getState().setChatMode("plan");
    expect(memory.get("vigil.agent.chatMode")).toBe("plan");
    expect(useAgentSettingsStore.getState().chatMode).toBe("plan");
    useAgentSettingsStore.getState().setChatMode("ask");
    expect(memory.get("vigil.agent.chatMode")).toBe("ask");
    expect(useAgentSettingsStore.getState().chatMode).toBe("ask");
    useAgentSettingsStore.getState().setChatMode("agent");
    expect(useAgentSettingsStore.getState().chatMode).toBe("agent");

    useAgentSettingsStore.getState().setAutoSuggestPlanMode(false);
    expect(memory.get("vigil.agent.autoSuggestPlanMode")).toBe("0");
    expect(useAgentSettingsStore.getState().autoSuggestPlanMode).toBe(false);
  });
});
