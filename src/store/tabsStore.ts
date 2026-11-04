import { create } from "zustand";
import type { ChatMessage } from "./chatStore";
import {
  deleteChatSession,
  listChatSessions,
  upsertChatSession,
} from "../lib/db";

export interface ChatTab {
  id: string;
  title: string;
  sessionId?: string;
  messages: ChatMessage[];
  draft: string;
  archived: boolean;
  updatedAt?: number;
}

interface TabsState {
  tabs: ChatTab[];
  activeTabId: string | null;
  history: ChatTab[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  newTab: (title?: string) => string;
  setActive: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  closeTab: (id: string) => Promise<void>;
  restoreFromHistory: (id: string) => void;
  deleteFromHistory: (id: string) => Promise<void>;
  updateActiveMessages: (messages: ChatMessage[]) => void;
  setActiveDraft: (draft: string) => void;
  persistActive: () => Promise<void>;
}

function blankTab(title = "New Chat"): ChatTab {
  return {
    id: crypto.randomUUID(),
    title,
    messages: [],
    draft: "",
    archived: false,
  };
}

const initialTab = blankTab("Chat");

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  history: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const rows = await listChatSessions(true);
      const open = rows
        .filter((r) => !r.archived)
        .map((r) => ({
          id: r.id,
          title: r.title,
          sessionId: r.id,
          messages: JSON.parse(r.messagesJson || "[]") as ChatMessage[],
          draft: "",
          archived: false,
        }));
      const history = rows
        .filter((r) => r.archived)
        .map((r) => ({
          id: r.id,
          title: r.title,
          sessionId: r.id,
          messages: JSON.parse(r.messagesJson || "[]") as ChatMessage[],
          draft: "",
          archived: true,
          updatedAt: r.updatedAt,
        }));
      if (open.length) {
        set({
          tabs: open,
          activeTabId: open[0]!.id,
          history,
          hydrated: true,
        });
      } else {
        const tab = blankTab("Chat");
        set({
          tabs: [tab],
          activeTabId: tab.id,
          history,
          hydrated: true,
        });
      }
    } catch {
      const tab = get().tabs[0] ?? blankTab("Chat");
      set({
        tabs: [tab],
        activeTabId: tab.id,
        hydrated: true,
      });
    }
  },
  newTab: (title) => {
    const tab = blankTab(title);
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
    return tab.id;
  },
  setActive: (activeTabId) => set({ activeTabId }),
  renameTab: (id, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    })),
  closeTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (tab) {
      try {
        await upsertChatSession({
          id: tab.id,
          title: tab.title,
          messagesJson: JSON.stringify(tab.messages),
          archived: true,
        });
      } catch {
        /* browser preview */
      }
    }
    set((s) => {
      const closing = s.tabs.find((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      const history = closing
        ? [{ ...closing, archived: true }, ...s.history]
        : s.history;
      const next =
        tabs.length > 0
          ? tabs
          : [blankTab("Chat")];
      return {
        tabs: next,
        history,
        activeTabId:
          s.activeTabId === id
            ? (next[next.length - 1]?.id ?? null)
            : s.activeTabId,
      };
    });
  },
  restoreFromHistory: (id) => {
    const item = get().history.find((h) => h.id === id);
    if (!item) return;
    set((s) => ({
      tabs: [...s.tabs, { ...item, archived: false }],
      history: s.history.filter((h) => h.id !== id),
      activeTabId: item.id,
    }));
    void upsertChatSession({
      id: item.id,
      title: item.title,
      messagesJson: JSON.stringify(item.messages),
      archived: false,
    }).catch(() => undefined);
  },
  deleteFromHistory: async (id) => {
    set((s) => ({ history: s.history.filter((h) => h.id !== id) }));
    try {
      await deleteChatSession(id);
    } catch {
      /* browser */
    }
  },
  updateActiveMessages: (messages) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, messages } : t,
      ),
    })),
  setActiveDraft: (draft) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, draft } : t,
      ),
    })),
  persistActive: async () => {
    const { activeTabId, tabs } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    try {
      await upsertChatSession({
        id: tab.id,
        title: tab.title,
        messagesJson: JSON.stringify(tab.messages),
        archived: false,
      });
    } catch {
      /* ignore in browser */
    }
  },
}));
