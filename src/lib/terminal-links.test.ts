import { describe, expect, it } from "vitest";
import { extractHttpUrl, sanitizeTerminalUrl } from "./terminal-links";

describe("sanitizeTerminalUrl", () => {
  it("keeps localhost http urls", () => {
    expect(sanitizeTerminalUrl("http://localhost:4300")).toBe(
      "http://localhost:4300/",
    );
  });

  it("strips trailing punctuation", () => {
    expect(sanitizeTerminalUrl("https://example.com/path).")).toBe(
      "https://example.com/path",
    );
  });

  it("rejects non-http schemes", () => {
    expect(sanitizeTerminalUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("extractHttpUrl", () => {
  it("finds a url inside terminal text", () => {
    expect(extractHttpUrl("Local: http://localhost:4300/")).toBe(
      "http://localhost:4300/",
    );
  });
});
