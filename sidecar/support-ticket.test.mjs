import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
    assert.equal(t.type, "Bug");
    assert.deepEqual(t.stepsToReproduce, ["Open report", "Pick today"]);
    const md = formatSupportTicketMarkdown(t);
    assert.match(md, /# Report empty/);
    assert.match(md, /dbo\.SalesReport/);
    assert.match(md, /\*\*Priority:\*\* P2/);
  });
});
