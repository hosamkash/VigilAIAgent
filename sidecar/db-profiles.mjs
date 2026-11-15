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
 *   favorite?: boolean,
 *   lastDatabase?: string,
 *   updatedAt?: number,
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

  const existing = await listDbProfiles(cwd);
  const prev = existing.find((p) => p.id === id);

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
    favorite:
      profile.favorite === true ||
      (profile.favorite === undefined && prev?.favorite === true),
    lastDatabase:
      profile.lastDatabase != null
        ? String(profile.lastDatabase)
        : prev?.lastDatabase || "",
    updatedAt: Date.now(),
  };

  const dir = path.join(cwd, ".vigil");
  await fs.mkdir(dir, { recursive: true });
  const idx = existing.findIndex((p) => p.id === id);
  if (idx >= 0) existing[idx] = next;
  else existing.push(next);
  // Favorites first, then recently updated.
  existing.sort((a, b) => {
    const af = a.favorite ? 1 : 0;
    const bf = b.favorite ? 1 : 0;
    if (bf !== af) return bf - af;
    return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  });
  await fs.writeFile(
    profilesFile(cwd),
    `${JSON.stringify({ profiles: existing }, null, 2)}\n`,
    "utf8",
  );
  return { ok: true, output: `Saved DB profile ${id} (${name})`, profile: next };
}

/**
 * Patch favorite / lastDatabase without rewriting connection fields.
 * @param {string} cwd
 * @param {string} profileId
 * @param {{ favorite?: boolean, lastDatabase?: string }} patch
 */
export async function patchDbProfile(cwd, profileId, patch = {}) {
  const id = String(profileId || "").trim();
  if (!id) return { ok: false, error: "profileId required" };
  const existing = await listDbProfiles(cwd);
  const prev = existing.find((p) => p.id === id);
  if (!prev) return { ok: false, error: `DB profile not found: ${id}` };
  return saveDbProfile(cwd, {
    ...prev,
    favorite:
      patch.favorite !== undefined ? patch.favorite === true : prev.favorite,
    lastDatabase:
      patch.lastDatabase !== undefined
        ? String(patch.lastDatabase || "")
        : prev.lastDatabase,
  });
}

export async function getDbProfile(cwd, profileId) {
  const id = String(profileId || "").trim();
  if (!id) return null;
  const list = await listDbProfiles(cwd);
  return list.find((p) => p.id === id) || null;
}
