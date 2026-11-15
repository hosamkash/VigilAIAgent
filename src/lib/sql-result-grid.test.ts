import { describe, expect, it } from "vitest";
import {
  cellDisplay,
  columnsFromRows,
  quoteQualifiedTable,
  rowsToCsv,
  selectStarSql,
} from "./sql-result-grid";

describe("sql-result-grid", () => {
  it("columnsFromRows uses first row keys", () => {
    expect(columnsFromRows([])).toEqual([]);
    expect(
      columnsFromRows([
        { id: 1, name: "a" },
        { id: 2, name: "b", extra: true },
      ]),
    ).toEqual(["id", "name"]);
  });

  it("rowsToCsv escapes commas and quotes", () => {
    const csv = rowsToCsv([
      { a: "hello, world", b: 'say "hi"' },
      { a: null, b: 2 },
    ]);
    expect(csv).toBe('a,b\n"hello, world","say ""hi"""\n,2');
  });

  it("quoteQualifiedTable for mssql and postgres", () => {
    expect(quoteQualifiedTable("dbo", "Items", "mssql")).toBe("[dbo].[Items]");
    expect(quoteQualifiedTable("public", "items", "postgres")).toBe(
      '"public"."items"',
    );
    expect(quoteQualifiedTable("dbo", "Weird]Name", "mssql")).toBe(
      "[dbo].[Weird]]Name]",
    );
  });

  it("selectStarSql prefills SELECT *", () => {
    expect(selectStarSql("dbo", "Orders", "mssql")).toBe(
      "SELECT * FROM [dbo].[Orders]",
    );
    expect(selectStarSql("public", "orders", "postgres")).toBe(
      'SELECT * FROM "public"."orders"',
    );
  });

  it("cellDisplay handles null and objects", () => {
    expect(cellDisplay(null)).toBe("NULL");
    expect(cellDisplay({ x: 1 })).toBe('{"x":1}');
  });
});
