import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listDbProfiles, saveDbProfile } from "./db-profiles.mjs";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vigil-db-prof-"));
const saved = await saveDbProfile(tmp, {
  name: "UAT",
  engine: "mssql",
  host: "127.0.0.1",
  username: "sa",
  database: "AppDb",
  trustServerCertificate: true,
});
assert.equal(saved.ok, true);
assert.ok(saved.profile.id);

const list = await listDbProfiles(tmp);
assert.equal(list.length, 1);
assert.equal(list[0].host, "127.0.0.1");
assert.equal(list[0].engine, "mssql");
// No password field on disk
const raw = await fs.readFile(path.join(tmp, ".vigil", "db-profiles.json"), "utf8");
assert.equal(raw.includes("password"), false);

console.log("db-profiles.test.mjs: ok");
