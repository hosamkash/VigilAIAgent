import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sql_capture_list, sql_capture_stop } from "./sql-activity.mjs";

describe("sql-activity", () => {
  it("lists empty capture state", async () => {
    await sql_capture_stop(null);
    const list = sql_capture_list();
    assert.equal(list.ok, true);
    assert.equal(list.capturing, false);
    assert.equal(list.count, 0);
  });
});
