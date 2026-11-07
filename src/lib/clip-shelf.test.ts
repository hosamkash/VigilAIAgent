import { describe, expect, it } from "vitest";
import { CLIP_LIMIT, CLIP_MAX_CHARS, placeClip, type Clip } from "./clip-shelf";

function clip(id: string, text: string, pinned = false, at = 1): Clip {
  return { id, text, pinned, createdAt: at, updatedAt: at };
}

describe("placeClip", () => {
  it("keeps the newest copy first", () => {
    const next = placeClip([clip("a", "old", false, 1)], "new", 2);
    expect(next.map((item) => item.text)).toEqual(["new", "old"]);
  });

  it("drops the oldest unpinned copy after 15", () => {
    const clips = Array.from({ length: CLIP_LIMIT }, (_, index) =>
      clip(`c${index}`, `text ${index}`, index === 0, index + 1),
    );
    const next = placeClip(clips, "fresh", 100);
    expect(next).toHaveLength(CLIP_LIMIT);
    expect(next[0]?.text).toBe("fresh");
    expect(next.some((item) => item.id === "c0" && item.pinned)).toBe(true);
    expect(next.some((item) => item.text === "text 1")).toBe(false);
    expect(next.some((item) => item.text === "text 2")).toBe(true);
  });

  it("keeps a new copy when every saved clip is pinned", () => {
    const clips = Array.from({ length: CLIP_LIMIT }, (_, index) =>
      clip(`c${index}`, `text ${index}`, true, index + 1),
    );
    const next = placeClip(clips, "fresh", 100);
    expect(next).toHaveLength(CLIP_LIMIT + 1);
    expect(next.filter((item) => item.pinned)).toHaveLength(CLIP_LIMIT);
    expect(next.some((item) => item.text === "fresh")).toBe(true);
  });

  it("moves a repeated copy to the front instead of duplicating it", () => {
    const next = placeClip(
      [clip("a", "same", true, 1), clip("b", "other", false, 2)],
      "same",
      3,
    );
    expect(next.filter((item) => item.text === "same")).toHaveLength(1);
    expect(next[0]?.id).toBe("a");
    expect(next[0]?.pinned).toBe(true);
  });

  it("ignores blank text and trims oversized copies", () => {
    expect(placeClip([clip("a", "stay")], "   ")).toHaveLength(1);
    const next = placeClip([], "x".repeat(CLIP_MAX_CHARS + 20), 4);
    expect(next[0]?.text).toHaveLength(CLIP_MAX_CHARS);
  });

  it("keeps an image copy that has no text", () => {
    const next = placeClip([], { image: "data:image/jpeg;base64,abc" }, 2);
    expect(next).toHaveLength(1);
    expect(next[0]?.text).toBe("");
    expect(next[0]?.image).toBe("data:image/jpeg;base64,abc");
  });

  it("leaves an image that is already saved when asked not to refresh it", () => {
    const clips = placeClip([], { image: "data:image/jpeg;base64,abc" }, 1);
    const next = placeClip(clips, { image: "data:image/jpeg;base64,abc" }, 2, {
      ifNew: true,
    });
    expect(next).toBe(clips);
  });
});
