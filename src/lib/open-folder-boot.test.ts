import { describe, expect, it } from "vitest";
import { folderPathFromDeepLink } from "./open-folder-boot";

describe("folderPathFromDeepLink", () => {
  it("reads vigil://open", () => {
    expect(folderPathFromDeepLink("vigil://open?path=/Users/me/app")).toBe(
      "/Users/me/app",
    );
  });

  it("ignores plan links", () => {
    expect(folderPathFromDeepLink("vigil://continue?planId=p1")).toBeNull();
  });
});
