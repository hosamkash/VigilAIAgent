import { describe, expect, it } from "vitest";
import {
  applyAtMentionReplacement,
  findAtMentionQuery,
  rankAtMentionCandidates,
} from "./composer-at-mention";

describe("findAtMentionQuery", () => {
  it("detects @query at the caret", () => {
    const text = "fix @App";
    expect(findAtMentionQuery(text, text.length)).toEqual({
      start: 4,
      end: 8,
      query: "App",
    });
  });

  it("returns null when not in a mention", () => {
    expect(findAtMentionQuery("hello world", 5)).toBeNull();
  });
});

describe("rankAtMentionCandidates", () => {
  it("prefers name prefix matches", () => {
    const ranked = rankAtMentionCandidates(
      [
        { path: "/p/src/App.tsx", name: "App.tsx", isDir: false },
        { path: "/p/src/helpers.ts", name: "helpers.ts", isDir: false },
      ],
      "App",
      "/p",
    );
    expect(ranked[0]?.label).toBe("src/App.tsx");
  });
});

describe("applyAtMentionReplacement", () => {
  it("removes the @query span", () => {
    const text = "see @App please";
    const mention = findAtMentionQuery(text, 8)!;
    expect(applyAtMentionReplacement(text, mention)).toBe("see  please");
  });
});
