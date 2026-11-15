import { describe, expect, it } from "vitest";
import { publishSupportTicket } from "./publish-support-ticket";
import { createEmptySupportTicket } from "./support-ticket";

describe("publishSupportTicket", () => {
  it("asks to connect when the vault has no token", async () => {
    const ticket = createEmptySupportTicket({ title: "Test" });
    await expect(publishSupportTicket(ticket, "jira")).rejects.toThrow(/connect/i);
  });
});
