import { describe, expect, it } from "vitest";
import {
  detectDesktopAppExe,
  isWindowsDesktopHost,
  resolveUiDriverPath,
} from "./desktop-app.mjs";

describe("desktop-app bridge", () => {
  it("reports platform honestly", () => {
    expect(typeof isWindowsDesktopHost()).toBe("boolean");
    expect(isWindowsDesktopHost()).toBe(process.platform === "win32");
  });

  it("resolveUiDriverPath does not throw", async () => {
    const p = await resolveUiDriverPath();
    expect(p === null || typeof p === "string").toBe(true);
  });

  it("detectDesktopAppExe does not throw on empty-ish trees", async () => {
    const p = await detectDesktopAppExe(process.cwd());
    expect(p === null || (typeof p === "string" && p.endsWith(".exe"))).toBe(true);
  });
});
