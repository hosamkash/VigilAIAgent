/**
 * Vigil agent client (browser / Tauri webview).
 *
 * ClineCore runs ONLY in the Node sidecar (`sidecar/index.mjs`).
 * This module must never import `@cline/*` — Vite would try to bundle Node SDK.
 *
 * Flow: getApiKey (Rust) → spawn_sidecar → HMAC fetch → NDJSON stream.
 */

import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  getApiKey,
  getLaunchSecret,
  getLaunchSession,
  getWorkspaceCwd,
  spawnSidecar,
} from "./secure-storage";
import {
  routeTask,
  type LlmProviderId,
  type RoutedModel,
} from "./model-router";

export type { LlmProviderId, RoutedModel };

const SIDECAR_BASE = "http://127.0.0.1:47821";
const SIDECAR_RUN_TASK = `${SIDECAR_BASE}/run_task`;
const SIDECAR_PING = `${SIDECAR_BASE}/ping`;

/** Mirrors SDK DefaultToolNames for Phase 0 tests (no browser SDK import). */
export const DefaultToolNames = {
  READ_FILES: "read_files",
  SEARCH_CODEBASE: "search_codebase",
  RUN_COMMANDS: "run_commands",
  FETCH_WEB_CONTENT: "fetch_web_content",
  APPLY_PATCH: "apply_patch",
  EDITOR: "editor",
  SKILLS: "skills",
  ASK_QUESTION: "ask_question",
  SUBMIT_AND_EXIT: "submit_and_exit",
} as const;

export interface VigilEngineOptions {
  clientName?: string;
  cwd?: string;
  preferredProvider?: LlmProviderId;
  /** Pre-routed model; if omitted, routeTask is used. */
  model?: RoutedModel;
  /** Optional preloaded keys (tests). Prefer getApiKey in production. */
  apiKeys?: Partial<Record<LlmProviderId, string>>;
}

export type VigilStreamEvent =
  | { type: "routed"; routed: RoutedModel }
  | { type: "status"; status: string }
  | { type: "session"; sessionId: string }
  | { type: "chunk"; stream?: string; text: string }
  | {
      type: "tool";
      toolName?: string;
      path?: string;
      content?: string;
      hook?: string;
      event?: unknown;
    }
  | { type: "done"; sessionId?: string; text?: string; toolCalls?: unknown[] }
  | { type: "error"; message: string }
  | { type: "warning"; message: string }
  | { type: "event"; event: unknown };

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

async function resolveApiKey(
  provider: LlmProviderId,
  apiKeys?: Partial<Record<LlmProviderId, string>>,
): Promise<string> {
  if (apiKeys?.[provider]) return apiKeys[provider]!;
  try {
    return await getApiKey(provider);
  } catch (err) {
    throw new Error(
      `Missing API key for provider "${provider}". Add it in Settings (OS Keychain). (${String(err)})`,
    );
  }
}

/** Prefer Tauri HTTP plugin (scoped); fall back to global fetch in plain browser. */
async function sidecarFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await tauriFetch(url, init);
  } catch {
    return fetch(url, init);
  }
}

/**
 * Ensure Node sidecar is running, then stream a ClineCore session via HTTP.
 * ClineCore.create lives only in sidecar/index.mjs.
 */
export async function* runVigilTask(
  prompt: string,
  options: VigilEngineOptions = {},
): AsyncGenerator<VigilStreamEvent> {
  const routed =
    options.model ??
    routeTask({
      prompt,
      preferredProvider: options.preferredProvider,
    });

  yield { type: "routed", routed };

  await spawnSidecar();
  const apiKey = await resolveApiKey(routed.providerId, options.apiKeys);
  const secret = await getLaunchSecret();
  const session = await getLaunchSession();
  const cwd = options.cwd ?? (await getWorkspaceCwd().catch(() => undefined));

  const bodyObj = {
    op: "run_task",
    prompt,
    provider: routed.providerId,
    clineProviderId: routed.clineProviderId,
    modelId: routed.modelId,
    apiKey,
    cwd,
    clientName: options.clientName ?? "vigil-agent",
  };
  const body = JSON.stringify(bodyObj);
  const hmac = await signSidecarBody(secret, session.sessionId, body);

  const res = await sidecarFetch(SIDECAR_RUN_TASK, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vigil-hmac": hmac,
      "x-vigil-session": session.sessionId,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    yield {
      type: "error",
      message: `Sidecar HTTP ${res.status}: ${text || res.statusText}`,
    };
    return;
  }

  if (!res.body) {
    yield { type: "error", message: "Sidecar returned empty body" };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed) as VigilStreamEvent;
      } catch {
        yield { type: "chunk", text: trimmed };
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim()) as VigilStreamEvent;
    } catch {
      yield { type: "chunk", text: buffer.trim() };
    }
  }
}

/**
 * List workspace files via sidecar HTTP (no Node fs in the webview).
 */
export async function listWorkspaceFiles(dirPath = "."): Promise<string> {
  await spawnSidecar();
  const secret = await getLaunchSecret();
  const session = await getLaunchSession();
  const body = JSON.stringify({ op: "list_files", path: dirPath });
  const hmac = await signSidecarBody(secret, session.sessionId, body);
  const res = await sidecarFetch(SIDECAR_BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vigil-hmac": hmac,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`list_files failed: ${res.status}`);
  }
  const result = (await res.json()) as { ok: boolean; output: string; error?: string };
  if (!result.ok) {
    throw new Error(result.error ?? "list_files failed");
  }
  return result.output;
}

export function getSdkDefaultToolNames(): readonly string[] {
  return Object.values(DefaultToolNames);
}

export async function pingSidecar(): Promise<{
  ok: boolean;
  sessionId?: string;
}> {
  await spawnSidecar();
  const secret = await getLaunchSecret();
  const session = await getLaunchSession();
  const body = JSON.stringify({ op: "ping" });
  const hmac = await signSidecarBody(secret, session.sessionId, body);
  const res = await sidecarFetch(SIDECAR_PING, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vigil-hmac": hmac,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`sidecar ping failed: ${res.status}`);
  }
  return res.json();
}

export async function ensureSidecar(): Promise<void> {
  await invoke("spawn_sidecar");
}
