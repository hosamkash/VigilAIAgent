import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCodeIndex, clearMemory } from "./code-index.mjs";
import { find_definition, pickDefinitions } from "./lang-graph.mjs";

describe("lang-graph", () => {
  /** @type {string} */
  let tmp;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vigil-lang-"));
    clearMemory(tmp);
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "src", "auth.ts"),
      `export function verifyToken(token: string) {\n  return token.length > 0;\n}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(tmp, "src", "api.ts"),
      `import { verifyToken } from "./auth";\nexport function handle(req: string) {\n  return verifyToken(req);\n}\n`,
      "utf8",
    );
  });

  afterEach(async () => {
    clearMemory(tmp);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("picks definition chunks by exact title", async () => {
    const index = await buildCodeIndex(tmp);
    const defs = pickDefinitions(index, "verifyToken");
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].path).toContain("auth.ts");
  });

  it("find_definition returns declaration output", async () => {
    await buildCodeIndex(tmp);
    const result = await find_definition("verifyToken", tmp);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("verifyToken");
    expect(result.output).toContain("auth.ts");
  });
});
