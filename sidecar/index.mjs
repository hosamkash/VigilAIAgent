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
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  list_files,
  read_file,
  write_file,
  buildVigilExtraTools,
  cancelActiveCommand,
  ensureCodeIndex,
  buildCodeIndex,
  upsertIndexedFile,
  getCodeIndexStatus,
} from "./tools.mjs";
import { createCheckpointWriter, installWriteCapture } from "./checkpoints.mjs";
import { AgentTextStream } from "./agent-stream.mjs";
import {
  buildToolPolicies,
  createApprovalGate,
  cancelAllPendingApprovals,
  resolvePendingApproval,
} from "./approvals.mjs";
import {
  extractPatchPaths,
  extractPatchText,
} from "./apply-patch-files.mjs";
import { formatProjectScriptTips } from "./project-scripts.mjs";

const PORT = Number(process.env.VIGIL_SIDECAR_PORT || 47821);
const SECRET = process.env.VIGIL_LAUNCH_SECRET || "";
const SESSION_ID = process.env.VIGIL_SESSION_ID || "";
/** Fallback only — every task should pass an explicit workspace cwd. */
const BOOT_CWD = process.env.VIGIL_CWD || process.cwd();

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

const GEMINI_ALIASES = {
  "gemini-3.8-pro": "gemini-3.1-pro-preview",
  "gemini-3-pro-preview": "gemini-3.1-pro-preview",
};

const GEMINI_FALLBACKS = [
  "gemini-3.8-flash",
  "gemini-3.1-pro-preview",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];

function geminiModelCandidates(primary) {
  const raw = normalizeModelId(primary) || "gemini-3.8-flash";
  const first = GEMINI_ALIASES[raw] || raw;
  const rest = GEMINI_FALLBACKS.filter((m) => m !== first);
  return [first, ...rest];
}

function isModelUnavailableError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("no longer available") ||
    msg.includes("not found") ||
    msg.includes("is not found") ||
    msg.includes("is not supported for generatecontent") ||
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

async function startWithModel(
  cline,
  {
    providerId,
    modelId,
    apiKey,
    cwd,
    prompt,
    extraTools,
    replyStyle,
    autoRun,
    toolPolicies,
    scriptTips,
  },
) {
  const style = typeof replyStyle === "string" ? replyStyle.trim() : "";
  const tips = typeof scriptTips === "string" ? scriptTips.trim() : "";
  const systemPrompt =
    "You are Vigil, a personal desktop AI coding agent. Be actionable. " +
    "Prefer read_file / list_files / search_files / search_codebase to understand the workspace. " +
    "When the user asks where a symbol lives, how modules connect, or what to read first " +
    "in a large repo, prefer search_codebase (deep local BM25+vector index + import graph + paths + content). " +
    "For a known symbol name, prefer find_definition then find_references before broad ripgrep. " +
    "Use search_files for precise regex/glob sweeps. " +
    "Call reindex_codebase only if index hits look stale after a large refactor. " +
    "Always search in the workspace cwd. " +
    "File/folder references in the prompt already include content or listings — use them before re-reading. " +
    "For NEW files only, call write_file with the full contents. " +
    "For edits to EXISTING files, prefer apply_patch (surgical diffs) over rewriting the whole file. " +
    "Never rewrite an existing file with write_file unless the user explicitly asked for a full replace " +
    "or the file is brand new. When changing several files, apply_patch once per file (or one multi-file patch). " +
    "HARD GATE: after a batch of meaningful code edits in the same turn, you MUST run the project's " +
    "preferred test (or lint if no test) via run_commands before you finish. " +
    "If it fails, fix with apply_patch and re-run until green or you hit a real blocker. " +
    "Do not claim done while tests are still failing. " +
    "When Auto-run is off, wait for tool approval before each non-allowlisted command. " +
    "For multi-step tasks, call manage_plan first with clear steps, keep exactly one in_progress, " +
    "and mark steps completed as you go so the user sees progress. " +
    "Do not skip manage_plan on large features, refactors, or test/fix loops. " +
    "For isolated experiments use prepare_worktree then pass workdir=... to later tools. " +
    "On large multi-area work, prefer parallel_investigate for cheap fan-out, or delegate_tasks " +
    "for independent subagents (optionally with branch worktrees). " +
    "After pushing a feature branch: create_pull_request (draft), then push_and_check_ci / get_ci_status; " +
    "if CI fails, fix with apply_patch, push_and_check_ci again until green. " +
    "Vigil Browser is the in-editor preview tab only. When the user asks to open a browser, " +
    "preview, localhost, a module, or a tool page: call browser_open with the full URL " +
    "(or 'project'). That updates the IDE tab — nothing outside Vigil. " +
    "NEVER launch Chrome, Chromium, Safari, or any OS browser window. " +
    "NEVER use terminal open/xdg-open. Prefer browser_open over browser_navigate for viewing. " +
    "If you need click/type automation on a website, browser_navigate runs headless (invisible) and still " +
    "updates Vigil Browser via browser_open. Never tell the user to use Command Palette. " +
    "For Windows WinForms/DevExpress desktop apps: use app_launch (path or 'project') → " +
    "app_snapshot → app_click / app_type / app_read / app_wait to open screens, fill fields, save, " +
    "and report results. Desktop tools work on Windows only. " +
    "Always reply in the same language as the user's latest message " +
    "(Arabic→Arabic, English→English, and the same for every other language). " +
    "Do not switch languages unless the user asks. Keep code and paths unchanged." +
    (tips ? `\n\nProject scripts:\n${tips}` : "") +
    (style ? `\n\n${style}` : "");
  const yolo = !!autoRun;
  return cline.start({
    config: {
      providerId,
      modelId,
      apiKey,
      cwd,
      workspaceRoot: cwd,
      mode: yolo ? "yolo" : "act",
      enableTools: true,
      enableSpawnAgent: false,
      enableAgentTeams: false,
      yolo,
      toolPolicies,
      systemPrompt,
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
  const cwd = String(payload.cwd || BOOT_CWD).replace(/\/+$/, "") || BOOT_CWD;
  const autoRun = payload.autoRun === true;
  const toolPolicies = buildToolPolicies(autoRun);
  const commandAllowlist = Array.isArray(payload.commandAllowlist)
    ? payload.commandAllowlist
    : [];
  const pathDenylist = Array.isArray(payload.pathDenylist)
    ? payload.pathDenylist
    : [];
  const approvalGate = createApprovalGate(emit, autoRun, {
    commandAllowlist,
    pathDenylist,
  });

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
    status: `provider=${providerId} model=${candidates[0]} cwd=${cwd} autoRun=${autoRun}`,
  });

  // Warm local code index in the background so search_codebase is ready.
  void ensureCodeIndex(cwd).then(
    (idx) =>
      emit({
        type: "status",
        status: `code_index=${idx.fileCount}f/${idx.chunkCount}c`,
      }),
    () => {},
  );

  const cline = await ClineCore.create({
    clientName: "vigil-agent",
    backendMode: "local",
    capabilities: {
      requestToolApproval: (request) => approvalGate.request(request),
    },
    toolPolicies,
  });

  const checkpoint = payload.checkpointId
    ? createCheckpointWriter({
        id: payload.checkpointId,
        workspace: cwd,
        createdAt: Number(payload.checkpointAt) || Date.now(),
      })
    : null;
  const releaseCapture = checkpoint
    ? installWriteCapture(checkpoint.remember, checkpoint.rememberSync)
    : () => {};

  /** Shared bag so model fallbacks update nested delegates too. */
  const subagentRuntime = {
    loadClineCore,
    providerId,
    modelId: candidates[0],
    apiKey,
    autoRun,
  };
  const extraTools = buildVigilExtraTools(
    cwd,
    (write) => {
      emit({
        type: "tool",
        toolName: "write_file",
        path: write.path,
        content: write.content,
        original: write.original ?? "",
      });
    },
    checkpoint?.remember,
    emit,
    {
      allowDelegate: true,
      subagent: subagentRuntime,
    },
  );
  emit({
    type: "status",
    status: `vigil_tools=${extraTools.map((t) => t.name).join(",")}`,
  });

  const visible = new AgentTextStream();
  let sent = "";
  /** @type {Map<string, string>} abs path → original content before apply_patch */
  const patchOriginals = new Map();
  const emitAnswer = () => {
    const next = visible.text;
    if (!next.startsWith(sent) || next.length === sent.length) return;
    emit({ type: "chunk", stream: "agent", text: next.slice(sent.length) });
    sent = next;
  };

  const resolveUnderCwd = (relOrAbs) => {
    const raw = String(relOrAbs || "").trim();
    if (!raw) return "";
    return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
  };

  const readUtf8Safe = (abs) => {
    try {
      return fs.readFileSync(abs, "utf8");
    } catch {
      return "";
    }
  };

  const emitApplyPatchFiles = (hookName, input) => {
    const patchText = extractPatchText(input);
    const paths = extractPatchPaths(patchText);
    const single =
      typeof input?.path === "string" && input.path.trim()
        ? [input.path.trim()]
        : [];
    const all = paths.length > 0 ? paths : single;
    if (all.length === 0) {
      emit({
        type: "tool",
        toolName: "apply_patch",
        hook: hookName === "tool_call" ? "start" : hookName === "tool_result" ? "end" : hookName,
      });
      return;
    }
    for (const rel of all) {
      const abs = resolveUnderCwd(rel);
      if (hookName === "tool_call") {
        const original = readUtf8Safe(abs);
        patchOriginals.set(abs, original);
        emit({
          type: "tool",
          toolName: "apply_patch",
          hook: "start",
          path: rel,
          original,
          content: "",
        });
      } else if (hookName === "tool_result") {
        const original = patchOriginals.get(abs) ?? "";
        patchOriginals.delete(abs);
        const content = readUtf8Safe(abs);
        void upsertIndexedFile(cwd, rel, content).catch(() => {});
        emit({
          type: "tool",
          toolName: "apply_patch",
          hook: "end",
          path: rel,
          original,
          content,
        });
      } else {
        emit({
          type: "tool",
          toolName: "apply_patch",
          hook: hookName,
          path: rel,
        });
      }
    }
  };

  const unsub = cline.subscribe((event) => {
    try {
      if (event.type === "chunk") {
        visible.push(event.payload?.chunk ?? "");
        emitAnswer();
      } else if (event.type === "agent_event") {
        const inner = event.payload?.event;
        if (typeof inner === "string") visible.push(inner);
        else if (inner && typeof inner === "object") visible.push(JSON.stringify(inner));
        emitAnswer();
      } else if (event.type === "hook") {
        const toolName = event.payload?.toolName;
        const hookName = event.payload?.hookEventName;
        if (toolName === "apply_patch") {
          emitApplyPatchFiles(hookName, event.payload?.input || event.payload || {});
          return;
        }
        emit({
          type: "tool",
          toolName,
          hook: hookName,
          path: event.payload?.path || event.payload?.input?.path,
          content: event.payload?.content || event.payload?.input?.content,
          command:
            event.payload?.command ||
            event.payload?.input?.command ||
            (Array.isArray(event.payload?.input?.commands)
              ? event.payload.input.commands.join(" && ")
              : undefined),
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
    const scriptTips = await formatProjectScriptTips(cwd).catch(() => "");

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
          replyStyle: payload.replyStyle,
          autoRun,
          toolPolicies,
          scriptTips,
        });
        const resultText = started?.result?.text ?? "";
        // Some SDKs return the 404 as answer text instead of throwing.
        if (providerId === "gemini" && isModelUnavailableError(resultText)) {
          lastErr = new Error(resultText || `Model ${candidate} unavailable`);
          emit({
            type: "warning",
            message: `Model ${candidate} unavailable, trying fallback…`,
          });
          started = null;
          continue;
        }
        usedModel = candidate;
        subagentRuntime.modelId = candidate;
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

    const text = visible.adoptFinal(started.result?.text ?? "");
    emitAnswer();
    const toolCalls = started.result?.toolCalls ?? [];
    emit({
      type: "done",
      sessionId: started.sessionId,
      text,
      toolCalls,
      modelId: usedModel,
      usage: visible.usage ?? undefined,
    });
    return { sessionId: started.sessionId, text, toolCalls, modelId: usedModel };
  } finally {
    approvalGate.cancelAll();
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
    releaseCapture();
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

    const requestCwd =
      String(payload.cwd || BOOT_CWD).replace(/\/+$/, "") || BOOT_CWD;

    if (payload.op === "list_files") {
      const result = await list_files(payload.path || ".", requestCwd);
      const out = JSON.stringify(result);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-vigil-hmac": sign(out),
      });
      res.end(out);
      return;
    }

    if (payload.op === "read_file") {
      const result = await read_file(payload.path, requestCwd);
      const out = JSON.stringify(result);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-vigil-hmac": sign(out),
      });
      res.end(out);
      return;
    }

    if (payload.op === "write_file") {
      const result = await write_file(
        payload.path,
        payload.content ?? "",
        requestCwd,
      );
      const out = JSON.stringify(result);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-vigil-hmac": sign(out),
      });
      res.end(out);
      return;
    }

    if (payload.op === "tool_approval") {
      const ok = resolvePendingApproval(
        String(payload.id || payload.toolCallId || ""),
        payload.decision === "allow_session"
          ? "allow_session"
          : payload.decision === "allow" || payload.approved === true
            ? "allow"
            : "skip",
      );
      const out = JSON.stringify({ ok });
      res.writeHead(ok ? 200 : 404, {
        "content-type": "application/json",
        "x-vigil-hmac": sign(out),
      });
      res.end(out);
      return;
    }

    if (payload.op === "ensure_code_index") {
      await ensureCodeIndex(requestCwd, {
        force: !!payload.force,
      });
      const status = await getCodeIndexStatus(requestCwd);
      const out = JSON.stringify(status);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-vigil-hmac": sign(out),
      });
      res.end(out);
      return;
    }

    if (payload.op === "reindex_codebase") {
      await buildCodeIndex(requestCwd);
      const status = await getCodeIndexStatus(requestCwd);
      const out = JSON.stringify(status);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-vigil-hmac": sign(out),
      });
      res.end(out);
      return;
    }

    if (payload.op === "code_index_status") {
      const status = await getCodeIndexStatus(requestCwd);
      const out = JSON.stringify(status);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-vigil-hmac": sign(out),
      });
      res.end(out);
      return;
    }

    if (payload.op === "update_code_index_file") {
      const rel = String(payload.path || "").trim();
      if (!rel) {
        const out = JSON.stringify({ ok: false, error: "path required" });
        res.writeHead(400, {
          "content-type": "application/json",
          "x-vigil-hmac": sign(out),
        });
        res.end(out);
        return;
      }
      const content =
        payload.delete === true || payload.content === null
          ? null
          : String(payload.content ?? "");
      const result = await upsertIndexedFile(requestCwd, rel, content);
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
        cwd: BOOT_CWD,
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

      const onClientGone = () => {
        cancelActiveCommand();
        cancelAllPendingApprovals();
      };
      req.on("close", onClientGone);
      res.on("close", onClientGone);

      try {
        emit({ type: "status", status: "starting" });
        await runClineTask(payload, emit);
      } catch (err) {
        emit({ type: "error", message: String(err) });
      }
      req.off("close", onClientGone);
      res.off("close", onClientGone);
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
