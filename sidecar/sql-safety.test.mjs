import { describe, expect, it } from "vitest";
import { applyRowLimit, classifySql } from "./sql-safety.mjs";

describe("sql-safety", () => {
  it("classifies read vs write SQL", () => {
    expect(classifySql("SELECT 1").ok).toBe(true);
    expect(classifySql("WITH x AS (SELECT 1) SELECT * FROM x").ok).toBe(true);
    expect(classifySql("DELETE FROM t").ok).toBe(false);
    expect(classifySql("DROP TABLE t").ok).toBe(false);
    expect(classifySql("SELECT 1; SELECT 2").ok).toBe(false);
    expect(classifySql("").ok).toBe(false);
  });

  it("applies row limits for mssql and postgres", () => {
    expect(applyRowLimit("SELECT * FROM dbo.T", "mssql", 50)).toMatch(
      /TOP \(50\)/i,
    );
    expect(applyRowLimit("SELECT * FROM t", "postgres", 25)).toMatch(
      /LIMIT 25/i,
    );
    const already = applyRowLimit("SELECT TOP 10 * FROM t", "mssql", 50);
    expect(already.includes("TOP (50)")).toBe(false);
  });
});
