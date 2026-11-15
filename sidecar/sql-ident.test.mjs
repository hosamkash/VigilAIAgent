import { describe, expect, it } from "vitest";
import {
  isSafeDbName,
  quoteIdent,
  synthesizeCreateTable,
} from "./sql-ident.mjs";

describe("sql-ident", () => {
  it("isSafeDbName rejects injection-ish names", () => {
    expect(isSafeDbName("MyDb")).toBe(true);
    expect(isSafeDbName("my-db_01")).toBe(true);
    expect(isSafeDbName("db; drop")).toBe(false);
    expect(isSafeDbName("x'y")).toBe(false);
    expect(isSafeDbName("")).toBe(false);
  });

  it("quoteIdent for mssql and postgres", () => {
    expect(quoteIdent("dbo", "mssql")).toBe("[dbo]");
    expect(quoteIdent('a"b', "postgres")).toBe('"a""b"');
  });

  it("synthesizeCreateTable builds script", () => {
    const ddl = synthesizeCreateTable(
      "dbo",
      "Items",
      [
        { col: "Id", typ: "int", nullable: "NO" },
        { col: "Name", typ: "nvarchar", nullable: "YES", len: 100 },
      ],
      "mssql",
    );
    expect(ddl).toMatch(/CREATE TABLE \[dbo\]\.\[Items\]/);
    expect(ddl).toMatch(/\[Id\] int NOT NULL/);
    expect(ddl).toMatch(/\[Name\] nvarchar\(100\) NULL/);
  });
});
