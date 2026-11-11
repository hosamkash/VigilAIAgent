import { describe, expect, it } from "vitest";
import {
  extractSymbolsFromSource,
  parseSymbolHit,
  rankSymbols,
} from "./symbol-extract";

describe("symbol-extract", () => {
  it("parses export function hits", () => {
    const hit = parseSymbolHit(
      "/p/src/a.ts:12:export async function loadUser() {",
      "/p",
    );
    expect(hit?.name).toBe("loadUser");
    expect(hit?.kind).toBe("function");
    expect(hit?.label).toBe("src/a.ts");
  });

  it("extracts from source", () => {
    const symbols = extractSymbolsFromSource(
      "export class Foo {}\nexport type Bar = string;\n",
      "/p/src/x.ts",
      "/p",
    );
    expect(symbols.map((s) => s.name).sort()).toEqual(["Bar", "Foo"]);
  });

  it("ranks exact name first", () => {
    const ranked = rankSymbols(
      [
        {
          name: "load",
          kind: "function",
          path: "/a",
          line: 1,
          label: "a.ts",
        },
        {
          name: "loadUser",
          kind: "function",
          path: "/b",
          line: 1,
          label: "b.ts",
        },
      ],
      "loadUser",
    );
    expect(ranked[0]?.name).toBe("loadUser");
  });
});
