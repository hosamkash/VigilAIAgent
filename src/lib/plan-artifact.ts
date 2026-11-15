/**
 * First-class Plan Mode artifact (draft → approve → execute).
 * Local persistence under `.vigil/plans/`; Firestore later (Cloud Bridge).
 */

export type PlanLifecycleStatus =
  | "draft"
  | "approved"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type PlanStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed"
  | "skipped";

export type PlanStepHints = {
  files?: string[];
  symbols?: string[];
  commands?: string[];
};

export type PlanStep = {
  id: string;
  content: string;
  status: PlanStepStatus;
  optional?: boolean;
  blockedByStepIds?: string[];
  hints?: PlanStepHints;
  acceptance?: string;
  parallelizable?: boolean;
};

export type PlanExecutionDrift = {
  detectedAt: number;
  message: string;
  extraStepContents: string[];
};

export type PlanExecution = {
  startedAt?: number;
  finishedAt?: number;
  pausedAt?: number;
  lastError?: string;
  failedStepId?: string;
  /** Set when manage_plan invents steps outside the approved plan. */
  drift?: PlanExecutionDrift;
};

export type PlanArtifact = {
  id: string;
  title: string;
  goal: string;
  status: PlanLifecycleStatus;
  createdAt: number;
  updatedAt: number;
  workspaceRoot?: string;
  chatTabId?: string;
  assumptions?: string[];
  risks?: string[];
  steps: PlanStep[];
  execution?: PlanExecution;
  /** Soft-archive; hidden from default history list. */
  archivedAt?: number;
  /** Lightweight revision log for draft edits (v1 → v2 …). */
  revisions?: PlanRevision[];
};

export type PlanRevision = {
  at: number;
  summary: string;
  stepSnapshot: string[];
};

const PLAN_STATUSES = new Set<PlanLifecycleStatus>([
  "draft",
  "approved",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

/** Plan is locked to approved steps (running or paused mid-flight). */
export function isPlanExecutionLocked(plan: PlanArtifact): boolean {
  return (
    plan.status === "running" ||
    plan.status === "paused" ||
    plan.status === "approved" ||
    plan.status === "failed"
  );
}

const STEP_STATUSES = new Set<PlanStepStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
  "skipped",
]);

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizePlanLifecycleStatus(
  value: unknown,
): PlanLifecycleStatus {
  const s = String(value || "draft").toLowerCase();
  if (PLAN_STATUSES.has(s as PlanLifecycleStatus)) {
    return s as PlanLifecycleStatus;
  }
  return "draft";
}

export function normalizePlanStepStatus(value: unknown): PlanStepStatus {
  const s = String(value || "pending").toLowerCase();
  if (s === "in-progress" || s === "doing") return "in_progress";
  if (s === "done" || s === "complete") return "completed";
  if (s === "canceled") return "cancelled";
  if (STEP_STATUSES.has(s as PlanStepStatus)) return s as PlanStepStatus;
  return "pending";
}

function normalizeHints(raw: unknown): PlanStepHints | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const files = Array.isArray(obj.files)
    ? obj.files.map(String).filter(Boolean)
    : undefined;
  const symbols = Array.isArray(obj.symbols)
    ? obj.symbols.map(String).filter(Boolean)
    : undefined;
  const commands = Array.isArray(obj.commands)
    ? obj.commands.map(String).filter(Boolean)
    : undefined;
  if (!files?.length && !symbols?.length && !commands?.length) return undefined;
  return { files, symbols, commands };
}

export function normalizePlanStep(raw: unknown): PlanStep | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const content = String(row.content || row.title || row.text || "").trim();
  if (!content) return null;
  const blocked = Array.isArray(row.blockedByStepIds)
    ? row.blockedByStepIds.map(String).filter(Boolean)
    : undefined;
  return {
    id: String(row.id || newId()),
    content,
    status: normalizePlanStepStatus(row.status),
    optional: row.optional === true ? true : undefined,
    blockedByStepIds: blocked?.length ? blocked : undefined,
    hints: normalizeHints(row.hints),
    acceptance:
      typeof row.acceptance === "string" && row.acceptance.trim()
        ? row.acceptance.trim()
        : undefined,
    parallelizable: row.parallelizable === true ? true : undefined,
  };
}

export function createPlanArtifact(input: {
  title?: string;
  goal: string;
  steps?: unknown[];
  workspaceRoot?: string;
  chatTabId?: string;
  assumptions?: string[];
  risks?: string[];
}): PlanArtifact {
  const now = Date.now();
  const steps = (input.steps ?? [])
    .map(normalizePlanStep)
    .filter((s): s is PlanStep => !!s);
  const goal = String(input.goal || "").trim() || "Untitled goal";
  const title =
    String(input.title || "").trim() ||
    (goal.length > 60 ? `${goal.slice(0, 57)}…` : goal);
  return {
    id: newId(),
    title,
    goal,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    workspaceRoot: input.workspaceRoot,
    chatTabId: input.chatTabId,
    assumptions: input.assumptions?.map(String).filter(Boolean),
    risks: input.risks?.map(String).filter(Boolean),
    steps,
  };
}

export function normalizePlanArtifact(raw: unknown): PlanArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const goal = String(obj.goal || "").trim();
  const title = String(obj.title || "").trim();
  if (!goal && !title && !Array.isArray(obj.steps)) return null;
  const steps = (Array.isArray(obj.steps) ? obj.steps : [])
    .map(normalizePlanStep)
    .filter((s): s is PlanStep => !!s);
  const now = Date.now();
  const execution =
    obj.execution && typeof obj.execution === "object"
      ? (obj.execution as PlanExecution)
      : undefined;
  return {
    id: String(obj.id || newId()),
    title: title || goal || "Untitled plan",
    goal: goal || title || "Untitled goal",
    status: normalizePlanLifecycleStatus(obj.status),
    createdAt: Number(obj.createdAt) || now,
    updatedAt: Number(obj.updatedAt) || now,
    workspaceRoot:
      typeof obj.workspaceRoot === "string" ? obj.workspaceRoot : undefined,
    chatTabId: typeof obj.chatTabId === "string" ? obj.chatTabId : undefined,
    assumptions: Array.isArray(obj.assumptions)
      ? obj.assumptions.map(String).filter(Boolean)
      : undefined,
    risks: Array.isArray(obj.risks)
      ? obj.risks.map(String).filter(Boolean)
      : undefined,
    steps,
    execution,
    archivedAt:
      typeof obj.archivedAt === "number" && obj.archivedAt > 0
        ? obj.archivedAt
        : undefined,
    revisions: Array.isArray(obj.revisions)
      ? obj.revisions
          .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
          .map((r) => ({
            at: Number(r.at) || Date.now(),
            summary: String(r.summary || "edit"),
            stepSnapshot: Array.isArray(r.stepSnapshot)
              ? r.stepSnapshot.map(String)
              : [],
          }))
      : undefined,
  };
}

const MAX_REVISIONS = 8;

/** Snapshot step contents when the user edits a draft (for simple v1→v2 diff). */
export function recordPlanRevision(
  plan: PlanArtifact,
  summary = "edit",
): PlanArtifact {
  const stepSnapshot = plan.steps.map((s) => s.content);
  const prev = plan.revisions?.[plan.revisions.length - 1];
  if (
    prev &&
    prev.stepSnapshot.length === stepSnapshot.length &&
    prev.stepSnapshot.every((c, i) => c === stepSnapshot[i])
  ) {
    return plan;
  }
  const entry: PlanRevision = {
    at: Date.now(),
    summary,
    stepSnapshot,
  };
  const revisions = [...(plan.revisions || []), entry].slice(-MAX_REVISIONS);
  return { ...plan, revisions, updatedAt: Date.now() };
}

/** Human-readable diff between the last two revisions (or empty). */
export function formatLastPlanRevisionDiff(plan: PlanArtifact): string | null {
  const revs = plan.revisions || [];
  if (revs.length < 2) return null;
  const a = revs[revs.length - 2].stepSnapshot;
  const b = revs[revs.length - 1].stepSnapshot;
  const added = b.filter((c) => !a.includes(c));
  const removed = a.filter((c) => !b.includes(c));
  if (added.length === 0 && removed.length === 0) {
    return "Steps reordered or wording tweaked.";
  }
  const lines: string[] = [];
  for (const c of added) lines.push(`+ ${c}`);
  for (const c of removed) lines.push(`− ${c}`);
  return lines.join("\n");
}

/** Heuristic: push/delete/migrate-style steps need a visual warning. */
export function isDangerousStepContent(content: string): boolean {
  return /\b(push|force[_ -]?push|delete|unlink|rm\b|drop\b|truncate|migrate|destroy|wipe)\b/i.test(
    content,
  );
}

export function hintsToEditableText(hints?: PlanStepHints): string {
  if (!hints) return "";
  const parts = [
    ...(hints.files || []),
    ...(hints.symbols || []).map((s) => `@${s}`),
    ...(hints.commands || []).map((c) => `!${c}`),
  ];
  return parts.join(", ");
}

/** Parse "path/a.ts, @Symbol, !npm test" into hints. */
export function parseHintsEditableText(text: string): PlanStepHints | undefined {
  const raw = text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (raw.length === 0) return undefined;
  const files: string[] = [];
  const symbols: string[] = [];
  const commands: string[] = [];
  for (const part of raw) {
    if (part.startsWith("@")) symbols.push(part.slice(1).trim());
    else if (part.startsWith("!")) commands.push(part.slice(1).trim());
    else files.push(part);
  }
  return normalizeHints({ files, symbols, commands });
}

/** Clone a plan as a fresh draft (new id; steps reset to pending). */
export function clonePlanArtifact(plan: PlanArtifact): PlanArtifact {
  const now = Date.now();
  return {
    id: newId(),
    title: plan.title.startsWith("Copy of ")
      ? plan.title
      : `Copy of ${plan.title}`,
    goal: plan.goal,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    workspaceRoot: plan.workspaceRoot,
    chatTabId: undefined,
    assumptions: plan.assumptions ? [...plan.assumptions] : undefined,
    risks: plan.risks ? [...plan.risks] : undefined,
    steps: plan.steps.map((s) => ({
      ...s,
      id: newId(),
      status: "pending" as const,
      hints: s.hints ? { ...s.hints } : undefined,
      blockedByStepIds: s.blockedByStepIds
        ? [...s.blockedByStepIds]
        : undefined,
    })),
    archivedAt: undefined,
  };
}

export function archivePlanArtifact(plan: PlanArtifact): PlanArtifact {
  return {
    ...plan,
    archivedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function unarchivePlanArtifact(plan: PlanArtifact): PlanArtifact {
  return {
    ...plan,
    archivedAt: undefined,
    updatedAt: Date.now(),
  };
}

export function isPlanArchived(plan: PlanArtifact): boolean {
  return typeof plan.archivedAt === "number" && plan.archivedAt > 0;
}

export function serializePlanArtifact(plan: PlanArtifact): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function parsePlanArtifactJson(text: string): PlanArtifact | null {
  try {
    return normalizePlanArtifact(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** Exactly one in_progress when running. */
export function countInProgressSteps(plan: PlanArtifact): number {
  return plan.steps.filter((s) => s.status === "in_progress").length;
}

const TERMINAL_STEP = new Set<PlanStepStatus>([
  "completed",
  "cancelled",
  "failed",
  "skipped",
]);

export function isStepTerminal(status: PlanStepStatus): boolean {
  return TERMINAL_STEP.has(status);
}

/** Keep at most one in_progress (prefer the last one set). Demote extras to pending. */
export function enforceSingleInProgress(plan: PlanArtifact): PlanArtifact {
  let seen = false;
  const steps = [...plan.steps].reverse().map((step) => {
    if (step.status !== "in_progress") return step;
    if (!seen) {
      seen = true;
      return step;
    }
    return { ...step, status: "pending" as const };
  });
  steps.reverse();
  return { ...plan, steps, updatedAt: Date.now() };
}

/** Mark the first incomplete non-optional (or any incomplete) step as in_progress. */
export function seedFirstInProgress(plan: PlanArtifact): PlanArtifact {
  if (countInProgressSteps(plan) > 0) {
    return enforceSingleInProgress(plan);
  }
  const steps = plan.steps.map((s) => ({ ...s }));
  const idx = steps.findIndex(
    (s) => !isStepTerminal(s.status) && !s.optional,
  );
  const fallback = steps.findIndex((s) => !isStepTerminal(s.status));
  const pick = idx >= 0 ? idx : fallback;
  if (pick >= 0) steps[pick] = { ...steps[pick], status: "in_progress" };
  return { ...plan, steps, updatedAt: Date.now() };
}

export function countCompletedSteps(plan: PlanArtifact): number {
  return plan.steps.filter((s) => s.status === "completed").length;
}

export function isPlanExecutionSettled(plan: PlanArtifact): boolean {
  if (plan.steps.length === 0) return false;
  return plan.steps.every(
    (s) =>
      isStepTerminal(s.status) || (s.optional === true && s.status === "pending"),
  );
}

export function deriveExecutionOutcome(
  plan: PlanArtifact,
): "completed" | "failed" | "running" {
  if (plan.steps.some((s) => s.status === "failed")) return "failed";
  if (isPlanExecutionSettled(plan)) return "completed";
  return "running";
}

function normalizeContentKey(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

export type ManagePlanMergeResult = {
  plan: PlanArtifact;
  drift: PlanExecutionDrift | null;
};

/**
 * Merge manage_plan items into an approved/running plan by id (then content).
 * While running, brand-new steps are treated as drift — not silently appended.
 */
export function mergeManagePlanIntoExecution(
  plan: PlanArtifact,
  items: Array<{ id?: string; content: string; status?: string }>,
): ManagePlanMergeResult {
  const incoming = items
    .map((item) =>
      normalizePlanStep({
        id: item.id,
        content: item.content,
        status: item.status,
      }),
    )
    .filter((s): s is PlanStep => !!s);

  if (incoming.length === 0) {
    return { plan, drift: null };
  }

  const locked = isPlanExecutionLocked(plan);
  const byId = new Map(plan.steps.map((s) => [s.id, { ...s }]));
  const contentIndex = new Map<string, string>();
  for (const s of plan.steps) {
    contentIndex.set(normalizeContentKey(s.content), s.id);
  }

  const unmatched: PlanStep[] = [];
  for (const item of incoming) {
    let targetId = byId.has(item.id) ? item.id : undefined;
    if (!targetId) {
      targetId = contentIndex.get(normalizeContentKey(item.content));
    }
    if (targetId && byId.has(targetId)) {
      const prev = byId.get(targetId)!;
      byId.set(targetId, {
        ...prev,
        content: item.content || prev.content,
        status: item.status,
      });
    } else if (locked) {
      unmatched.push(item);
    } else {
      byId.set(item.id, item);
      contentIndex.set(normalizeContentKey(item.content), item.id);
    }
  }

  // Preserve approved order; append only when not in a locked execution.
  const steps: PlanStep[] = [];
  const used = new Set<string>();
  for (const s of plan.steps) {
    const next = byId.get(s.id);
    if (next) {
      steps.push(next);
      used.add(s.id);
    }
  }
  if (!locked) {
    for (const [id, s] of byId) {
      if (!used.has(id)) steps.push(s);
    }
  }

  let nextPlan: PlanArtifact = {
    ...plan,
    steps,
    updatedAt: Date.now(),
  };
  nextPlan = enforceSingleInProgress(nextPlan);

  let drift: PlanExecutionDrift | null = null;
  if (unmatched.length > 0) {
    drift = {
      detectedAt: Date.now(),
      message:
        "Agent proposed steps outside the approved plan. Amend the plan before adding them.",
      extraStepContents: unmatched.map((s) => s.content),
    };
    nextPlan = {
      ...nextPlan,
      execution: {
        ...(nextPlan.execution || {}),
        drift,
      },
    };
  } else if (nextPlan.execution?.drift) {
    // Clear prior drift once sync stays on-plan.
    const { drift: _cleared, ...rest } = nextPlan.execution;
    nextPlan = { ...nextPlan, execution: rest };
  }

  return { plan: nextPlan, drift };
}

export function withUpdatedStep(
  plan: PlanArtifact,
  stepId: string,
  patch: Partial<PlanStep>,
): PlanArtifact {
  const steps = plan.steps.map((step) =>
    step.id === stepId ? { ...step, ...patch, id: step.id } : step,
  );
  return { ...plan, steps, updatedAt: Date.now() };
}

export function withReorderedSteps(
  plan: PlanArtifact,
  orderedIds: string[],
): PlanArtifact {
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const steps: PlanStep[] = [];
  for (const id of orderedIds) {
    const step = byId.get(id);
    if (step) {
      steps.push(step);
      byId.delete(id);
    }
  }
  for (const step of byId.values()) steps.push(step);
  return { ...plan, steps, updatedAt: Date.now() };
}

export function approvePlan(plan: PlanArtifact): PlanArtifact {
  if (plan.status !== "draft" && plan.status !== "approved") {
    return plan;
  }
  return {
    ...plan,
    status: "approved",
    updatedAt: Date.now(),
  };
}

export function startExecutingPlan(plan: PlanArtifact): PlanArtifact {
  const base =
    plan.status === "draft" ? approvePlan(plan) : { ...plan, updatedAt: Date.now() };
  const seeded = seedFirstInProgress({
    ...base,
    status: "running",
    updatedAt: Date.now(),
    execution: {
      ...(base.execution || {}),
      startedAt: base.execution?.startedAt || Date.now(),
      finishedAt: undefined,
      pausedAt: undefined,
      lastError: undefined,
      failedStepId: undefined,
      drift: undefined,
    },
  });
  return seeded;
}

export function pauseExecutingPlan(plan: PlanArtifact): PlanArtifact {
  if (plan.status !== "running") return plan;
  return {
    ...plan,
    status: "paused",
    updatedAt: Date.now(),
    execution: {
      ...(plan.execution || {}),
      pausedAt: Date.now(),
      finishedAt: undefined,
    },
  };
}

export function resumeExecutingPlan(plan: PlanArtifact): PlanArtifact {
  if (
    plan.status !== "paused" &&
    plan.status !== "failed" &&
    plan.status !== "running"
  ) {
    return startExecutingPlan(plan);
  }
  const cleared = {
    ...plan,
    status: "running" as const,
    updatedAt: Date.now(),
    execution: {
      ...(plan.execution || {}),
      startedAt: plan.execution?.startedAt || Date.now(),
      pausedAt: undefined,
      finishedAt: undefined,
      lastError: undefined,
    },
  };
  return seedFirstInProgress(cleared);
}

export function findFailedStepId(plan: PlanArtifact): string | undefined {
  return (
    plan.execution?.failedStepId ||
    plan.steps.find((s) => s.status === "failed")?.id
  );
}

/** Flip plan to failed when a step failed; keep step statuses. */
export function markPlanFailedFromSteps(
  plan: PlanArtifact,
  lastError?: string,
): PlanArtifact {
  const failedStepId = findFailedStepId(plan);
  return {
    ...plan,
    status: "failed",
    updatedAt: Date.now(),
    execution: {
      ...(plan.execution || {}),
      failedStepId,
      lastError:
        lastError ||
        (failedStepId
          ? `Step failed: ${plan.steps.find((s) => s.id === failedStepId)?.content || failedStepId}`
          : "A step failed"),
      finishedAt: undefined,
      pausedAt: Date.now(),
    },
  };
}

/** Retry the failed step (or a specific step id). */
export function retryFailedStep(
  plan: PlanArtifact,
  stepId?: string,
): PlanArtifact {
  const id = stepId || findFailedStepId(plan);
  if (!id) return resumeExecutingPlan(plan);
  const steps = plan.steps.map((s) => {
    if (s.id === id) return { ...s, status: "in_progress" as const };
    if (s.status === "in_progress") return { ...s, status: "pending" as const };
    return s;
  });
  return {
    ...plan,
    status: "running",
    steps,
    updatedAt: Date.now(),
    execution: {
      ...(plan.execution || {}),
      failedStepId: undefined,
      lastError: undefined,
      pausedAt: undefined,
      finishedAt: undefined,
      startedAt: plan.execution?.startedAt || Date.now(),
    },
  };
}

/** Skip failed step(s) and continue with remaining work. */
export function skipFailedAndContinue(plan: PlanArtifact): PlanArtifact {
  const steps = plan.steps.map((s) =>
    s.status === "failed" ? { ...s, status: "skipped" as const } : s,
  );
  return seedFirstInProgress({
    ...plan,
    status: "running",
    steps,
    updatedAt: Date.now(),
    execution: {
      ...(plan.execution || {}),
      failedStepId: undefined,
      lastError: undefined,
      pausedAt: undefined,
      finishedAt: undefined,
      startedAt: plan.execution?.startedAt || Date.now(),
    },
  });
}

/** Return to draft so the user can revise steps before executing again. */
export function revisePlanForEdit(plan: PlanArtifact): PlanArtifact {
  return {
    ...plan,
    status: "draft",
    updatedAt: Date.now(),
    execution: {
      ...(plan.execution || {}),
      pausedAt: undefined,
      finishedAt: undefined,
      // keep lastError for context while revising
    },
  };
}

export function finishPlan(
  plan: PlanArtifact,
  status: "completed" | "failed" | "cancelled",
  lastError?: string,
): PlanArtifact {
  return {
    ...plan,
    status,
    updatedAt: Date.now(),
    execution: {
      ...(plan.execution || {}),
      finishedAt: Date.now(),
      pausedAt: undefined,
      lastError,
      failedStepId:
        status === "failed" ? findFailedStepId(plan) : plan.execution?.failedStepId,
    },
  };
}

function formatPlanStepsBlock(plan: PlanArtifact): string {
  return plan.steps
    .map((s, i) => {
      const hintText = hintsToEditableText(s.hints);
      const flags = [
        `id=${s.id}`,
        s.optional ? "optional" : null,
        s.parallelizable ? "parallelizable" : null,
        isDangerousStepContent(s.content) ? "dangerous" : null,
        s.acceptance ? `acceptance: ${s.acceptance}` : null,
        hintText ? `hints: ${hintText}` : null,
      ].filter(Boolean);
      const suffix = flags.length ? ` (${flags.join("; ")})` : "";
      return `${i + 1}. [${s.status}] ${s.content}${suffix}`;
    })
    .join("\n");
}

/** Merge mid-turn manage_plan items into a first-class Plan artifact. */
export function mergeManagePlanItems(
  plan: PlanArtifact | null,
  items: Array<{ id?: string; content: string; status?: string }>,
  meta?: { goal?: string; chatTabId?: string; workspaceRoot?: string },
): PlanArtifact {
  if (!plan) {
    const steps = items
      .map((item) =>
        normalizePlanStep({
          id: item.id,
          content: item.content,
          status: item.status,
        }),
      )
      .filter((s): s is PlanStep => !!s);
    return createPlanArtifact({
      goal: meta?.goal || steps[0]?.content || "Plan",
      steps,
      chatTabId: meta?.chatTabId,
      workspaceRoot: meta?.workspaceRoot,
    });
  }

  const { plan: merged } = mergeManagePlanIntoExecution(plan, items);
  return {
    ...merged,
    chatTabId: meta?.chatTabId || merged.chatTabId,
    workspaceRoot: meta?.workspaceRoot || merged.workspaceRoot,
  };
}

export function withRemovedStep(plan: PlanArtifact, stepId: string): PlanArtifact {
  return {
    ...plan,
    steps: plan.steps.filter((s) => s.id !== stepId),
    updatedAt: Date.now(),
  };
}

export function withAddedStep(
  plan: PlanArtifact,
  content: string,
  afterId?: string,
): PlanArtifact {
  const step: PlanStep = {
    id: newId(),
    content: content.trim() || "New step",
    status: "pending",
  };
  if (!afterId) {
    return { ...plan, steps: [...plan.steps, step], updatedAt: Date.now() };
  }
  const steps: PlanStep[] = [];
  for (const s of plan.steps) {
    steps.push(s);
    if (s.id === afterId) steps.push(step);
  }
  if (!steps.some((s) => s.id === step.id)) steps.push(step);
  return { ...plan, steps, updatedAt: Date.now() };
}

/** Prompt sent when user clicks Execute. */
export function formatPlanExecutePrompt(plan: PlanArtifact): string {
  return (
    `Execute the approved Vigil plan (plan id: ${plan.id}).\n\n` +
    `Title: ${plan.title}\n` +
    `Goal: ${plan.goal}\n\n` +
    `Steps (source of truth — use these ids in manage_plan; keep exactly one in_progress):\n` +
    `${formatPlanStepsBlock(plan)}\n\n` +
    `Rules:\n` +
    `- Follow steps in order; do not invent a parallel conflicting checklist.\n` +
    `- Update statuses only via manage_plan using the given step ids.\n` +
    `- Honor acceptance checks before marking a step completed.\n` +
    `- Optional steps may be skipped; mark them skipped if intentionally omitted.\n` +
    `- Steps marked parallelizable may use delegate_tasks / worktrees when safe.\n` +
    `- Use hints (files/symbols/commands) to ground edits; prefer those paths first.\n` +
    `- Extra caution on steps flagged dangerous (push/delete/migrate).\n` +
    `- Mark a step completed only with evidence (file change, test result, or explicit N/A).\n` +
    `- If a step cannot be completed, mark it failed via manage_plan and stop.\n` +
    `- If you need a new step, say so in chat and wait — do not silently add steps.`
  );
}

/** Prompt when resuming a paused / recovered plan. */
export function formatPlanResumePrompt(
  plan: PlanArtifact,
  reason: "resume" | "retry" | "continue" = "resume",
): string {
  const focus =
    plan.steps.find((s) => s.status === "in_progress") ||
    plan.steps.find((s) => !isStepTerminal(s.status));
  const header =
    reason === "retry"
      ? "Retry the failed step and continue the Vigil plan"
      : reason === "continue"
        ? "Continue the Vigil plan after skipping failed step(s)"
        : "Resume the paused Vigil plan";
  return (
    `${header} (plan id: ${plan.id}).\n\n` +
    `Title: ${plan.title}\n` +
    `Goal: ${plan.goal}\n` +
    (focus ? `Focus next: [${focus.id}] ${focus.content}\n` : "") +
    `\nSteps (source of truth — preserve completed/skipped; keep exactly one in_progress):\n` +
    `${formatPlanStepsBlock(plan)}\n\n` +
    `Continue from the in_progress step. Do not redo completed steps. ` +
    `Use manage_plan with the given ids.`
  );
}

/** Relative dir under workspace for plan JSON files. */
export function plansRelativeDir(): string {
  return ".vigil/plans";
}

export function planRelativePath(planId: string): string {
  const safe = String(planId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${plansRelativeDir()}/${safe}.json`;
}

export function joinWorkspacePath(
  workspaceRoot: string,
  relative: string,
): string {
  const root = workspaceRoot.replace(/[/\\]+$/, "");
  const rel = relative.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${sep}${rel.split("/").join(sep)}`;
}
