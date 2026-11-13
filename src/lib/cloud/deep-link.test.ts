import { describe, expect, it } from "vitest";
import { buildVigilContinueUrl, parseVigilDeepLink } from "./deep-link";

describe("vigil deep links", () => {
  it("builds continue URLs", () => {
    expect(buildVigilContinueUrl("abc", { execute: true })).toBe(
      "vigil://continue?planId=abc&execute=1",
    );
  });

  it("parses execute flag", () => {
    expect(parseVigilDeepLink("vigil://continue?planId=p1&execute=1")).toEqual({
      planId: "p1",
      execute: true,
    });
  });

  it("parses plan host path", () => {
    expect(parseVigilDeepLink("vigil://plan/xyz")).toEqual({
      planId: "xyz",
      execute: false,
    });
  });

  it("rejects non-vigil", () => {
    expect(parseVigilDeepLink("https://example.com")).toBeNull();
  });
});
