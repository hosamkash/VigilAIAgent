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
  /** True after the user renames the tab by hand. */
  titleCustom?: boolean;
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
  renameTab: (id: string, title: string, custom?: boolean) => void;
  renameHistoryItem: (id: string, title: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  closeOtherTabs: (id: string) => Promise<void>;
  closeAllTabs: () => Promise<void>;
  restoreFromHistory: (id: string) => Promise<void>;
  deleteFromHistory: (id: string) => Promise<void>;
  updateActiveMessages: (messages: ChatMessage[]) => void;
  updateTabMessages: (tabId: string, messages: ChatMessage[]) => void;
  setActiveDraft: (draft: string) => void;
  persistActive: () => Promise<void>;
  persistTab: (tabId: string) => Promise<void>;
}

function blankTab(title = "Chat"): ChatTab {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: title.trim() || "Chat",
    messages: [],
    draft: "",
    archived: false,
    titleCustom: false,
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
  titleCustom?: boolean;
  createdAt: number;
  updatedAt: number;
}): ChatTab {
  return {
    id: doc.id,
    title: (doc.title ?? "").trim() || "Chat",
    sessionId: doc.id,
    messages: doc.messages as ChatMessage[],
    draft: doc.draft ?? "",
    archived: doc.archived,
    titleCustom: doc.titleCustom,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

const initialTab = blankTab("Chat");

/** Open tab first, then a closed chat still kept in history. */
export function findChatByRequestId(id: string): ChatTab | undefined {
  const key = id.toLowerCase();
  const { tabs, history } = useTabsStore.getState();
  return (
    tabs.find((tab) => tab.id.toLowerCase() === key) ??
    history.find((tab) => tab.id.toLowerCase() === key)
  );
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  history: [],
  hydrated: false,
  hydrateError: null,

  hydrate: async () => {
    if (get().hydrated) return;
    const before = get().tabs;
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
      // Keep tabs the user opened while hydrate was still loading.
      const known = new Set(open.map((tab) => tab.id));
      const liveExtra = get().tabs.filter((tab) => !known.has(tab.id));
      const tabs = open.length > 0 ? [...open, ...liveExtra] : liveExtra.length > 0 ? liveExtra : [blankTab("Chat")];
      const preferred =
        get().activeTabId && tabs.some((tab) => tab.id === get().activeTabId)
          ? get().activeTabId
          : before.some((tab) => tabs.some((item) => item.id === tab.id))
            ? before[before.length - 1]?.id ?? tabs[0]!.id
            : tabs[0]!.id;

      set({
        tabs,
        activeTabId: preferred,
        history,
        hydrated: true,
        hydrateError: null,
      });
    } catch (err) {
      const tab = get().tabs[0] ?? blankTab("Chat");
      set({
        tabs: get().tabs.length > 0 ? get().tabs : [tab],
        activeTabId: get().activeTabId ?? tab.id,
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
      titleCustom: false,
      createdAt: tab.createdAt,
      updatedAt: tab.updatedAt,
    }).catch(() => undefined);
    return tab.id;
  },

  setActive: (activeTabId) => set({ activeTabId }),

  renameTab: (id, title, custom = true) => {
    const next = title.trim().replace(/\s+/g, " ") || "Chat";
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, title: next, titleCustom: custom ? true : t.titleCustom }
          : t,
      ),
    }));
    const tab = get().tabs.find((t) => t.id === id);
    if (tab) {
      void upsertChatSessionDoc({
        id: tab.id,
        title: next,
        messages: tab.messages,
        archived: false,
        draft: tab.draft,
        titleCustom: tab.titleCustom,
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
          titleCustom: tab.titleCustom,
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

  closeOtherTabs: async (id) => {
    const others = get()
      .tabs.filter((tab) => tab.id !== id)
      .map((tab) => tab.id);
    for (const tabId of others) await get().closeTab(tabId);
    if (get().tabs.some((tab) => tab.id === id)) set({ activeTabId: id });
  },

  closeAllTabs: async () => {
    const ids = get().tabs.map((tab) => tab.id);
    for (const tabId of ids) await get().closeTab(tabId);
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
        titleCustom: item.titleCustom,
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
        titleCustom: tab.titleCustom,
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
