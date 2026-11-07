import { describe, expect, it } from "vitest";
import {
  browserTabTitle,
  isLocalPreviewUrl,
  normalizeBrowserUrl,
} from "./browser-url";

describe("browser-url", () => {
  it("normalizes bare hosts and localhost", () => {
    expect(normalizeBrowserUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBrowserUrl("127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
    expect(normalizeBrowserUrl("https://example.com")).toBe("https://example.com");
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com");
  });

  it("titles and local detection", () => {
    expect(browserTabTitle("http://localhost:3000/app")).toBe("localhost");
    expect(isLocalPreviewUrl("http://127.0.0.1:5173")).toBe(true);
    expect(isLocalPreviewUrl("https://example.com")).toBe(false);
  });
});
