import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listDbProfiles,
  patchDbProfile,
  saveDbProfile,
} from "./db-profiles.mjs";

/** @type {string[]} */
const temps = [];

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe("db-profiles", () => {
  it("saves profiles without passwords and patches favorite/lastDatabase", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vigil-db-prof-"));
    temps.push(tmp);

    const saved = await saveDbProfile(tmp, {
      name: "UAT",
      engine: "mssql",
      host: "127.0.0.1",
      username: "sa",
      database: "AppDb",
      trustServerCertificate: true,
    });
    expect(saved.ok).toBe(true);
    expect(saved.profile.id).toBeTruthy();

    const list = await listDbProfiles(tmp);
    expect(list.length).toBe(1);
    expect(list[0].host).toBe("127.0.0.1");
    expect(list[0].engine).toBe("mssql");

    const raw = await fs.readFile(
      path.join(tmp, ".vigil", "db-profiles.json"),
      "utf8",
    );
    expect(raw.includes("password")).toBe(false);

    const patched = await patchDbProfile(tmp, saved.profile.id, {
      favorite: true,
      lastDatabase: "OtherDb",
    });
    expect(patched.ok).toBe(true);
    expect(patched.profile.favorite).toBe(true);
    expect(patched.profile.lastDatabase).toBe("OtherDb");
    expect(patched.profile.host).toBe("127.0.0.1");
  });
});
