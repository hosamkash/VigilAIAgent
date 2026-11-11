import { create } from "zustand";
import {
  DEFAULT_COMMAND_ALLOWLIST,
  DEFAULT_PATH_DENYLIST,
} from "../lib/agent-permissions";

const AUTO_RUN_KEY = "vigil.agent.autoRun";
const ALLOW_KEY = "vigil.agent.commandAllowlist";
const DENY_KEY = "vigil.agent.pathDenylist";

function loadAutoRun(): boolean {
  try {
    return localStorage.getItem(AUTO_RUN_KEY) === "1";
  } catch {
    return false;
  }
}

function loadStringList(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...fallback];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...fallback];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [...fallback];
  }
}

function saveStringList(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

interface AgentSettingsState {
  /** When true, tools run without confirmation (Cursor-like Auto-run / yolo). */
  agentAutoRun: boolean;
  /** Commands that auto-approve even when Auto-run is off (globish). */
  commandAllowlist: string[];
  /** Paths that always require confirmation for writes (even with Auto-run). */
  pathDenylist: string[];
  setAgentAutoRun: (value: boolean) => void;
  setCommandAllowlist: (value: string[]) => void;
  setPathDenylist: (value: string[]) => void;
}

export const useAgentSettingsStore = create<AgentSettingsState>((set) => ({
  agentAutoRun: loadAutoRun(),
  commandAllowlist: loadStringList(ALLOW_KEY, DEFAULT_COMMAND_ALLOWLIST),
  pathDenylist: loadStringList(DENY_KEY, DEFAULT_PATH_DENYLIST),
  setAgentAutoRun: (agentAutoRun) => {
    try {
      localStorage.setItem(AUTO_RUN_KEY, agentAutoRun ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ agentAutoRun });
  },
  setCommandAllowlist: (commandAllowlist) => {
    const cleaned = commandAllowlist.map((s) => s.trim()).filter(Boolean);
    saveStringList(ALLOW_KEY, cleaned);
    set({ commandAllowlist: cleaned });
  },
  setPathDenylist: (pathDenylist) => {
    const cleaned = pathDenylist.map((s) => s.trim()).filter(Boolean);
    saveStringList(DENY_KEY, cleaned);
    set({ pathDenylist: cleaned });
  },
}));
