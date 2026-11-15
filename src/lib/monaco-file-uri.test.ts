import { describe, expect, it } from "vitest";
import { fileUriToPath, pathToFileUri } from "./monaco-file-uri";

describe("monaco file URIs", () => {
  it("round-trips posix paths for F12 open", () => {
    const path = "/Users/me/proj/src/lib/foo.ts";
    expect(fileUriToPath(pathToFileUri(path))).toBe(path);
  });

  it("maps Windows drive URIs to paths", () => {
    expect(fileUriToPath("file:///C:/proj/src/a.ts")).toBe("C:/proj/src/a.ts");
    expect(pathToFileUri("C:/proj/src/a.ts")).toBe("file:///C:/proj/src/a.ts");
  });
});
