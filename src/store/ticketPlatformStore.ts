import { create } from "zustand";
import {
  DEFAULT_TICKET_PLATFORM,
  ticketPlatformById,
  type TicketPlatformId,
} from "../lib/ticket-platforms";

const STORAGE_KEY = "vigil.tickets.platform";
const PANE_KEY = "vigil.tickets.hubPane";

export type TicketsHubPane = "overview" | "connect" | "drafts";

function loadPlatform(): TicketPlatformId {
  try {
    return ticketPlatformById(localStorage.getItem(STORAGE_KEY) || "").id;
  } catch {
    return DEFAULT_TICKET_PLATFORM;
  }
}

function loadPane(): TicketsHubPane {
  try {
    const raw = localStorage.getItem(PANE_KEY);
    if (raw === "connect" || raw === "drafts" || raw === "overview") return raw;
  } catch {
    /* ignore */
  }
  return "overview";
}

export const useTicketPlatformStore = create<{
  platformId: TicketPlatformId;
  hubPane: TicketsHubPane;
  setPlatformId: (id: TicketPlatformId) => void;
  setHubPane: (pane: TicketsHubPane) => void;
}>((set) => ({
  platformId: loadPlatform(),
  hubPane: loadPane(),
  setPlatformId: (id) => {
    const next = ticketPlatformById(id).id;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    set({ platformId: next });
  },
  setHubPane: (pane) => {
    try {
      localStorage.setItem(PANE_KEY, pane);
    } catch {
      /* ignore */
    }
    set({ hubPane: pane });
  },
}));
