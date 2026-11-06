import { create } from "zustand";
import type { ChatMessage } from "./chatStore";
import { listChatSessions } from "../lib/db";
import {
  deleteChatSessionDoc,
  listChatSessionDocs,
  migrateSqliteChatsIfNeeded,
  upsertChatSessionDoc,
} from "../lib/vigil-db/chat-history";

export interface ChatTab {
  id: string;
  title: string;
  sessionId?: string;
  messages: ChatMessage[];
  draft: string;
  archived: boolean;
  updatedAt?: number;
  createdAt?: number;
}

interface TabsState {
  tabs: ChatTab[];
  activeTabId: string | null;
  history: ChatTab[];
  hydrated: boolean;
  hydrateError: string | null;
  hydrate: () => Promise<void>;
  newTab: (title?: string) => string;
  setActive: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  renameHistoryItem: (id: string, title: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  restoreFromHistory: (id: string) => Promise<void>;
  deleteFromHistory: (id: string) => Promise<void>;
  updateActiveMessages: (messages: ChatMessage[]) => void;
  updateTabMessages: (tabId: string, messages: ChatMessage[]) => void;
  setActiveDraft: (draft: string) => void;
  persistActive: () => Promise<void>;
  persistTab: (tabId: string) => Promise<void>;
}

function blankTab(title = "New Chat"): ChatTab {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    messages: [],
    draft: "",
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

function docToTab(doc: {
  id: string;
  title: string;
  messages: unknown[];
  archived: boolean;
  draft?: string;
  createdAt: number;
  updatedAt: number;
}): ChatTab {
  return {
    id: doc.id,
    title: doc.title,
    sessionId: doc.id,
    messages: doc.messages as ChatMessage[],
    draft: doc.draft ?? "",
    archived: doc.archived,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

const initialTab = blankTab("Chat");

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  history: [],
  hydrated: false,
  hydrateError: null,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      // Prefer VigilDB; migrate from SQLite once if VigilDB has no chats yet
      try {
        const sqliteRows = await listChatSessions(true);
        await migrateSqliteChatsIfNeeded(
          sqliteRows.map((r) => ({
            id: r.id,
            title: r.title,
            messagesJson: r.messagesJson,
            archived: r.archived,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
        );
      } catch {
        /* sqlite may be unavailable in browser preview */
      }

      const docs = await listChatSessionDocs();
      const open = docs.filter((d) => !d.archived).map(docToTab);
      const history = docs.filter((d) => d.archived).map(docToTab);

      if (open.length) {
        set({
          tabs: open,
          activeTabId: open[0]!.id,
          history,
          hydrated: true,
          hydrateError: null,
        });
      } else {
        const tab = blankTab("Chat");
        set({
          tabs: [tab],
          activeTabId: tab.id,
          history,
          hydrated: true,
          hydrateError: null,
        });
      }
    } catch (err) {
      const tab = get().tabs[0] ?? blankTab("Chat");
      set({
        tabs: [tab],
        activeTabId: tab.id,
        hydrated: true,
        hydrateError: String(err),
      });
    }
  },

  newTab: (title) => {
    const tab = blankTab(title);
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
    void upsertChatSessionDoc({
      id: tab.id,
      title: tab.title,
      messages: [],
      archived: false,
      draft: "",
      createdAt: tab.createdAt,
      updatedAt: tab.updatedAt,
    }).catch(() => undefined);
    return tab.id;
  },

  setActive: (activeTabId) => set({ activeTabId }),

  renameTab: (id, title) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
    const tab = get().tabs.find((t) => t.id === id);
    if (tab) {
      void upsertChatSessionDoc({
        id: tab.id,
        title,
        messages: tab.messages,
        archived: false,
        draft: tab.draft,
        createdAt: tab.createdAt,
        updatedAt: Date.now(),
      }).catch(() => undefined);
    }
  },

  renameHistoryItem: async (id, title) => {
    const item = get().history.find((h) => h.id === id);
    if (!item) return;
    const updatedAt = Date.now();
    set((s) => ({
      history: s.history.map((x) =>
        x.id === id ? { ...x, title, updatedAt } : x,
      ),
    }));
    await upsertChatSessionDoc({
      id,
      title,
      messages: item.messages,
      archived: true,
      draft: item.draft,
      createdAt: item.createdAt,
      updatedAt,
    });
  },

  closeTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    const updatedAt = Date.now();
    if (tab) {
      try {
        await upsertChatSessionDoc({
          id: tab.id,
          title: tab.title,
          messages: tab.messages,
          archived: true,
          draft: tab.draft,
          createdAt: tab.createdAt,
          updatedAt,
        });
      } catch {
        /* preview */
      }
    }
    set((s) => {
      const closing = s.tabs.find((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      const history = closing
        ? [
            { ...closing, archived: true, updatedAt },
            ...s.history.filter((h) => h.id !== id),
          ]
        : s.history;
      const next = tabs.length > 0 ? tabs : [blankTab("Chat")];
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

  restoreFromHistory: async (id) => {
    const item = get().history.find((h) => h.id === id);
    if (!item) return;
    const updatedAt = Date.now();
    set((s) => ({
      tabs: [...s.tabs, { ...item, archived: false, updatedAt }],
      history: s.history.filter((h) => h.id !== id),
      activeTabId: item.id,
    }));
    try {
      await upsertChatSessionDoc({
        id: item.id,
        title: item.title,
        messages: item.messages,
        archived: false,
        draft: item.draft,
        createdAt: item.createdAt,
        updatedAt,
      });
    } catch {
      /* preview */
    }
  },

  deleteFromHistory: async (id) => {
    set((s) => ({ history: s.history.filter((h) => h.id !== id) }));
    try {
      await deleteChatSessionDoc(id);
    } catch {
      /* preview */
    }
  },

  updateActiveMessages: (messages) => {
    const id = get().activeTabId;
    if (!id) return;
    get().updateTabMessages(id, messages);
  },

  updateTabMessages: (tabId, messages) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, messages, updatedAt: Date.now() } : t,
      ),
    })),

  setActiveDraft: (draft) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, draft } : t,
      ),
    })),

  persistTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    try {
      await upsertChatSessionDoc({
        id: tab.id,
        title: tab.title,
        messages: tab.messages,
        archived: false,
        draft: tab.draft,
        createdAt: tab.createdAt,
        updatedAt: Date.now(),
      });
    } catch {
      /* ignore in browser */
    }
  },

  persistActive: async () => {
    const id = get().activeTabId;
    if (id) await get().persistTab(id);
  },
}));
