import { describe, expect, it } from "vitest";
import { matchGlossaryTerms, normalizeGlossaryQuery } from "./sql-glossary.mjs";

describe("sql glossary", () => {
  it("normalizes Arabic alef variants", () => {
    expect(normalizeGlossaryQuery("إدارة")).toBe(normalizeGlossaryQuery("اداره"));
  });

  it("matches AR/EN/table", () => {
    const terms = [
      { ar: "رقم الفاتورة", en: "invoice no", table: "dbo.Invoices", column: "InvNo" },
    ];
    expect(matchGlossaryTerms(terms, "فاتوره")[0].column).toBe("InvNo");
    expect(matchGlossaryTerms(terms, "invoice")[0].table).toBe("dbo.Invoices");
  });
});
