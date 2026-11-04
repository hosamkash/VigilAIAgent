import { create } from "zustand";
import type { LlmProviderId } from "../lib/model-router";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  modelLabel?: string;
}

interface ChatState {
  messages: ChatMessage[];
  draft: string;
  isRunning: boolean;
  preferredProvider: LlmProviderId;
  setDraft: (draft: string) => void;
  setPreferredProvider: (provider: LlmProviderId) => void;
  setRunning: (running: boolean) => void;
  appendMessage: (
    msg: Omit<ChatMessage, "id" | "createdAt"> & { id?: string },
  ) => string;
  updateMessage: (id: string, patch: Partial<Pick<ChatMessage, "content" | "modelLabel">>) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  draft: "",
  isRunning: false,
  preferredProvider: "gemini",
  setDraft: (draft) => set({ draft }),
  setPreferredProvider: (preferredProvider) => set({ preferredProvider }),
  setRunning: (isRunning) => set({ isRunning }),
  appendMessage: (msg) => {
    const id = msg.id ?? crypto.randomUUID();
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          createdAt: Date.now(),
          role: msg.role,
          content: msg.content,
          modelLabel: msg.modelLabel,
        },
      ],
    }));
    return id;
  },
  updateMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    })),
  clearMessages: () => set({ messages: [] }),
}));
