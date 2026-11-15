import {
  ticketPlatformById,
  type TicketPlatformId,
} from "./ticket-platforms";
import type { TicketsHubPane } from "../store/ticketPlatformStore";
import { useTicketPlatformStore } from "../store/ticketPlatformStore";
import { useEditorTabsStore } from "../store/editorTabsStore";
import { useLayoutStore } from "../store/layoutStore";

/** Open Tickets sidebar + full-page hub for a platform (connect / drafts / overview). */
export function openTicketsHub(
  platformId?: TicketPlatformId,
  pane: TicketsHubPane = "overview",
): void {
  const store = useTicketPlatformStore.getState();
  const id = platformId
    ? ticketPlatformById(platformId).id
    : store.platformId;
  store.setPlatformId(id);
  store.setHubPane(pane);
  useLayoutStore.getState().showSidebar("tickets");
  useEditorTabsStore.getState().openTicketsHub(id, pane);
}
