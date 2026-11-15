import { describe, expect, it } from "vitest";
import {
  buildVigilChatUrl,
  buildVigilContinueUrl,
  parseVigilDeepLink,
} from "./deep-link";

describe("vigil deep links", () => {
  it("builds continue URLs", () => {
    expect(buildVigilContinueUrl("abc", { execute: true })).toBe(
      "vigil://continue?planId=abc&execute=1",
    );
  });

  it("parses execute flag", () => {
    expect(parseVigilDeepLink("vigil://continue?planId=p1&execute=1")).toEqual({
      kind: "plan",
      planId: "p1",
      execute: true,
    });
  });

  it("parses plan host path", () => {
    expect(parseVigilDeepLink("vigil://plan/xyz")).toEqual({
      kind: "plan",
      planId: "xyz",
      execute: false,
    });
  });

  it("builds and parses chat URLs", () => {
    expect(buildVigilChatUrl("c1")).toBe("vigil://chat?chatId=c1");
    expect(parseVigilDeepLink("vigil://chat?chatId=c9")).toEqual({
      kind: "chat",
      chatId: "c9",
      execute: false,
    });
  });

  it("parses open-folder URLs", () => {
    expect(parseVigilDeepLink("vigil://open?path=%2Ftmp%2Fapp")).toEqual({
      kind: "open",
      path: "/tmp/app",
      execute: false,
    });
  });

  it("rejects non-vigil", () => {
    expect(parseVigilDeepLink("https://example.com")).toBeNull();
  });
});
