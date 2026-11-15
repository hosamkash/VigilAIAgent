import { describe, expect, it } from "vitest";
import { cloudHistoryHomePath } from "./open-account-history";

describe("open-account-history", () => {
  it("sends recents to the Vigil Web app shell", () => {
    expect(cloudHistoryHomePath()).toBe("/app");
  });
});
