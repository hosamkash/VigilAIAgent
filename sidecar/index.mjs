/**
 * Node 22+ sidecar for @cline/sdk (ClineCore).
 * Communicates with Rust/frontend via HMAC-signed messages using per-launch secret.
 *
 * Env:
 *   VIGIL_LAUNCH_SECRET  — hex-encoded 32-byte shared secret from Rust
 *   VIGIL_SESSION_ID     — launch session id
 *   VIGIL_SIDECAR_PORT   — listen port (default 47821)
 *   VIGIL_CWD            — workspace root
 */

import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  list_files,
  read_file,
  write_file,
  buildVigilExtraTools,
} from "./tools.mjs";

const PORT = Number(process.env.VIGIL_SIDECAR_PORT || 47821);
const SECRET = process.env.VIGIL_LAUNCH_SECRET || "";
const SESSION_ID = process.env.VIGIL_SESSION_ID || "";
const CWD = process.env.VIGIL_CWD || process.cwd();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function sign(body) {
  const mac = createHmac("sha256", Buffer.from(SECRET, "hex"));
  mac.update(SESSION_ID);
  mac.update(body);
  return mac.digest("base64");
}

function verify(body, signatureB64) {
  if (!SECRET || !SESSION_ID) return false;
  return sign(body) === signatureB64;
}

async function loadClineCore() {
  // Prefer @cline/core, fall back to @cline/sdk re-export — Node-only.
  try {
    const corePath = path.join(
      projectRoot,
      "node_modules",
      "@cline",
      "core",
      "dist",
      "index.js",
    );
    const mod = await import(pathToFileURL(corePath).href);
    if (mod.ClineCore?.create) return mod.ClineCore;
  } catch {
    /* fall through */
  }
  const sdkPath = path.join(
    projectRoot,
    "node_modules",
    "@cline",
    "sdk",
    "dist",
    "index.js",
  );
  const mod = await import(pathToFileURL(sdkPath).href);
  return mod.ClineCore;
}

/**
 * Map Vigil / legacy provider names → Cline built-in provider ids.
 * Bare "openai" is NOT valid in @cline/llms — use "openai-native".
 */
function resolveClineProvider(raw) {
  const id = String(raw || "gemini").toLowerCase().trim();
  if (id === "openai" || id === "openai-native") return "openai-native";
  if (id === "openai-compatible" || id === "openai-compat") return "openai-compatible";
  if (id === "gemini" || id === "google") return "gemini";
  if (id === "anthropic" || id === "claude") return "anthropic";
  return id;
}

/** Strip provider/ and models/ prefixes → bare model id for Cline. */
function normalizeModelId(raw) {
  let modelId = String(raw || "").trim();
  if (!modelId) return "";
  // "gemini/gemini-3.8-flash" or "openai/gpt-4o-mini"
  if (modelId.includes("/")) {
    const parts = modelId.split("/");
    // drop leading "models" segment if present: models/gemini-3.8-flash
    if (parts[0] === "models") {
      modelId = parts.slice(1).join("/");
    } else if (
      ["gemini", "google", "openai", "openai-native", "anthropic", "claude"].includes(
        parts[0].toLowerCase(),
      )
    ) {
      modelId = parts.slice(1).join("/") || modelId;
    }
  }
  if (modelId.startsWith("models/")) {
    modelId = modelId.slice("models/".length);
  }
  return modelId;
}

const GEMINI_FALLBACKS = [
  "gemini-3.8-flash",
  "gemini-3.8-pro",
  "gemini-3.1-pro-preview",
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

function geminiModelCandidates(primary) {
  const first = normalizeModelId(primary) || "gemini-3.8-flash";
  const rest = GEMINI_FALLBACKS.filter((m) => m !== first);
  return [first, ...rest];
}

function isModelUnavailableError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("no longer available") ||
    msg.includes("not found") ||
    msg.includes("is not found") ||
    msg.includes("invalid model") ||
    msg.includes("unknown model") ||
    msg.includes("404") ||
    msg.includes("model_not_found")
  );
}

/**
 * Accept either split fields or "provider/model" style strings.
 */
function resolveProviderAndModel(payload) {
  let providerRaw =
    payload.clineProviderId || payload.provider || payload.apiProvider || "";
  let modelRaw = payload.modelId || payload.model || "";

  // Infer provider from "gemini/..." if needed
  const slashSource =
    typeof modelRaw === "string" && modelRaw.includes("/")
      ? modelRaw
      : typeof payload.model === "string" && payload.model.includes("/")
        ? payload.model
        : "";
  if (slashSource && !providerRaw) {
    const [prov] = slashSource.split("/");
    if (prov && prov !== "models") providerRaw = prov;
  }

  const providerId = resolveClineProvider(providerRaw || "gemini");
  let modelId = normalizeModelId(modelRaw);
  if (!modelId) {
    modelId =
      providerId === "gemini"
        ? "gemini-3.8-flash"
        : providerId === "anthropic"
          ? "claude-3-5-haiku-latest"
          : "gpt-4o-mini";
  }

  return { providerId, modelId };
}

async function startWithModel(cline, { providerId, modelId, apiKey, cwd, prompt, extraTools }) {
  return cline.start({
    config: {
      providerId,
      modelId,
      apiKey,
      cwd,
      mode: "yolo",
      enableTools: true,
      enableSpawnAgent: false,
      enableAgentTeams: false,
      yolo: true,
      systemPrompt:
        "You are Vigil, a personal desktop AI coding agent. Be concise and actionable. " +
        "Prefer the write_file / read_file / list_files tools for filesystem work. " +
        "When asked to create a file, call write_file immediately with the full contents.",
      extraTools,
    },
    prompt,
    interactive: false,
    localRuntime: {
      extraTools,
    },
  });
}

async function runClineTask(payload, emit) {
  const ClineCore = await loadClineCore();
  const { providerId, modelId } = resolveProviderAndModel(payload);
  const apiKey = payload.apiKey;
  const prompt = payload.prompt || "";
  const cwd = payload.cwd || CWD;

  if (!apiKey) {
    throw new Error(
      `apiKey is required for provider "${providerId}". Save it in Settings (OS Keychain).`,
    );
  }
  if (!prompt.trim()) {
    throw new Error("prompt is required");
  }

  const candidates =
    providerId === "gemini" ? geminiModelCandidates(modelId) : [modelId];

  emit({
    type: "status",
    status: `provider=${providerId} model=${candidates[0]}`,
  });

  const cline = await ClineCore.create({
    clientName: "vigil-agent",
    backendMode: "local",
  });

  const extraTools = buildVigilExtraTools(cwd, (write) => {
    emit({
      type: "tool",
      toolName: "write_file",
      path: write.path,
      content: write.content,
    });
  });

  const unsub = cline.subscribe((event) => {
    try {
      if (event.type === "chunk") {
        emit({
          type: "chunk",
          stream: event.payload?.stream,
          text: event.payload?.chunk ?? "",
        });
      } else if (event.type === "agent_event") {
        const inner = event.payload?.event;
        emit({ type: "agent_event", event: inner });
      } else if (event.type === "hook") {
        emit({
          type: "tool",
          toolName: event.payload?.toolName,
          hook: event.payload?.hookEventName,
        });
      } else if (event.type === "ended") {
        emit({ type: "status", status: "ended" });
      } else {
        emit({ type: "event", event });
      }
    } catch (err) {
      emit({ type: "warning", message: String(err) });
    }
  });

  try {
    let started = null;
    let usedModel = candidates[0];
    let lastErr = null;

    for (const candidate of candidates) {
      try {
        emit({ type: "status", status: `trying model=${candidate}` });
        started = await startWithModel(cline, {
          providerId,
          modelId: candidate,
          apiKey,
          cwd,
          prompt,
          extraTools,
        });
        usedModel = candidate;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (providerId === "gemini" && isModelUnavailableError(err)) {
          emit({
            type: "warning",
            message: `Model ${candidate} unavailable, trying fallback… (${String(err)})`,
          });
          continue;
        }
        throw err;
      }
    }

    if (!started) {
      throw lastErr || new Error("All Gemini model candidates failed");
    }

    emit({
      type: "session",
      sessionId: started.sessionId,
      modelId: usedModel,
    });

    const text = started.result?.text ?? "";
    if (text) {
      emit({ type: "chunk", stream: "agent", text });
    }
    const toolCalls = started.result?.toolCalls ?? [];
    emit({
      type: "done",
      sessionId: started.sessionId,
      text,
      toolCalls,
      modelId: usedModel,
    });
    return { sessionId: started.sessionId, text, toolCalls, modelId: usedModel };
  } finally {
    try {
      unsub();
    } catch {
      /* ignore */
    }
    try {
      await cline.dispose();
    } catch {
      /* ignore */
    }
  }
}

function isRunTaskRequest(req, payload) {
  const url = String(req.url || "");
  return (
    payload.op === "run_task" ||
    url === "/run_task" ||
    url.startsWith("/run_task?")
  );
}

function isPingRequest(req, payload) {
  const url = String(req.url || "");
  return payload.op === "ping" || url === "/ping" || url.startsWith("/ping?");
}

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString("utf8");
  const sig = req.headers["x-vigil-hmac"] || "";

  if (!verify(body || "", String(sig))) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid hmac" }));
    return;
  }

  try {
    const payload = body ? JSON.parse(body) : {};

    if (payload.op === "list_files") {
      const result = await list_files(payload.path || ".", CWD);
      const out = JSON.stringify(result);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-vigil-hmac": sign(out),
      });
      res.end(out);
      return;
    }

    if (payload.op === "read_file") {
      const result = await read_file(payload.path, CWD);
      const out = JSON.stringify(result);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-vigil-hmac": sign(out),
      });
      res.end(out);
      return;
    }

    if (payload.op === "write_file") {
      const result = await write_file(payload.path, payload.content ?? "", CWD);
      const out = JSON.stringify(result);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-vigil-hmac": sign(out),
      });
      res.end(out);
      return;
    }

    if (isPingRequest(req, payload)) {
      const out = JSON.stringify({
        ok: true,
        sessionId: SESSION_ID,
        cwd: CWD,
      });
      res.writeHead(200, {
        "content-type": "application/json",
        "x-vigil-hmac": sign(out),
      });
      res.end(out);
      return;
    }

    if (isRunTaskRequest(req, payload)) {
      res.writeHead(200, {
        "content-type": "application/x-ndjson",
        "transfer-encoding": "chunked",
        "x-vigil-stream": "1",
      });

      const emit = (evt) => {
        const line = `${JSON.stringify(evt)}\n`;
        res.write(line);
      };

      try {
        emit({ type: "status", status: "starting" });
        await runClineTask(payload, emit);
      } catch (err) {
        emit({ type: "error", message: String(err) });
      }
      res.end();
      return;
    }

    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unknown op" }));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[vigil-sidecar] listening on 127.0.0.1:${PORT}`);
});
