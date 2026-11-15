import { useEditorTabsStore } from "../store/editorTabsStore";
import { useLayoutStore } from "../store/layoutStore";

/** Open Tickets sidebar + a full editor tab for the draft. */
export function openTicketWorkspace(ticketId: string, title?: string): void {
  useLayoutStore.getState().showSidebar("tickets");
  useEditorTabsStore.getState().openTicketTab(ticketId, title || "Ticket");
}
