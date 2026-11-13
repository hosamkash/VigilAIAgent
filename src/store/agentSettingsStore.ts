import { create } from "zustand";
import {
  DEFAULT_COMMAND_ALLOWLIST,
  DEFAULT_PATH_DENYLIST,
} from "../lib/agent-permissions";

const AUTO_RUN_KEY = "vigil.agent.autoRun";
const ALLOW_KEY = "vigil.agent.commandAllowlist";
const DENY_KEY = "vigil.agent.pathDenylist";
const CHAT_MODE_KEY = "vigil.agent.chatMode";
const AUTO_SUGGEST_PLAN_KEY = "vigil.agent.autoSuggestPlanMode";

/** Agent = code. Plan = draft plan (no writes). Ask = discuss / Q&A (no writes). */
export type AgentChatMode = "agent" | "plan" | "ask";

function loadAutoSuggestPlanMode(): boolean {
  try {
    const v = localStorage.getItem(AUTO_SUGGEST_PLAN_KEY);
    if (v === "0") return false;
    return true;
  } catch {
    return true;
  }
}

function loadAutoRun(): boolean {
  try {
    return localStorage.getItem(AUTO_RUN_KEY) === "1";
  } catch {
    return false;
  }
}

function loadChatMode(): AgentChatMode {
  try {
    const v = localStorage.getItem(CHAT_MODE_KEY);
    if (v === "plan" || v === "ask") return v;
    return "agent";
  } catch {
    return "agent";
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
  /**
   * Agent = coding. Plan = investigate/draft until Execute. Ask = Q&A/discuss, no edits
   * (write tools blocked in sidecar for plan + ask).
   */
  chatMode: AgentChatMode;
  /** Offer to switch Agent → Plan when the prompt looks like a large multi-step task. */
  autoSuggestPlanMode: boolean;
  /** Commands that auto-approve even when Auto-run is off (globish). */
  commandAllowlist: string[];
  /** Paths that always require confirmation for writes (even with Auto-run). */
  pathDenylist: string[];
  setAgentAutoRun: (value: boolean) => void;
  setChatMode: (value: AgentChatMode) => void;
  setAutoSuggestPlanMode: (value: boolean) => void;
  setCommandAllowlist: (value: string[]) => void;
  setPathDenylist: (value: string[]) => void;
}

export const useAgentSettingsStore = create<AgentSettingsState>((set) => ({
  agentAutoRun: loadAutoRun(),
  chatMode: loadChatMode(),
  autoSuggestPlanMode: loadAutoSuggestPlanMode(),
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
  setChatMode: (chatMode) => {
    try {
      localStorage.setItem(CHAT_MODE_KEY, chatMode);
    } catch {
      /* ignore */
    }
    set({ chatMode });
  },
  setAutoSuggestPlanMode: (autoSuggestPlanMode) => {
    try {
      localStorage.setItem(
        AUTO_SUGGEST_PLAN_KEY,
        autoSuggestPlanMode ? "1" : "0",
      );
    } catch {
      /* ignore */
    }
    set({ autoSuggestPlanMode });
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
