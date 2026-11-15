import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveVigilWebRepo } from "./vercel-web-env.mjs";

describe("resolveVigilWebRepo", () => {
  it("finds a sibling folder with env-vercel.mjs", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vigil-web-env-"));
    const desktop = path.join(tmp, "VigilAIAgent");
    const web = path.join(tmp, "Vigil-AI-Agent-Web");
    await fs.mkdir(path.join(web, "scripts"), { recursive: true });
    await fs.mkdir(desktop, { recursive: true });
    await fs.writeFile(path.join(web, "scripts", "env-vercel.mjs"), "// stub\n");
    expect(resolveVigilWebRepo(desktop, desktop)).toBe(web);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
