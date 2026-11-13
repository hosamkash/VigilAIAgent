import assert from "node:assert/strict";
import { applyRowLimit, classifySql } from "./sql-safety.mjs";

assert.equal(classifySql("SELECT 1").ok, true);
assert.equal(classifySql("WITH x AS (SELECT 1) SELECT * FROM x").ok, true);
assert.equal(classifySql("DELETE FROM t").ok, false);
assert.equal(classifySql("DROP TABLE t").ok, false);
assert.equal(classifySql("SELECT 1; SELECT 2").ok, false);
assert.equal(classifySql("").ok, false);

const mssql = applyRowLimit("SELECT * FROM dbo.T", "mssql", 50);
assert.match(mssql, /TOP \(50\)/i);

const pg = applyRowLimit("SELECT * FROM t", "postgres", 25);
assert.match(pg, /LIMIT 25/i);

const already = applyRowLimit("SELECT TOP 10 * FROM t", "mssql", 50);
assert.equal(already.includes("TOP (50)"), false);

console.log("sql-safety.test.mjs: ok");
