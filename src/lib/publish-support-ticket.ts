import type { SupportTicket } from "./support-ticket";
import { ticketPlatformById, type TicketPlatformId } from "./ticket-platforms";
import {
  publishTicketToPlatform,
  type TicketPublishResult,
} from "./ticket-publish";

export type { TicketPublishResult };

export async function publishSupportTicket(
  ticket: SupportTicket,
  platformId: TicketPlatformId,
): Promise<TicketPublishResult> {
  const platform = ticketPlatformById(platformId);
  return publishTicketToPlatform(ticket, platform.id);
}
