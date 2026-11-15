import { describe, expect, it } from "vitest";
import {
  DEFAULT_TICKET_PLATFORM,
  TICKET_PLATFORMS,
  isTicketPlatformReady,
  ticketPlatformById,
} from "./ticket-platforms";

describe("ticket platforms catalog", () => {
  it("lists six ready publishers", () => {
    expect(DEFAULT_TICKET_PLATFORM).toBe("azure-devops");
    expect(isTicketPlatformReady("azure-devops")).toBe(true);
    expect(isTicketPlatformReady("jira")).toBe(true);
    expect(ticketPlatformById("github").label).toBe("GitHub Issues");
    expect(TICKET_PLATFORMS.map((p) => p.id)).toEqual([
      "azure-devops",
      "github",
      "gitlab",
      "jira",
      "linear",
      "clickup",
    ]);
  });
});
