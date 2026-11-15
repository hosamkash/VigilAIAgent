import { describe, expect, it } from "vitest";
import { createEmptySupportTicket } from "./support-ticket";
import { ticketIssuePayload } from "./ticket-publish";
import { isTicketPlatformReady, TICKET_PLATFORMS } from "./ticket-platforms";

describe("ticket publish payloads", () => {
  it("uses the ticket title and markdown body", () => {
    const ticket = createEmptySupportTicket({
      title: "Invoice save fails",
      summary: "UAT save button no-op",
    });
    const payload = ticketIssuePayload(ticket);
    expect(payload.title).toBe("Invoice save fails");
    expect(payload.body).toContain("Invoice save fails");
    expect(payload.body).toContain("UAT save button no-op");
  });

  it("marks every catalog platform ready", () => {
    for (const p of TICKET_PLATFORMS) {
      expect(isTicketPlatformReady(p.id)).toBe(true);
    }
  });
});
