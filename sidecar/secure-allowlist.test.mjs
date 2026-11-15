import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addAllowlistHost,
  listAllowHosts,
  loadAllowlist,
  removeAllowlistHost,
} from "./secure-allowlist.mjs";

/** @type {string[]} */
const temps = [];

async function tmpRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vigil-secure-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe("secure-allowlist", () => {
  it("requires confirm for remote hosts", async () => {
    const root = await tmpRoot();
    await expect(
      addAllowlistHost(root, { host: "acme.test" }),
    ).rejects.toThrow(/confirm/i);
  });

  it("adds localhost without confirm and persists", async () => {
    const root = await tmpRoot();
    await addAllowlistHost(root, { host: "localhost" });
    await addAllowlistHost(root, {
      host: "myapp.test",
      confirm: true,
      note: "owned",
    });
    const hosts = await listAllowHosts(root);
    expect(hosts).toContain("localhost");
    expect(hosts).toContain("myapp.test");
    const loaded = await loadAllowlist(root);
    expect(loaded.hosts.find((h) => h.host === "myapp.test")?.note).toBe(
      "owned",
    );
    await removeAllowlistHost(root, "myapp.test");
    expect(await listAllowHosts(root)).not.toContain("myapp.test");
  });
});
