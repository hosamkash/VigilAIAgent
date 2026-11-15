import { describe, expect, it } from "vitest";
import { ticketDraftFromSecureFinding } from "./ticket-from-finding";

describe("ticketDraftFromSecureFinding", () => {
  it("maps a finding into a support draft", () => {
    const draft = ticketDraftFromSecureFinding(
      {
        id: "f1",
        severity: "high",
        category: "xss",
        title: "Reflected marker",
        detail: "Query echoes the probe",
        path: "/search",
        evidence: "q=<marker>",
      },
      { target: "http://127.0.0.1:3000", pack: "active" },
    );
    expect(draft.title).toContain("Reflected marker");
    expect(draft.suspectedArea).toBe("/search");
    expect(draft.environment).toContain("127.0.0.1");
    expect(draft.evidence?.[0]).toBe("xss");
  });
});
