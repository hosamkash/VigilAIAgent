import { describe, expect, it } from "vitest";
import { shouldReplaceLocalChatWithCloud } from "./cloud-hydrate";
import type { CloudMessageDoc } from "./types";

function msg(id: string, createdAt: number): CloudMessageDoc {
  return {
    id,
    chatId: "c1",
    userId: "u1",
    role: "user",
    content: "hi",
    createdAt,
  };
}

describe("shouldReplaceLocalChatWithCloud", () => {
  it("imports when local missing", () => {
    expect(
      shouldReplaceLocalChatWithCloud({
        local: null,
        cloudUpdatedAt: 1,
        cloudMessages: [],
      }),
    ).toBe(true);
  });

  it("skips when local is newer and has same/more messages", () => {
    expect(
      shouldReplaceLocalChatWithCloud({
        local: {
          updatedAt: 200,
          messages: [{ createdAt: 150 } as never],
        },
        cloudUpdatedAt: 100,
        cloudMessages: [msg("m1", 90)],
      }),
    ).toBe(false);
  });

  it("replaces when cloud updatedAt is newer", () => {
    expect(
      shouldReplaceLocalChatWithCloud({
        local: { updatedAt: 100, messages: [] },
        cloudUpdatedAt: 200,
        cloudMessages: [],
      }),
    ).toBe(true);
  });

  it("replaces when cloud has more messages even if updatedAt ties", () => {
    expect(
      shouldReplaceLocalChatWithCloud({
        local: {
          updatedAt: 100,
          messages: [{ createdAt: 50 } as never],
        },
        cloudUpdatedAt: 100,
        cloudMessages: [msg("a", 40), msg("b", 60)],
      }),
    ).toBe(true);
  });

  it("replaces when cloud has a newer message createdAt", () => {
    expect(
      shouldReplaceLocalChatWithCloud({
        local: {
          updatedAt: 100,
          messages: [
            { createdAt: 50 } as never,
            { createdAt: 80 } as never,
          ],
        },
        cloudUpdatedAt: 100,
        cloudMessages: [msg("a", 50), msg("b", 120)],
      }),
    ).toBe(true);
  });
});
