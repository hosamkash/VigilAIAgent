/**
 * Focused nested ClineCore sessions for local parallel delegates.
 * No recursive delegate_tasks — workers stay leaf agents.
 */

import { buildToolPolicies, createApprovalGate } from "./approvals.mjs";

/**
 * @param {object} opts
 * @param {() => Promise<any>} opts.loadClineCore
 * @param {(cwd: string, emit: Function) => any[]} opts.buildWorkerTools
 * @param {string} opts.providerId
 * @param {string} opts.modelId
 * @param {string} opts.apiKey
 * @param {string} opts.cwd
 * @param {string} opts.prompt
 * @param {string} [opts.title]
 * @param {boolean} [opts.autoRun]
 * @param {(evt: object) => void} [opts.emit]
 */
export async function runFocusedSubagent(opts) {
  const {
    loadClineCore,
    buildWorkerTools,
    providerId,
    modelId,
    apiKey,
    cwd,
    prompt,
    title = "delegate",
    autoRun = true,
    emit = () => {},
  } = opts;

  if (!apiKey) {
    return { ok: false, text: "", error: "apiKey missing for subagent", title };
  }
  if (!String(prompt || "").trim()) {
    return { ok: false, text: "", error: "empty prompt", title };
  }

  const ClineCore = await loadClineCore();
  const toolPolicies = buildToolPolicies(true);
  // Subagents always auto-run tools; parent already approved the delegate.
  const approvalGate = createApprovalGate(() => {}, true, {
    commandAllowlist: [],
    pathDenylist: [],
  });

  const cline = await ClineCore.create({
    clientName: "vigil-subagent",
    backendMode: "local",
    capabilities: {
      requestToolApproval: (request) => approvalGate.request(request),
    },
    toolPolicies,
  });

  const workerEmit = (evt) => {
    emit({
      ...evt,
      delegate: title,
    });
  };

  const extraTools = buildWorkerTools(cwd, workerEmit);
  const systemPrompt =
    "You are a focused Vigil subagent. Complete ONLY the assigned task. " +
    "Stay inside the given cwd/workdir. Prefer search_codebase / find_definition / " +
    "find_references / read_file / apply_patch / run_commands. " +
    "Do not create pull requests or spawn further delegates. " +
    "When done, reply with a concise summary of changes and findings.";

  try {
    emit({
      type: "status",
      status: `delegate_start:${title}`,
    });
    const started = await cline.start({
      config: {
        providerId,
        modelId,
        apiKey,
        cwd,
        workspaceRoot: cwd,
        mode: "yolo",
        enableTools: true,
        enableSpawnAgent: false,
        enableAgentTeams: false,
        yolo: true,
        toolPolicies,
        systemPrompt,
        extraTools,
      },
      prompt: `Task: ${title}\n\n${prompt}`,
      interactive: false,
      localRuntime: { extraTools },
    });
    const text = String(started.result?.text || "").trim() || "(no summary)";
    emit({
      type: "status",
      status: `delegate_done:${title}`,
    });
    return { ok: true, text, title, sessionId: started.sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({
      type: "status",
      status: `delegate_failed:${title}`,
    });
    return { ok: false, text: "", error: message, title };
  } finally {
    try {
      approvalGate.cancelAll();
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
