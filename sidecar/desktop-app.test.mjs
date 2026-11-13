import { describe, expect, it } from "vitest";
import {
  detectDesktopAppExe,
  getDesktopSession,
  isWindowsDesktopHost,
  listAppProfiles,
  resolveUiDriverPath,
  saveAppProfile,
} from "./desktop-app.mjs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

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

  it("getDesktopSession starts detached", () => {
    const s = getDesktopSession();
    expect(s.attached).toBe(false);
    expect(s.pid).toBeNull();
    expect(s.title).toBeNull();
    expect(s.path).toBeNull();
  });

  it("save/list app profiles round-trip under .vigil", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vigil-app-prof-"));
    try {
      const saved = await saveAppProfile(tmp, {
        name: "ERP UAT",
        path: "C:\\Apps\\ERP.exe",
        args: "/uat",
        cwd: "C:\\Apps",
      });
      expect(saved.ok).toBe(true);
      expect(saved.profile?.id).toBeTruthy();

      const listed = await listAppProfiles(tmp);
      expect(listed.length).toBe(1);
      expect(listed[0].name).toBe("ERP UAT");
      expect(listed[0].path).toContain("ERP.exe");
      expect(listed[0].args).toBe("/uat");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
