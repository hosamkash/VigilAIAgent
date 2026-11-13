import { describe, expect, it } from "vitest";
import {
  createEmptySupportTicket,
  formatSupportTicketMarkdown,
  normalizeSupportTicket,
  parseSupportTicketJson,
  serializeSupportTicket,
  ticketRelativePath,
} from "./support-ticket";

describe("support-ticket", () => {
  it("normalizes draft ticket fields", () => {
    const t = normalizeSupportTicket({
      title: "  تقرير المبيعات فاضي  ",
      type: "Bug",
      summary: "الريورت بيرجع صفر صفوف",
      stepsToReproduce: ["افتح التقرير", "اختار تاريخ اليوم"],
      acceptanceCriteria: ["يظهر صف واحد على الأقل لبيانات تجريبية"],
      priority: "P1",
      severity: "Sev2",
    });
    expect(t.title).toBe("تقرير المبيعات فاضي");
    expect(t.status).toBe("draft");
    expect(t.stepsToReproduce).toEqual([
      "افتح التقرير",
      "اختار تاريخ اليوم",
    ]);
    expect(t.id).toMatch(/^tkt_/);
  });

  it("formats markdown for copy/ADO", () => {
    const t = createEmptySupportTicket({
      title: "Invoice total mismatch",
      type: "Bug",
      summary: "Grid total ≠ ledger.",
      expected: "Match ledger",
      actual: "Off by 1.00",
      evidence: ["SELECT SUM(Amount) FROM dbo.InvoiceLine"],
      acceptanceCriteria: ["Totals match for sample invoice #100"],
      priority: "P0",
      severity: "Sev1",
      connectionLabel: "UAT",
    });
    const md = formatSupportTicketMarkdown(t);
    expect(md).toContain("# Invoice total mismatch");
    expect(md).toContain("**Priority:** P0");
    expect(md).toContain("## Summary");
    expect(md).toContain("SELECT SUM(Amount)");
    expect(md).toContain("**Connection:** UAT");
  });

  it("round-trips JSON", () => {
    const t = createEmptySupportTicket({
      title: "Spike: Query Store",
      type: "Spike",
      summary: "Check if Query Store is on",
    });
    const again = parseSupportTicketJson(serializeSupportTicket(t));
    expect(again?.title).toBe(t.title);
    expect(again?.type).toBe("Spike");
    expect(ticketRelativePath(t.id)).toContain(".vigil/tickets/");
  });
});
