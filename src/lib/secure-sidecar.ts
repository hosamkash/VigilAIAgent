/**
 * Vigil Secure — HMAC calls into sidecar `op: "secure"`.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  getLaunchSecret,
  getLaunchSession,
  getWorkspaceCwd,
  spawnSidecar,
} from "./secure-storage";

import { sidecarBaseUrl } from "./sidecar-endpoint";

export type SecureAllowEntry = {
  host: string;
  confirmedAt: number;
  note?: string;
  ownership?: string;
};

export type SecureFinding = {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  detail: string;
  evidence?: string;
  path?: string;
  education?: {
    title: string;
    what: string;
    why: string;
    fixHint: string;
  };
  educationAr?: {
    title: string;
    what: string;
    why: string;
    fixHint: string;
  };
};

export type SecureScanResult = {
  ok: boolean;
  error?: string;
  pack?: string;
  target?: string;
  scannedAt?: number;
  findings: SecureFinding[];
  summary?: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  screenshotBase64?: string;
  screenshotUrl?: string;
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

async function secureOp(
  action: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await spawnSidecar();
  const secret = await getLaunchSecret();
  const session = await getLaunchSession();
  const cwd = await getWorkspaceCwd().catch(() => undefined);
  const body = JSON.stringify({
    op: "secure",
    action,
    input: input || {},
    cwd,
  });
  const hmac = await signSidecarBody(secret, session.sessionId, body);
  const res = await sidecarFetch(sidecarBaseUrl(), {
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
    throw new Error(String(json.error || `secure ${action} failed (${res.status})`));
  }
  return json;
}

export async function listSecureAllowlist(): Promise<SecureAllowEntry[]> {
  const out = await secureOp("allowlist_list");
  return Array.isArray(out.hosts) ? (out.hosts as SecureAllowEntry[]) : [];
}

export async function addSecureAllowHost(input: {
  host: string;
  confirm?: boolean;
  note?: string;
}): Promise<SecureAllowEntry[]> {
  const out = await secureOp("allowlist_add", input);
  return Array.isArray(out.hosts) ? (out.hosts as SecureAllowEntry[]) : [];
}

export async function removeSecureAllowHost(host: string): Promise<SecureAllowEntry[]> {
  const out = await secureOp("allowlist_remove", { host });
  return Array.isArray(out.hosts) ? (out.hosts as SecureAllowEntry[]) : [];
}

function mapScanResult(out: Record<string, unknown>): SecureScanResult {
  return {
    ok: out.ok !== false,
    error: out.error ? String(out.error) : undefined,
    pack: out.pack ? String(out.pack) : undefined,
    target: out.target ? String(out.target) : undefined,
    scannedAt: typeof out.scannedAt === "number" ? out.scannedAt : undefined,
    findings: Array.isArray(out.findings) ? (out.findings as SecureFinding[]) : [],
    summary: out.summary as SecureScanResult["summary"],
    screenshotBase64:
      typeof out.screenshotBase64 === "string" ? out.screenshotBase64 : undefined,
    screenshotUrl:
      typeof out.screenshotUrl === "string" ? out.screenshotUrl : undefined,
  };
}

export async function runSecurePassiveScan(url?: string): Promise<SecureScanResult> {
  const out = await secureOp("scan_passive", url ? { url } : {});
  return mapScanResult(out);
}

export async function runSecureActiveScan(
  url?: string,
  confirm = true,
): Promise<SecureScanResult> {
  const out = await secureOp("scan_active", {
    ...(url ? { url } : {}),
    confirm,
  });
  return mapScanResult(out);
}

export async function getSecurePreviewUrl(): Promise<string | null> {
  try {
    const out = await secureOp("preview_url");
    return out.previewUrl ? String(out.previewUrl) : null;
  } catch {
    return null;
  }
}
