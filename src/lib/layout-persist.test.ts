import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  loadLayoutSizes,
  saveLayoutSizes,
  sizesToPercents,
} from "./layout-persist";

describe("layout persistence", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_LAYOUT.horizontal[0]).toBeGreaterThan(0);
    expect(DEFAULT_LAYOUT.vertical[0] + DEFAULT_LAYOUT.vertical[1]).toBeCloseTo(
      100,
      5,
    );
  });

  it("round-trips sizes through localStorage", () => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: ls,
      configurable: true,
    });
    saveLayoutSizes({ horizontal: [25, 50, 25], vertical: [65, 35] });
    const loaded = loadLayoutSizes();
    expect(loaded.horizontal[0]).toBeCloseTo(25, 0);
    expect(loaded.vertical[1]).toBeCloseTo(35, 0);
  });

  it("converts pixel sizes to percents", () => {
    const p = sizesToPercents([200, 400, 200]);
    expect(p[0] + p[1] + p[2]).toBeCloseTo(100, 5);
    expect(p[1]).toBeCloseTo(50, 5);
  });
});
