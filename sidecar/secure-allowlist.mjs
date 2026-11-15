/**
 * Local Secure allowlist — `.vigil/secure-allowlist.json`
 * Ownership: localhost always ok; remote hosts require explicit confirm.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { isLocalHostname } from "./secure-target.mjs";

const FILE = "secure-allowlist.json";

/**
 * @param {string} workspaceRoot
 */
export function allowlistPath(workspaceRoot) {
  return path.join(workspaceRoot, ".vigil", FILE);
}

/**
 * @typedef {{ host: string, confirmedAt: number, note?: string, ownership?: string }} AllowEntry
 */

/**
 * @param {string} workspaceRoot
 * @returns {Promise<{ hosts: AllowEntry[], updatedAt: number }>}
 */
export async function loadAllowlist(workspaceRoot) {
  const p = allowlistPath(workspaceRoot);
  try {
    const raw = await fs.readFile(p, "utf8");
    const data = JSON.parse(raw);
    const hosts = Array.isArray(data?.hosts) ? data.hosts : [];
    return {
      hosts: hosts
        .map((h) => ({
          host: String(h.host || h || "")
            .trim()
            .toLowerCase(),
          confirmedAt: Number(h.confirmedAt) || 0,
          note: h.note ? String(h.note) : undefined,
          ownership: h.ownership ? String(h.ownership) : undefined,
        }))
        .filter((h) => h.host),
      updatedAt: Number(data?.updatedAt) || 0,
    };
  } catch (e) {
    if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) {
      return { hosts: [], updatedAt: 0 };
    }
    throw e;
  }
}

/**
 * @param {string} workspaceRoot
 * @param {{ hosts: AllowEntry[] }} data
 */
export async function saveAllowlist(workspaceRoot, data) {
  const dir = path.join(workspaceRoot, ".vigil");
  await fs.mkdir(dir, { recursive: true });
  const payload = {
    version: 1,
    updatedAt: Date.now(),
    hosts: (data.hosts || []).map((h) => ({
      host: String(h.host).trim().toLowerCase(),
      confirmedAt: h.confirmedAt || Date.now(),
      note: h.note || undefined,
      ownership: h.ownership || undefined,
    })),
  };
  await fs.writeFile(allowlistPath(workspaceRoot), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

/**
 * @param {string} workspaceRoot
 * @param {{ host: string, confirm?: boolean, note?: string, ownership?: string }} input
 */
export async function addAllowlistHost(workspaceRoot, input) {
  const host = String(input.host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0];
  if (!host) throw new Error("host required");
  if (!isLocalHostname(host) && !input.confirm) {
    throw new Error(
      "Remote hosts require confirm=true (typed ownership confirmation). " +
        "الاستضافة البعيدة تحتاج تأكيد ملكية (confirm=true).",
    );
  }
  const cur = await loadAllowlist(workspaceRoot);
  const next = cur.hosts.filter((h) => h.host !== host);
  next.push({
    host,
    confirmedAt: Date.now(),
    note: input.note,
    ownership: input.ownership || (isLocalHostname(host) ? "local" : "user_confirm"),
  });
  return saveAllowlist(workspaceRoot, { hosts: next });
}

/**
 * @param {string} workspaceRoot
 * @param {string} host
 */
export async function removeAllowlistHost(workspaceRoot, host) {
  const h = String(host || "")
    .trim()
    .toLowerCase();
  const cur = await loadAllowlist(workspaceRoot);
  return saveAllowlist(workspaceRoot, {
    hosts: cur.hosts.filter((x) => x.host !== h),
  });
}

/**
 * @param {string} workspaceRoot
 */
export async function listAllowHosts(workspaceRoot) {
  const cur = await loadAllowlist(workspaceRoot);
  return cur.hosts.map((h) => h.host);
}
