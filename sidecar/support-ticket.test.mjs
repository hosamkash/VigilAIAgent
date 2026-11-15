import { describe, expect, it } from "vitest";
import {
  formatSupportTicketMarkdown,
  normalizeSupportTicket,
} from "./support-ticket.mjs";

describe("support-ticket sidecar", () => {
  it("normalizes and formats markdown", () => {
    const t = normalizeSupportTicket({
      title: "Report empty",
      type: "Bug",
      summary: "Zero rows",
      stepsToReproduce: "Open report\nPick today",
      evidence: ["dbo.SalesReport"],
      priority: "P2",
    });
    expect(t.type).toBe("Bug");
    expect(t.stepsToReproduce).toEqual(["Open report", "Pick today"]);
    const md = formatSupportTicketMarkdown(t);
    expect(md).toMatch(/# Report empty/);
    expect(md).toMatch(/dbo\.SalesReport/);
    expect(md).toMatch(/\*\*Priority:\*\* P2/);
  });
});
