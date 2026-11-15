import { describe, expect, it } from "vitest";
import {
  parseIgnoreText,
  shouldSkipRelative,
} from "./index-ignore.mjs";

describe("index ignore", () => {
  it("treats bare names and trailing slash as directory skips", () => {
    const ignore = parseIgnoreText("dist/\ncoverage\n*.min.js\n");
    expect(ignore.dirNames.has("dist")).toBe(true);
    expect(ignore.dirNames.has("coverage")).toBe(true);
    expect(shouldSkipRelative("src/app.ts", ignore)).toBe(false);
    expect(shouldSkipRelative("dist/bundle.js", ignore)).toBe(true);
    expect(shouldSkipRelative("vendor/foo.min.js", ignore)).toBe(true);
  });

  it("honors nested generated folders", () => {
    const ignore = parseIgnoreText("generated/\n");
    expect(shouldSkipRelative("pkg/generated/types.ts", ignore)).toBe(true);
  });
});
