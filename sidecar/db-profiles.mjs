/**
 * Local DB connection profiles (no passwords on disk).
 * File: .vigil/db-profiles.json
 */

import { promises as fs } from "node:fs";
import path from "node:path";

function profilesFile(cwd) {
  return path.join(cwd, ".vigil", "db-profiles.json");
}

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   engine: 'mssql' | 'postgres',
 *   host: string,
 *   port?: number,
 *   instance?: string,
 *   database?: string,
 *   username: string,
 *   encrypt?: boolean,
 *   trustServerCertificate?: boolean,
 *   sslMode?: string,
 * }} DbProfile
 */

/** @param {string} cwd */
export async function listDbProfiles(cwd = process.cwd()) {
  try {
    const raw = await fs.readFile(profilesFile(cwd), "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
    return list.filter(
      (p) =>
        p &&
        typeof p.host === "string" &&
        typeof p.username === "string" &&
        (p.engine === "mssql" || p.engine === "postgres"),
    );
  } catch {
    return [];
  }
}

/**
 * @param {string} cwd
 * @param {Partial<DbProfile> & { name: string, engine: string, host: string, username: string }} profile
 */
export async function saveDbProfile(cwd, profile) {
  const name = String(profile?.name || "").trim();
  const engine = String(profile?.engine || "").trim().toLowerCase();
  const host = String(profile?.host || "").trim();
  const username = String(profile?.username || "").trim();
  if (!name || !host || !username) {
    return { ok: false, error: "profile requires name, host, username" };
  }
  if (engine !== "mssql" && engine !== "postgres") {
    return { ok: false, error: "engine must be mssql or postgres" };
  }
  const id =
    String(profile.id || "")
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .toLowerCase() ||
    name
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .slice(0, 48) ||
    `db-${Date.now()}`;

  /** @type {DbProfile} */
  const next = {
    id,
    name,
    engine,
    host,
    username,
    port:
      profile.port != null && Number(profile.port)
        ? Number(profile.port)
        : engine === "mssql"
          ? 1433
          : 5432,
    instance: profile.instance ? String(profile.instance) : "",
    database: profile.database ? String(profile.database) : "",
    encrypt: profile.encrypt !== false,
    trustServerCertificate: profile.trustServerCertificate === true,
    sslMode: profile.sslMode ? String(profile.sslMode) : "prefer",
  };

  const dir = path.join(cwd, ".vigil");
  await fs.mkdir(dir, { recursive: true });
  const existing = await listDbProfiles(cwd);
  const idx = existing.findIndex((p) => p.id === id);
  if (idx >= 0) existing[idx] = next;
  else existing.push(next);
  await fs.writeFile(
    profilesFile(cwd),
    `${JSON.stringify({ profiles: existing }, null, 2)}\n`,
    "utf8",
  );
  return { ok: true, output: `Saved DB profile ${id} (${name})`, profile: next };
}

export async function getDbProfile(cwd, profileId) {
  const id = String(profileId || "").trim();
  if (!id) return null;
  const list = await listDbProfiles(cwd);
  return list.find((p) => p.id === id) || null;
}
