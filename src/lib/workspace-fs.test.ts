import { describe, expect, it } from "vitest";
import { basename, languageFromPath } from "./workspace-fs";

describe("workspace-fs helpers", () => {
  it("detects language from extension", () => {
    expect(languageFromPath("src/App.tsx")).toBe("typescript");
    expect(languageFromPath("readme.md")).toBe("markdown");
    expect(languageFromPath("data.json")).toBe("json");
  });

  it("returns basename", () => {
    expect(basename("/tmp/hello-vigil.txt")).toBe("hello-vigil.txt");
  });
});
