import { afterEach, describe, expect, it } from "vitest";
import {
  clearSqlHistoryForTests,
  loadSqlHistory,
  pushSqlHistory,
  removeSqlHistory,
  toggleStarSqlHistory,
} from "./sql-history";

afterEach(() => {
  clearSqlHistoryForTests();
});

describe("sql-history", () => {
  it("pushes newest first and dedupes plain re-runs", () => {
    pushSqlHistory({ sql: "SELECT 1", ok: true, rowCount: 1 });
    pushSqlHistory({ sql: "SELECT 2", ok: true, rowCount: 1 });
    pushSqlHistory({ sql: "SELECT 1", ok: true, rowCount: 1 });
    const list = loadSqlHistory();
    expect(list[0]?.sql).toBe("SELECT 1");
    expect(list.filter((e) => e.sql === "SELECT 1").length).toBe(1);
  });

  it("stars and removes entries", () => {
    pushSqlHistory({ sql: "SELECT 9" });
    const id = loadSqlHistory()[0]!.id;
    toggleStarSqlHistory(id);
    expect(loadSqlHistory()[0]?.starred).toBe(true);
    removeSqlHistory(id);
    expect(loadSqlHistory().length).toBe(0);
  });
});
