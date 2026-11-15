import { describe, expect, it } from "vitest";
import {
  mergeVisitIntoList,
  sanitizeBrowserVisitInput,
  visitToCloudDoc,
} from "./browser-history";
import { assertNoCodeUpload } from "./no-code-upload";

describe("browser history metadata", () => {
  it("sanitizes url/title and rejects dangerous schemes", () => {
    const ok = sanitizeBrowserVisitInput({
      url: "example.com/path",
      title: "Example",
    });
    expect(ok?.url).toBe("https://example.com/path");
    expect(ok?.title).toBe("Example");

    expect(
      sanitizeBrowserVisitInput({ url: "javascript:alert(1)" }),
    ).toBeNull();
    expect(sanitizeBrowserVisitInput({ url: "data:text/html,hi" })).toBeNull();
  });

  it("bumps same url instead of duplicating", () => {
    const first = sanitizeBrowserVisitInput({
      url: "https://a.test",
      title: "A",
      visitedAt: 100,
    })!;
    const second = sanitizeBrowserVisitInput({
      url: "https://a.test",
      title: "A2",
      visitedAt: 200,
      id: "other",
    })!;
    const merged = mergeVisitIntoList([first], second);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("A2");
    expect(merged[0]?.visitedAt).toBe(200);
  });

  it("cloud payload stays metadata-only and passes no-code-upload", () => {
    const visit = sanitizeBrowserVisitInput({
      url: "https://vigil.example/app",
      title: "Vigil",
    })!;
    const doc = visitToCloudDoc(visit, "user-1");
    expect(Object.keys(doc).sort()).toEqual(
      ["id", "surface", "title", "url", "userId", "visitedAt"].sort(),
    );
    expect(assertNoCodeUpload(doc).ok).toBe(true);
    expect(
      assertNoCodeUpload({
        ...doc,
        pageHtml: "<html></html>",
      }).ok,
    ).toBe(false);
  });
});
