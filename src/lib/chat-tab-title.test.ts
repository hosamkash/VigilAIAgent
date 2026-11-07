import { describe, expect, it } from "vitest";
import {
  clampChatTitle,
  displayChatTitle,
  isDefaultChatTitle,
  localChatTitle,
} from "./chat-tab-title";

describe("chat tab titles", () => {
  it("treats the stock tab names as defaults", () => {
    expect(isDefaultChatTitle("Chat")).toBe(true);
    expect(isDefaultChatTitle("Chat 2")).toBe(true);
    expect(isDefaultChatTitle("New Chat")).toBe(true);
    expect(isDefaultChatTitle("")).toBe(true);
    expect(isDefaultChatTitle("   ")).toBe(true);
    expect(isDefaultChatTitle("Login button")).toBe(false);
  });

  it("never shows a blank tab label", () => {
    expect(displayChatTitle("")).toBe("Chat");
    expect(displayChatTitle("  ")).toBe("Chat");
    expect(displayChatTitle("Fix login")).toBe("Fix login");
  });

  it("turns the first request into two to four words", () => {
    expect(localChatTitle("please fix the login button color")).toBe(
      "Fix login button color",
    );
    expect(localChatTitle("can you explain git rebase")).toBe(
      "Explain git rebase",
    );
    expect(localChatTitle("عايز أصلح زرار الدخول")).toBe("أصلح زرار الدخول");
  });

  it("never keeps more than four words", () => {
    expect(clampChatTitle("one two three four five six").split(/\s+/)).toHaveLength(
      4,
    );
  });

  it("names an image-only message", () => {
    expect(localChatTitle("(1 image(s))")).toBe("Pasted image");
  });
});
