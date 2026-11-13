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
  const planMode = policies.planMode === true;
  const askMode = policies.askMode === true;
  const planExecuteUnlocked = policies.planExecuteUnlocked === true;

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
        planMode,
        askMode,
        planExecuteUnlocked,
      });
      if (decision === "allow") {
        return { approved: true };
      }
      if (decision === "deny") {
        return {
          approved: false,
          reason: askMode
            ? "Ask mode is on: read/discuss only — switch to Agent (or Plan→Execute) to edit files."
            : "Plan mode is on: write/ship tools are blocked until you Approve & Execute the plan.",
        };
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
    draft_support_ticket: { enabled: true, autoApprove: true },
    list_support_tickets: { enabled: true, autoApprove: true },
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
  if (toolName === "app_launch") {
    return `Launch EXE: ${String(obj.profile || obj.path || "project")}`;
  }
  if (toolName === "app_attach") {
    return `Attach EXE: ${obj.pid != null ? `pid ${obj.pid}` : String(obj.name || "app")}`;
  }
  if (toolName === "app_search_ui") {
    return `Search UI: ${String(obj.query || "").slice(0, 48)}`;
  }
  if (toolName === "app_screenshot") {
    return "Desktop app screenshot";
  }
  if (toolName === "app_screen_map") {
    return "Crawl desktop app menus (screen map)";
  }
  if (toolName === "app_keys") {
    return `Keys: ${String(obj.keys || "")}`;
  }
  if (toolName === "app_select") {
    return `Select ${String(obj.value || "")} on ${String(obj.ref || "ref")}`;
  }
  if (toolName === "app_profiles_save") {
    return `Save app profile: ${String(obj.name || obj.id || "profile")}`;
  }
  if (toolName === "app_close") {
    return "Close desktop app";
  }
  if (toolName === "sql_connect") {
    return `SQL connect: ${String(obj.profileId || obj.host || "db")}`;
  }
  if (toolName === "sql_test_connection") {
    return `Test SQL: ${String(obj.profileId || obj.host || "db")}`;
  }
  if (toolName === "sql_run") {
    return `SQL: ${String(obj.sql || "").slice(0, 64)}`;
  }
  if (toolName === "sql_profiles_save") {
    return `Save DB profile: ${String(obj.name || obj.id || "profile")}`;
  }
  if (toolName === "sql_disconnect") {
    return "SQL disconnect";
  }
  if (toolName === "draft_support_ticket") {
    return `Draft ticket: ${String(obj.title || obj.id || "support")}`;
  }
  if (toolName === "list_support_tickets") {
    return "List support tickets";
  }
  if (toolName === "sql_activity_live") {
    return "SQL activity live snapshot";
  }
  if (toolName === "sql_capture_start") {
    return "Start SQL activity capture";
  }
  if (toolName === "sql_capture_stop") {
    return "Stop SQL activity capture";
  }
  if (toolName === "sql_capture_list") {
    return "List SQL capture buffer";
  }
  return `${toolName}`;
}
