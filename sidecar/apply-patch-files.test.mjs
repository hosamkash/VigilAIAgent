import { describe, expect, it } from "vitest";
import { extractPatchPaths, extractPatchText } from "./apply-patch-files.mjs";

describe("extractPatchPaths", () => {
  it("extracts multiple files from one patch", () => {
    const patch = `*** Begin Patch
*** Update File: src/a.ts
@@
-old
+new
*** Add File: src/b.ts
+hello
*** Delete File: src/c.ts
*** End Patch`;
    expect(extractPatchPaths(patch)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("dedupes paths", () => {
    const patch = `*** Update File: a.ts
*** Update File: a.ts`;
    expect(extractPatchPaths(patch)).toEqual(["a.ts"]);
  });
});

describe("extractPatchText", () => {
  it("reads patch from input object", () => {
    expect(
      extractPatchText({ patch: "*** Update File: x.ts\n" }),
    ).toContain("Update File");
  });
});
