import { describe, expect, it } from "vitest";
import { buildRgCommand, parseRgLine, parseRgOutput } from "./search";

describe("search / ripgrep helpers", () => {
  it("parses rg -n lines", () => {
    const hit = parseRgLine("src/App.tsx:12:function IdeShell()");
    expect(hit).toEqual({
      path: "src/App.tsx",
      line: 12,
      preview: "function IdeShell()",
      raw: "src/App.tsx:12:function IdeShell()",
    });
  });

  it("parses multi-line output", () => {
    const hits = parseRgOutput(
      "a.ts:1:foo\nb.ts:2:bar\n[exit 1]\n",
    );
    expect(hits).toHaveLength(2);
    expect(hits[1]?.line).toBe(2);
  });

  it("builds rg command with include/exclude", () => {
    const cmd = buildRgCommand("TODO", "*.ts", "node_modules");
    expect(cmd).toContain("rg -n");
    expect(cmd).toContain('"TODO"');
    expect(cmd).toContain("node_modules");
  });
});
