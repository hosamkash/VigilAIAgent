import { describe, expect, it } from "vitest";
import { buildIndexedFiles, rankIndexedFiles, scoreIndexedFile } from "./workspace-index";

describe("workspace-index", () => {
  it("builds relative labels", () => {
    const files = buildIndexedFiles(
      ["/proj/src/App.tsx", "/proj/src/lib/util.ts"],
      "/proj",
    );
    expect(files[0]?.label).toBe("src/App.tsx");
    expect(files[0]?.name).toBe("App.tsx");
  });

  it("ranks name prefix higher", () => {
    const files = buildIndexedFiles(
      ["/p/src/App.tsx", "/p/src/helpers.ts"],
      "/p",
    );
    const ranked = rankIndexedFiles(files, "App", 5);
    expect(ranked[0]?.name).toBe("App.tsx");
    expect(scoreIndexedFile(files[0]!, "App")).toBeGreaterThan(
      scoreIndexedFile(files[1]!, "App"),
    );
  });
});
