import { describe, expect, it } from "vitest";
import {
  extractFileFacts,
  extractImportTarget,
  resolveImportSpec,
  pathTokens,
} from "./ast-extract.mjs";

describe("ast-extract", () => {
  it("parses TS imports and symbols", () => {
    const src = `
import { foo } from "./lib/foo";
import type { Bar } from "../types";
export function alpha() { return 1; }
export class Beta { run() {} }
`;
    const facts = extractFileFacts("src/demo.ts", src);
    expect(facts.importSpecs).toContain("./lib/foo");
    expect(facts.symbols.some((s) => s.title === "alpha")).toBe(true);
    expect(facts.symbols.some((s) => s.title === "Beta")).toBe(true);
  });

  it("resolves relative imports", () => {
    expect(resolveImportSpec("src/a/b.ts", "./c")).toBe("src/a/c");
    expect(resolveImportSpec("src/a/b.ts", "../x")).toBe("src/x");
  });

  it("extracts python defs", () => {
    expect(extractImportTarget("from package.mod import Thing")).toContain(
      "package.mod",
    );
    const facts = extractFileFacts(
      "app.py",
      "class Worker:\n    pass\n\ndef run_job():\n    return 1\n",
    );
    expect(facts.symbols.some((s) => s.title === "run_job")).toBe(true);
  });

  it("tokenizes paths", () => {
    expect(pathTokens("src/billing/InvoiceService.ts")).toContain("billing");
  });
});
