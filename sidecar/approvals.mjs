/**
 * Tool approval bridge: sidecar pauses dangerous tools until the UI responds.
 */

import { randomUUID } from "node:crypto";
import { permissionDecision } from "./permissions.mjs";

/** @type {Map<string, { resolve: (r: { approved: boolean; reason?: string }) => void; gate: ReturnType<typeof createApprovalGate> }>} */
const globalPending = new Map();

/**
 * Resolve an approval from the HTTP `/tool_approval` endpoint.
 * @param {string} id
 * @param {"allow" | "skip" | "allow_session"} decision
 */
export function resolvePendingApproval(id, decision) {
  const entry = globalPending.get(String(id));
  if (!entry) return false;
  return entry.gate.resolve(id, decision);
}

/** Reject every pending approval (client disconnect / Stop). */
export function cancelAllPendingApprovals(
  reason = "Turn was stopped before tool approval.",
) {
  for (const [id, entry] of [...globalPending.entries()]) {
    try {
      entry.gate.cancelAll(reason);
    } catch {
      globalPending.delete(id);
      entry.resolve?.({ approved: false, reason });
    }
  }
}

/**
 * @param {(evt: object) => void} emit
 * @param {boolean} autoRun
 * @param {{ commandAllowlist?: string[], pathDenylist?: string[] }} [policies]
 */
export function createApprovalGate(emit, autoRun, policies = {}) {
  /** @type {Map<string, { resolve: (r: { approved: boolean; reason?: string }) => void }>} */
  const pending = new Map();
  let sessionAllow = !!autoRun;
  const commandAllowlist = Array.isArray(policies.commandAllowlist)
    ? policies.commandAllowlist
    : [];
  const pathDenylist = Array.isArray(policies.pathDenylist)
    ? policies.pathDenylist
    : [];

  const gate = {
    get autoRun() {
      return !!autoRun;
    },
    get sessionAllow() {
      return sessionAllow;
    },
    enableSessionAllow() {
      sessionAllow = true;
    },
    /**
     * @param {{ toolCallId?: string; toolName?: string; input?: unknown; sessionId?: string }} request
     * @returns {Promise<{ approved: boolean; reason?: string }>}
     */
    async request(request) {
      const toolName = String(request.toolName || "tool");
      const input = request.input ?? {};
      const decision = permissionDecision({
        toolName,
        input,
        autoRun,
        sessionAllow,
        commandAllowlist,
        pathDenylist,
      });
      if (decision === "allow") {
        return { approved: true };
      }

      const id = String(request.toolCallId || randomUUID());

      emit({
        type: "tool_approval",
        id,
        toolCallId: id,
        sessionId: request.sessionId,
        toolName,
        input,
        summary: summarizeApproval(toolName, input),
      });

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          globalPending.delete(id);
          resolve({
            approved: false,
            reason: "Timed out waiting for tool approval.",
          });
        }, 10 * 60 * 1000);

        const entry = {
          resolve: (result) => {
            clearTimeout(timer);
            resolve(result);
          },
        };
        pending.set(id, entry);
        globalPending.set(id, { resolve: entry.resolve, gate });
      });
    },
    /**
     * @param {string} id
     * @param {"allow" | "skip" | "allow_session"} decision
     */
    resolve(id, decision) {
      const entry = pending.get(String(id));
      if (!entry) return false;
      pending.delete(String(id));
      globalPending.delete(String(id));
      if (decision === "allow_session") {
        sessionAllow = true;
        entry.resolve({ approved: true });
        return true;
      }
      if (decision === "allow") {
        entry.resolve({ approved: true });
        return true;
      }
      entry.resolve({
        approved: false,
        reason: "This tool call was rejected by the user and not executed.",
      });
      return true;
    },
    /** Reject anything still waiting (e.g. user stopped the turn). */
    cancelAll(reason = "Turn was stopped before tool approval.") {
      for (const [id, entry] of pending) {
        pending.delete(id);
        globalPending.delete(id);
        entry.resolve({ approved: false, reason });
      }
    },
  };

  return gate;
}

/**
 * Policies that require confirmation for write/run/patch when autoRun is off.
 * @param {boolean} autoRun
 */
export function buildToolPolicies(autoRun) {
  const autoApprove = !!autoRun;
  const dangerous = {
    enabled: true,
    autoApprove,
  };
  return {
    "*": { enabled: true, autoApprove },
    write_file: dangerous,
    apply_patch: dangerous,
    run_commands: dangerous,
    editor: dangerous,
    bash: dangerous,
    run_command: dangerous,
    search_files: { enabled: true, autoApprove: true },
    list_files: { enabled: true, autoApprove: true },
    read_file: { enabled: true, autoApprove: true },
    read_files: { enabled: true, autoApprove: true },
    search_codebase: { enabled: true, autoApprove: true },
    reindex_codebase: { enabled: true, autoApprove: true },
    find_definition: { enabled: true, autoApprove: true },
    find_references: { enabled: true, autoApprove: true },
    parallel_investigate: { enabled: true, autoApprove: true },
    manage_plan: { enabled: true, autoApprove: true },
    detect_project_scripts: { enabled: true, autoApprove: true },
    get_ci_status: { enabled: true, autoApprove: true },
    prepare_worktree: { enabled: true, autoApprove: false },
    create_pull_request: { enabled: true, autoApprove: false },
    // Nested agents + push touch the network/repo — require approval unless Auto-run.
    delegate_tasks: { enabled: true, autoApprove },
    push_and_check_ci: { enabled: true, autoApprove },
  };
}

function summarizeApproval(toolName, input) {
  if (!input || typeof input !== "object") {
    return `${toolName}`;
  }
  const obj = /** @type {Record<string, unknown>} */ (input);
  if (toolName === "write_file" || toolName === "editor") {
    return `Write ${String(obj.path || obj.file || "file")}`;
  }
  if (toolName === "apply_patch") {
    const patch =
      typeof obj.patch === "string"
        ? obj.patch
        : typeof obj.diff === "string"
          ? obj.diff
          : "";
    const files = [];
    for (const line of String(patch).split(/\r?\n/)) {
      for (const marker of [
        "*** Update File: ",
        "*** Add File: ",
        "*** Delete File: ",
      ]) {
        if (line.startsWith(marker)) files.push(line.slice(marker.length).trim());
      }
    }
    if (files.length > 1) return `Apply patch to ${files.length} files`;
    if (files.length === 1) return `Apply patch to ${files[0]}`;
    return `Apply patch${obj.path ? ` to ${String(obj.path)}` : ""}`;
  }
  if (toolName === "run_commands" || toolName === "run_command" || toolName === "bash") {
    const cmd =
      obj.command ||
      obj.cmd ||
      (Array.isArray(obj.commands) ? obj.commands.join(" && ") : null);
    return `Run: ${String(cmd || "command")}`;
  }
  if (toolName === "create_pull_request") {
    return `Create PR: ${String(obj.title || "untitled")}`;
  }
  if (toolName === "prepare_worktree") {
    return `Worktree: ${String(obj.branch || "branch")}`;
  }
  if (toolName === "get_ci_status") {
    return "Check CI status";
  }
  if (toolName === "push_and_check_ci") {
    return `Push & check CI (${String(obj.remote || "origin")})`;
  }
  if (toolName === "delegate_tasks") {
    const tasks = Array.isArray(obj.tasks) ? obj.tasks : [];
    return `Delegate ${tasks.length || "?"} parallel task(s)`;
  }
  if (toolName === "parallel_investigate") {
    const symbols = Array.isArray(obj.symbols) ? obj.symbols.length : 0;
    const q = String(obj.query || "").trim();
    if (q && symbols) return `Investigate “${q.slice(0, 40)}” + ${symbols} symbol(s)`;
    if (q) return `Investigate “${q.slice(0, 48)}”`;
    if (symbols) return `Investigate ${symbols} symbol(s)`;
    return "Parallel investigate";
  }
  if (toolName === "reindex_codebase") {
    return "Rebuild deep code index";
  }
  if (toolName === "find_definition") {
    return `Find definition: ${String(obj.symbol || "symbol")}`;
  }
  if (toolName === "find_references") {
    return `Find references: ${String(obj.symbol || "symbol")}`;
  }
  return `${toolName}`;
}
