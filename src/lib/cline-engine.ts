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
  /** Stops the in-flight sidecar read when the user cancels. */
  signal?: AbortSignal;
  /** User message this command belongs to. The sidecar stores the file snapshot under this id. */
  checkpointId?: string;
  checkpointAt?: number;
  /** Extra reply-style instructions from chat preferences. */
  replyStyle?: string;
  /** When true, tools auto-run (yolo). Default false — UI must approve writes/commands. */
  autoRun?: boolean;
  /** Plan mode: investigate/draft only until Execute unlocks writes. */
  planMode?: boolean;
  /** Ask mode: Q&A / discuss only — no edits. */
  askMode?: boolean;
  /** After user Approves & Executes an approved plan. */
  planExecuteUnlocked?: boolean;
  /** Commands that auto-approve even when autoRun is false. */
  commandAllowlist?: string[];
  /** Paths that always require confirmation for writes. */
  pathDenylist?: string[];
}

export type VigilStreamEvent =
  | { type: "routed"; routed: RoutedModel }
  | { type: "status"; status: string }
  | { type: "session"; sessionId: string }
  | { type: "chunk"; stream?: string; text: string }
  | { type: "agent_event"; event?: unknown }
  | {
      type: "tool";
      toolName?: string;
      path?: string;
      content?: string;
      /** Pre-edit file body (apply_patch / reliable diffs). */
      original?: string;
      command?: string;
      chunk?: string;
      stream?: string;
      exitCode?: number;
      url?: string;
      title?: string;
      imageBase64?: string;
      /** Desktop EXE session (app_session / app_screenshot). */
      attached?: boolean;
      pid?: number | null;
      /** SQL Copilot session (sql_session). */
      connected?: boolean;
      engine?: string | null;
      label?: string | null;
      database?: string | null;
      readOnly?: boolean;
      profileId?: string | null;
      hook?: string;
      event?: unknown;
      planItems?: Array<{
        id: string;
        content: string;
        status: string;
      }>;
      delegateJobs?: Array<{
        id: string;
        title: string;
        status: string;
        result?: string;
        error?: string;
        workdir?: string;
      }>;
      /** Support Ticket Composer (`draft_support_ticket`). */
      supportTicket?: Record<string, unknown>;
    }
  | {
      type: "tool_approval";
      id: string;
      toolCallId?: string;
      toolName?: string;
      summary?: string;
      input?: unknown;
      sessionId?: string;
    }
  | {
      type: "done";
      sessionId?: string;
      text?: string;
      toolCalls?: unknown[];
      usage?: { inputTokens: number; outputTokens: number; cost: number };
    }
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

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/** Reject as soon as `signal` aborts, even if `promise` never settles. */
export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException("The operation was stopped.", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("The operation was stopped.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/** Prefer Tauri HTTP plugin (scoped); fall back to global fetch in plain browser. */
async function sidecarFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await tauriFetch(url, init);
  } catch (err) {
    if (init.signal?.aborted || isAbortError(err)) throw err;
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

  const signal = options.signal;
  yield { type: "routed", routed };

  await withAbort(spawnSidecar(), signal);
  const apiKey = await withAbort(
    resolveApiKey(routed.providerId, options.apiKeys),
    signal,
  );
  const secret = await withAbort(getLaunchSecret(), signal);
  const session = await withAbort(getLaunchSession(), signal);
  const cwd =
    options.cwd ??
    (await withAbort(getWorkspaceCwd().catch(() => undefined), signal));

  const bodyObj = {
    op: "run_task",
    prompt,
    provider: routed.providerId,
    clineProviderId: routed.clineProviderId,
    modelId: routed.modelId,
    apiKey,
    cwd,
    clientName: options.clientName ?? "vigil-agent",
    checkpointId: options.checkpointId,
    checkpointAt: options.checkpointAt,
    replyStyle: options.replyStyle,
    autoRun: options.autoRun === true,
    planMode: options.planMode === true,
    askMode: options.askMode === true,
    planExecuteUnlocked: options.planExecuteUnlocked === true,
    commandAllowlist: options.commandAllowlist ?? [],
    pathDenylist: options.pathDenylist ?? [],
  };
  const body = JSON.stringify(bodyObj);
  const hmac = await signSidecarBody(secret, session.sessionId, body);

  const res = await withAbort(
    sidecarFetch(SIDECAR_RUN_TASK, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vigil-hmac": hmac,
        "x-vigil-session": session.sessionId,
      },
      body,
      signal,
    }),
    signal,
  );

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
  const stopReading = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", stopReading);

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("The operation was stopped.", "AbortError");
      }
      let done = false;
      let value: Uint8Array | undefined;
      try {
        const next = await reader.read();
        done = next.done;
        value = next.value;
      } catch (err) {
        if (signal?.aborted || isAbortError(err)) {
          throw new DOMException("The operation was stopped.", "AbortError");
        }
        throw err;
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (signal?.aborted) {
          throw new DOMException("The operation was stopped.", "AbortError");
        }
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed) as VigilStreamEvent;
        } catch {
          yield { type: "chunk", text: trimmed };
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", stopReading);
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
  const cwd = await getWorkspaceCwd().catch(() => undefined);
  const body = JSON.stringify({ op: "list_files", path: dirPath, cwd });
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
  if (!res.ok) {
    throw new Error(`list_files failed: ${res.status}`);
  }
  const result = (await res.json()) as { ok: boolean; output: string; error?: string };
  if (!result.ok) {
    throw new Error(result.error ?? "list_files failed");
  }
  return result.output;
}

/** Answer a pending tool approval prompt from the chat UI. */
export async function respondToolApproval(
  id: string,
  decision: "allow" | "skip" | "allow_session",
): Promise<boolean> {
  await spawnSidecar();
  const secret = await getLaunchSecret();
  const session = await getLaunchSession();
  const body = JSON.stringify({
    op: "tool_approval",
    id,
    toolCallId: id,
    decision,
    approved: decision === "allow" || decision === "allow_session",
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
  if (!res.ok) return false;
  const result = (await res.json()) as { ok?: boolean };
  return result.ok === true;
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

export type CodeIndexSummary = {
  ok: boolean;
  fileCount?: number;
  chunkCount?: number;
  vectorCount?: number;
  edgeCount?: number;
  version?: number | null;
  deep?: boolean;
  builtAt?: number | null;
  ready?: boolean;
  sizeBytes?: number;
  ageMs?: number | null;
  error?: string;
};

async function postSidecarOp(
  op: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  await spawnSidecar();
  const secret = await getLaunchSecret();
  const session = await getLaunchSession();
  const cwd = await getWorkspaceCwd().catch(() => undefined);
  const body = JSON.stringify({ op, cwd, ...extra });
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
  if (!res.ok) {
    throw new Error(`${op} failed: ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Ensure / warm the local BM25 code index in the sidecar. */
function toCodeIndexSummary(result: Record<string, unknown>): CodeIndexSummary {
  return {
    ok: result.ok !== false,
    ready: result.ready === true || Number(result.chunkCount || 0) > 0,
    deep: result.deep === true,
    fileCount: Number(result.fileCount || 0),
    chunkCount: Number(result.chunkCount || 0),
    vectorCount: Number(result.vectorCount || 0),
    edgeCount: Number(result.edgeCount || 0),
    version: typeof result.version === "number" ? result.version : null,
    builtAt: typeof result.builtAt === "number" ? result.builtAt : null,
    sizeBytes: Number(result.sizeBytes || 0),
    ageMs: typeof result.ageMs === "number" ? result.ageMs : null,
  };
}

export async function ensureLocalCodeIndex(
  force = false,
): Promise<CodeIndexSummary> {
  const result = await postSidecarOp("ensure_code_index", { force });
  return toCodeIndexSummary(result);
}

export async function reindexLocalCodeIndex(): Promise<CodeIndexSummary> {
  const result = await postSidecarOp("reindex_codebase");
  return toCodeIndexSummary(result);
}

export async function getLocalCodeIndexStatus(): Promise<CodeIndexSummary> {
  const result = await postSidecarOp("code_index_status");
  return toCodeIndexSummary(result);
}

/** Incremental update after an editor save. */
export async function updateLocalCodeIndexFile(
  relativePath: string,
  content: string | null,
): Promise<void> {
  await postSidecarOp("update_code_index_file", {
    path: relativePath,
    content,
    delete: content === null,
  });
}
