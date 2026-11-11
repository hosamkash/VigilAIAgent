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
  });
});
