import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, getTheme, THEMES } from "./theme";

describe("theme presets", () => {
  it("defaults to light", () => {
    expect(DEFAULT_THEME_ID).toBe("light");
    expect(getTheme("light").mode).toBe("light");
  });

  it("includes light and dark plus accent themes", () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids).toContain("light");
    expect(ids).toContain("dark");
    expect(ids).toContain("ocean");
    expect(ids).toContain("forest");
    expect(ids).toContain("sunset");
  });

  it("every theme defines core CSS variables", () => {
    for (const theme of THEMES) {
      expect(theme.vars["--vigil-bg"]).toBeTruthy();
      expect(theme.vars["--vigil-accent"]).toBeTruthy();
      expect(theme.vars["--vigil-text"]).toBeTruthy();
    }
  });
});
