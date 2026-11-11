import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectProjectScripts, formatProjectScriptTips } from "./project-scripts.mjs";

describe("project-scripts", () => {
  it("detects npm test and lint", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vigil-scripts-"));
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest", lint: "eslint ." } }),
    );
    const found = await detectProjectScripts(dir);
    expect(found.test).toBe("npm test");
    expect(found.lint).toBe("npm run lint");
    const tips = await formatProjectScriptTips(dir);
    expect(tips).toContain("Preferred test");
  });
});
