/**
 * Support / DB Copilot — HMAC calls into sidecar `op: "sql"`.
 */

import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  getLaunchSecret,
  getLaunchSession,
  getWorkspaceCwd,
  spawnSidecar,
} from "./secure-storage";

const SIDECAR_BASE = "http://127.0.0.1:47821";

export type DbEngine = "mssql" | "postgres";

export type DbProfile = {
  id: string;
  name: string;
  engine: DbEngine;
  host: string;
  port?: number;
  instance?: string;
  database?: string;
  username: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  sslMode?: string;
};

export type SqlSessionInfo = {
  connected: boolean;
  engine: DbEngine | null;
  profileId: string | null;
  label: string | null;
  database: string | null;
  readOnly: boolean;
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]!);
  return btoa(s);
}

async function signSidecarBody(
  secretHex: string,
  sessionId: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(secretHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(`${sessionId}${body}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return bytesToBase64(sig);
}

async function sidecarFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await tauriFetch(url, init);
  } catch {
    return fetch(url, init);
  }
}

async function sqlOp(
  action: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await spawnSidecar();
  const secret = await getLaunchSecret();
  const session = await getLaunchSession();
  const cwd = await getWorkspaceCwd().catch(() => undefined);
  const body = JSON.stringify({
    op: "sql",
    action,
    input: input || {},
    cwd,
  });
  const hmac = await signSidecarBody(secret, session.sessionId, body);
  const res = await sidecarFetch(SIDECAR_BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vigil-hmac": hmac,
      "x-vigil-session": session.sessionId,
    },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    throw new Error(String(json.error || `sql ${action} failed (${res.status})`));
  }
  return json;
}

export async function listDbProfilesUi(): Promise<DbProfile[]> {
  const out = await sqlOp("profiles_list");
  return Array.isArray(out.profiles) ? (out.profiles as DbProfile[]) : [];
}

export async function saveDbProfileUi(
  profile: Partial<DbProfile> & {
    name: string;
    engine: DbEngine;
    host: string;
    username: string;
  },
): Promise<DbProfile> {
  const out = await sqlOp("profiles_save", profile as Record<string, unknown>);
  return out.profile as DbProfile;
}

export async function saveDbPassword(
  profileId: string,
  password: string,
): Promise<void> {
  await invoke("save_db_credential", { profileId, password });
}

export async function getDbPassword(profileId: string): Promise<string> {
  return invoke<string>("get_db_credential", { profileId });
}

export async function testDbConnection(input: {
  profileId?: string;
  password?: string;
  engine?: DbEngine;
  host?: string;
  username?: string;
  database?: string;
  trustServerCertificate?: boolean;
}): Promise<string> {
  const out = await sqlOp("test", input as Record<string, unknown>);
  return String(out.output || "OK");
}

export async function connectDb(input: {
  profileId: string;
  password?: string;
}): Promise<SqlSessionInfo> {
  let password = input.password || "";
  if (!password && input.profileId) {
    try {
      password = await getDbPassword(input.profileId);
    } catch {
      /* missing */
    }
  }
  const out = await sqlOp("connect", {
    profileId: input.profileId,
    password,
  });
  return (
    (out.session as SqlSessionInfo) || {
      connected: true,
      engine: null,
      profileId: input.profileId,
      label: null,
      database: null,
      readOnly: true,
    }
  );
}

export async function disconnectDb(): Promise<void> {
  await sqlOp("disconnect");
}

export async function getSqlSessionUi(): Promise<SqlSessionInfo> {
  const out = await sqlOp("session");
  return (
    (out.session as SqlSessionInfo) || {
      connected: false,
      engine: null,
      profileId: null,
      label: null,
      database: null,
      readOnly: true,
    }
  );
}

export async function sqlActivityLiveUi(input?: {
  login?: string;
  host?: string;
  app?: string;
  database?: string;
}): Promise<{ output: string; count: number }> {
  const out = await sqlOp("activity_live", input as Record<string, unknown>);
  return {
    output: String(out.output || ""),
    count: Number(out.count) || 0,
  };
}

export async function sqlCaptureStartUi(input?: {
  maxMs?: number;
}): Promise<string> {
  const out = await sqlOp("capture_start", input as Record<string, unknown>);
  return String(out.output || "Capture started");
}

export async function sqlCaptureStopUi(): Promise<{
  output: string;
  count: number;
}> {
  const out = await sqlOp("capture_stop");
  return {
    output: String(out.output || ""),
    count: Number(out.count) || 0,
  };
}

export async function sqlCaptureStatusUi(): Promise<{
  capturing: boolean;
  count: number;
}> {
  const out = await sqlOp("capture_status");
  return {
    capturing: !!out.capturing,
    count: Number(out.count) || 0,
  };
}

export type SqlCatalogObject = {
  schema: string;
  name: string;
  type: string;
};

export async function listDatabasesUi(): Promise<string[]> {
  const out = await sqlOp("list_databases");
  return Array.isArray(out.databases) ? (out.databases as string[]) : [];
}

export async function listObjectsUi(input?: {
  schema?: string;
  kind?: "table" | "view" | "all";
}): Promise<SqlCatalogObject[]> {
  const out = await sqlOp("list_objects", input as Record<string, unknown>);
  if (!Array.isArray(out.objects)) return [];
  return (out.objects as SqlCatalogObject[]).map((o) => ({
    schema: String(o.schema || "dbo"),
    name: String(o.name || ""),
    type: String(o.type || "TABLE"),
  }));
}

export async function describeTableUi(input: {
  table: string;
  schema?: string;
}): Promise<string> {
  const out = await sqlOp("describe_table", input as Record<string, unknown>);
  return String(out.output || "");
}
