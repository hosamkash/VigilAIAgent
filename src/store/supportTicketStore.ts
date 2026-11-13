import { create } from "zustand";
import {
  createEmptySupportTicket,
  formatSupportTicketMarkdown,
  normalizeSupportTicket,
  type SupportTicket,
  type SupportTicketStatus,
} from "../lib/support-ticket";
import {
  deleteSupportTicket,
  listSupportTickets,
  loadSupportTicket,
  saveSupportTicket,
} from "../lib/support-ticket-fs";
import { getWorkspaceCwd } from "../lib/secure-storage";

type SupportTicketState = {
  activeTicket: SupportTicket | null;
  recentTickets: SupportTicket[];
  panelOpen: boolean;
  showArchived: boolean;
  setPanelOpen: (open: boolean) => void;
  setShowArchived: (v: boolean) => void;
  setActiveTicket: (ticket: SupportTicket | null) => void;
  createDraft: (partial?: Partial<SupportTicket>) => Promise<SupportTicket>;
  applyDraftFromAgent: (
    raw: Partial<SupportTicket> | SupportTicket,
  ) => Promise<SupportTicket>;
  updateActive: (partial: Partial<SupportTicket>) => void;
  persistActive: () => Promise<void>;
  markReady: () => Promise<void>;
  refreshList: () => Promise<void>;
  openTicket: (id: string) => Promise<void>;
  archiveTicket: (id: string) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;
  copyActiveMarkdown: () => Promise<string>;
};

async function cwd(): Promise<string> {
  try {
    return (await getWorkspaceCwd()) || "";
  } catch {
    return "";
  }
}

export const useSupportTicketStore = create<SupportTicketState>((set, get) => ({
  activeTicket: null,
  recentTickets: [],
  panelOpen: false,
  showArchived: false,

  setPanelOpen: (open) => set({ panelOpen: open }),
  setShowArchived: (v) => set({ showArchived: v }),
  setActiveTicket: (ticket) =>
    set({ activeTicket: ticket ? normalizeSupportTicket(ticket) : null }),

  createDraft: async (partial) => {
    const root = await cwd();
    const ticket = createEmptySupportTicket({
      ...partial,
      workspaceRoot: root || undefined,
      status: "draft",
    });
    if (root) await saveSupportTicket(root, ticket);
    set({ activeTicket: ticket, panelOpen: true });
    await get().refreshList();
    return ticket;
  },

  applyDraftFromAgent: async (raw) => {
    const root = await cwd();
    const existing = get().activeTicket;
    const merged = normalizeSupportTicket({
      ...(existing || {}),
      ...raw,
      id: (raw as SupportTicket).id || existing?.id,
      status:
        ((raw as SupportTicket).status as SupportTicketStatus) ||
        existing?.status ||
        "draft",
      workspaceRoot: root || existing?.workspaceRoot,
      updatedAt: Date.now(),
    });
    if (root) await saveSupportTicket(root, merged);
    set({ activeTicket: merged, panelOpen: true });
    await get().refreshList();
    return merged;
  },

  updateActive: (partial) => {
    const cur = get().activeTicket;
    if (!cur) return;
    set({
      activeTicket: normalizeSupportTicket({
        ...cur,
        ...partial,
        updatedAt: Date.now(),
      }),
    });
  },

  persistActive: async () => {
    const ticket = get().activeTicket;
    const root = await cwd();
    if (!ticket || !root) return;
    const next = normalizeSupportTicket({
      ...ticket,
      updatedAt: Date.now(),
      workspaceRoot: root,
    });
    await saveSupportTicket(root, next);
    set({ activeTicket: next });
    await get().refreshList();
  },

  markReady: async () => {
    const ticket = get().activeTicket;
    if (!ticket) return;
    get().updateActive({ status: "ready" });
    await get().persistActive();
  },

  refreshList: async () => {
    const root = await cwd();
    if (!root) {
      set({ recentTickets: [] });
      return;
    }
    const list = await listSupportTickets(root, {
      includeArchived: get().showArchived,
    });
    set({ recentTickets: list });
  },

  openTicket: async (id) => {
    const root = await cwd();
    if (!root) return;
    const ticket = await loadSupportTicket(root, id);
    if (!ticket) return;
    set({ activeTicket: ticket, panelOpen: true });
  },

  archiveTicket: async (id) => {
    const root = await cwd();
    if (!root) return;
    const ticket = await loadSupportTicket(root, id);
    if (!ticket) return;
    await saveSupportTicket(root, {
      ...ticket,
      status: "archived",
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (get().activeTicket?.id === id) {
      set({ activeTicket: null, panelOpen: false });
    }
    await get().refreshList();
  },

  deleteTicket: async (id) => {
    const root = await cwd();
    if (!root) return;
    await deleteSupportTicket(root, id);
    if (get().activeTicket?.id === id) {
      set({ activeTicket: null, panelOpen: false });
    }
    await get().refreshList();
  },

  copyActiveMarkdown: async () => {
    const ticket = get().activeTicket;
    if (!ticket) return "";
    const md = formatSupportTicketMarkdown(ticket);
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      /* ignore */
    }
    return md;
  },
}));
