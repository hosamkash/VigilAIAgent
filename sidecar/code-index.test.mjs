import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  chunkSource,
  buildCodeIndex,
  searchCodeIndex,
  upsertIndexedFile,
  syncCodeIndex,
  clearMemory,
  loadCodeIndex,
  INDEX_VERSION,
} from "./code-index.mjs";

describe("chunkSource", () => {
  it("emits rich symbol chunks with imports in text", () => {
    const src = `import { helper } from "./util";\nexport function alpha() {\n  return 1;\n}\n\nexport class Beta {\n  run() {}\n}\n`;
    const { chunks, edges } = chunkSource("src/demo.ts", src);
    const titles = chunks.map((c) => c.title);
    expect(titles).toContain("alpha");
    expect(titles).toContain("Beta");
    expect(chunks.some((c) => c.text.includes("util"))).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
  });
});

describe("deep buildCodeIndex + search", () => {
  /** @type {string} */
  let tmp;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vigil-idx-"));
    clearMemory(tmp);
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "src", "search.ts"),
      `import { rank } from "./rank";\nexport function findSymbol(name: string) {\n  return rank(name);\n}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(tmp, "src", "rank.ts"),
      `export function rank(value: string) { return value.length; }\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(tmp, "src", "other.ts"),
      `export function unrelated() { return 0; }\n`,
      "utf8",
    );
  });

  afterEach(async () => {
    clearMemory(tmp);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("builds v2 index with vectors and finds symbols", async () => {
    const index = await buildCodeIndex(tmp);
    expect(index.version).toBe(INDEX_VERSION);
    expect(index.fileCount).toBeGreaterThanOrEqual(3);
    expect(index.chunks.some((c) => c.vec?.length)).toBe(true);
    expect(index.edges?.length).toBeGreaterThan(0);
    const result = searchCodeIndex(index, "findSymbol", 5);
    expect(result.mode).toBe("hybrid-bm25-vector");
    expect(result.hits[0].title).toBe("findSymbol");
  });

  it("upserts a file and keeps hybrid search", async () => {
    await buildCodeIndex(tmp);
    await upsertIndexedFile(
      tmp,
      "src/new-tool.ts",
      `export function brandNewHelper() {\n  return true;\n}\n`,
    );
    const index = await loadCodeIndex(tmp);
    const result = searchCodeIndex(index, "brandNewHelper", 5);
    expect(result.hits.some((h) => h.title === "brandNewHelper")).toBe(true);
  });

  it("syncs incrementally when one file changes", async () => {
    const first = await buildCodeIndex(tmp);
    const before = first.builtAt;
    await fs.writeFile(
      path.join(tmp, "src", "other.ts"),
      `export function unrelated() { return 42; }\nexport function freshlyAdded() { return 1; }\n`,
      "utf8",
    );
    // Clear memory so sync reloads from disk hashes path
    clearMemory(tmp);
    const synced = await syncCodeIndex(tmp);
    expect(synced.builtAt).toBeGreaterThanOrEqual(before);
    const result = searchCodeIndex(synced, "freshlyAdded", 5);
    expect(result.hits.some((h) => h.title === "freshlyAdded")).toBe(true);
  });
});
