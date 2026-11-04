/**
 * Phase 0 verification test.
 * Confirms @cline/sdk exports ClineCore (not Cline) and Vigil list_files works.
 * Cline SDK is imported only here (Node/vitest) — never from the browser client.
 */

import { describe, expect, it } from "vitest";
import {
  ClineCore,
  DefaultToolNames as SdkDefaultToolNames,
} from "@cline/sdk";
import {
  DefaultToolNames,
  getSdkDefaultToolNames,
} from "./cline-engine";
import { list_files } from "./tools";

describe("@cline/sdk API surface", () => {
  it("exports ClineCore as the primary entry class", () => {
    expect(typeof ClineCore.create).toBe("function");
  });

  it("documents default tool names (no list_files in SDK)", () => {
    const names = getSdkDefaultToolNames();
    expect(names).toContain(DefaultToolNames.READ_FILES);
    expect(names).toContain(DefaultToolNames.SEARCH_CODEBASE);
    expect(names).toContain(DefaultToolNames.RUN_COMMANDS);
    expect(names).not.toContain("list_files");
    expect(SdkDefaultToolNames.READ_FILES).toBe("read_files");
  });
});

describe("Vigil list_files tool", () => {
  it("lists files in the project root via tools.list_files", async () => {
    const result = await list_files(".", process.cwd());
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/package\.json/);
  });

  it("exposes list_files output usable by cline-engine wrapper contract", async () => {
    const result = await list_files(".", process.cwd());
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/src/);
  });
});
