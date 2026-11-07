import { describe, expect, it } from "vitest";
import {
  detectBrowserOpenIntent,
  extractPreviewUrls,
  isPureBrowserOpenRequest,
} from "./browser-intent";

describe("detectBrowserOpenIntent", () => {
  it("detects Arabic open + localhost", () => {
    const intent = detectBrowserOpenIntent(
      "افتح Vigil Browser على http://localhost:4300",
    );
    expect(intent?.url).toBe("http://localhost:4300");
    expect(intent?.forceToolNote).toContain("browser_open");
  });

  it("detects English open browser for project", () => {
    const intent = detectBrowserOpenIntent("open the browser for the project");
    expect(intent?.url).toBe("project");
  });

  it("detects Arabic open tool page", () => {
    expect(
      detectBrowserOpenIntent("افتح أداة تقطيع الصور"),
    ).not.toBeNull();
  });

  it("ignores unrelated chat", () => {
    expect(detectBrowserOpenIntent("fix the login form")).toBeNull();
  });
});

describe("isPureBrowserOpenRequest", () => {
  it("short-circuits open URL chats", () => {
    expect(
      isPureBrowserOpenRequest("افتح http://localhost:4300 في البراوزر"),
    ).toBe(true);
  });

  it("does not short-circuit coding tasks", () => {
    expect(
      isPureBrowserOpenRequest("صلح صفحة اللوجين على localhost:4300"),
    ).toBe(false);
  });
});

describe("extractPreviewUrls", () => {
  it("finds localhost links in markdown", () => {
    expect(
      extractPreviewUrls("Open [app](http://localhost:4300) please"),
    ).toContain("http://localhost:4300");
  });
});
