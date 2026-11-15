import { describe, expect, it } from "vitest";
import { sql_capture_list, sql_capture_stop } from "./sql-activity.mjs";

describe("sql-activity", () => {
  it("lists empty capture state", async () => {
    await sql_capture_stop(null);
    const list = sql_capture_list();
    expect(list.ok).toBe(true);
    expect(list.capturing).toBe(false);
    expect(list.count).toBe(0);
  });
});
