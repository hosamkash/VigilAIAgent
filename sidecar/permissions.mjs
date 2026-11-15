/** Sidecar-side permission helpers (mirrors src/lib/agent-permissions.ts). */

export function matchGlobish(pattern, value) {
  const p = String(pattern || "").trim().toLowerCase();
  const v = String(value || "").trim().toLowerCase();
  if (!p) return false;
  if (p === v) return true;
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(v);
}

export function commandMatchesAllowlist(command, allowlist = []) {
  const cmd = String(command || "").trim();
  if (!cmd) return false;
  return allowlist.some((pattern) => matchGlobish(pattern, cmd));
}

export function pathMatchesDenylist(filePath, denylist = []) {
  const norm = String(filePath || "").replace(/\\/g, "/");
  const base = norm.split("/").pop() || norm;
  return denylist.some(
    (pattern) => matchGlobish(pattern, norm) || matchGlobish(pattern, base),
  );
}

export function extractCommand(input) {
  if (!input || typeof input !== "object") return "";
  if (typeof input.command === "string") return input.command;
  if (Array.isArray(input.commands)) return input.commands.map(String).join(" && ");
  return "";
}

export function extractPath(input) {
  if (!input || typeof input !== "object") return "";
  if (typeof input.path === "string") return input.path;
  if (typeof input.file === "string") return input.file;
  return "";
}

/** Tools blocked while Plan mode is on and Execute has not unlocked writes. */
export const PLAN_MODE_WRITE_TOOLS = new Set([
  "write_file",
  "apply_patch",
  "editor",
  "create_pull_request",
  "push_and_check_ci",
  "prepare_worktree",
  "delegate_tasks",
]);

/**
 * Decide whether a tool can auto-run under fine-grained policies.
 * @returns {"allow" | "deny" | "ask"}
 */
export function permissionDecision({
  toolName,
  input,
  autoRun,
  sessionAllow,
  commandAllowlist = [],
  pathDenylist = [],
  planMode = false,
  askMode = false,
  planExecuteUnlocked = false,
}) {
  const name = String(toolName || "");
  const writeLike =
    name === "write_file" ||
    name === "apply_patch" ||
    name === "editor";
  const runLike =
    name === "run_commands" ||
    name === "run_command" ||
    name === "bash";

  // Hard gate: Plan + Ask forbid mutating / shipping tools (Execute unlocks Plan only).
  const blockWrites =
    (planMode && !planExecuteUnlocked) || (askMode && !planExecuteUnlocked);
  if (blockWrites && PLAN_MODE_WRITE_TOOLS.has(name)) {
    return "deny";
  }

  if (writeLike) {
    const path = extractPath(input);
    // Patch bodies may omit path — still ask unless auto/session.
    if (path && pathMatchesDenylist(path, pathDenylist)) {
      return "ask"; // always confirm sensitive paths
    }
    if (autoRun || sessionAllow) return "allow";
    return "ask";
  }

  if (runLike) {
    const command = extractCommand(input);
    if (commandMatchesAllowlist(command, commandAllowlist)) return "allow";
    if (autoRun || sessionAllow) return "allow";
    return "ask";
  }

  if (autoRun || sessionAllow) return "allow";
  return "ask";
}
