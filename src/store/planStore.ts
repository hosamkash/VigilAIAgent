import { create } from "zustand";
import {
  type PlanArtifact,
  type PlanExecutionDrift,
  type PlanStep,
  approvePlan,
  archivePlanArtifact,
  clonePlanArtifact,
  createPlanArtifact,
  finishPlan,
  formatPlanExecutePrompt,
  formatPlanResumePrompt,
  markPlanFailedFromSteps,
  mergeManagePlanIntoExecution,
  mergeManagePlanItems,
  pauseExecutingPlan,
  recordPlanRevision,
  resumeExecutingPlan,
  retryFailedStep,
  revisePlanForEdit,
  skipFailedAndContinue,
  startExecutingPlan,
  unarchivePlanArtifact,
  withAddedStep,
  withRemovedStep,
  withReorderedSteps,
  withUpdatedStep,
} from "../lib/plan-artifact";
import {
  deletePlanArtifact,
  listPlanArtifacts,
  loadPlanArtifact,
  savePlanArtifact,
} from "../lib/plan-artifact-fs";
import { postPlanExecutionStatus } from "../lib/cloud/post-execution-status";
import { getWorkspaceCwd } from "../lib/secure-storage";

function notifyCloudExecution(plan: PlanArtifact | null): void {
  if (!plan?.id) return;
  try {
    postPlanExecutionStatus(plan.id, plan.status);
  } catch {
    /* ignore */
  }
  void import("../lib/cloud/post-execution-status")
    .then(({ mirrorExecutionStatusToCloud }) =>
      mirrorExecutionStatusToCloud(plan.id, plan.status),
    )
    .catch(() => {
      /* offline */
    });
}

type PlanStoreState = {
  activePlan: PlanArtifact | null;
  recentPlans: PlanArtifact[];
  /** When true, sidecar allows write tools even if chatMode is still plan. */
  planExecuteUnlocked: boolean;
  /** Latest anti-drift warning while executing (also on plan.execution.drift). */
  executionDrift: PlanExecutionDrift | null;
  loading: boolean;
  error: string | null;
  setActivePlan: (plan: PlanArtifact | null) => void;
  createDraft: (
    goal: string,
    steps?: unknown[],
    meta?: { chatTabId?: string },
  ) => Promise<PlanArtifact | null>;
  persistActive: (opts?: { recordRevision?: boolean }) => Promise<void>;
  approveActive: () => Promise<void>;
  /** Approve (if needed) + mark running + unlock writes. Returns execute prompt. */
  beginExecute: () => Promise<string | null>;
  /** Pause mid-run; keeps step statuses. */
  pauseExecute: () => Promise<void>;
  /** Resume from paused (or re-enter running). Returns resume prompt. */
  resumeExecute: () => Promise<string | null>;
  cancelExecute: () => Promise<void>;
  completeExecute: (ok: boolean, error?: string) => Promise<void>;
  /** Recovery: retry failed step → running + prompt. */
  retryFailed: () => Promise<string | null>;
  /** Recovery: skip failed → continue remaining + prompt. */
  continueAfterFailure: () => Promise<string | null>;
  /** Recovery: back to draft for editing. */
  reviseAfterFailure: () => Promise<void>;
  syncFromManagePlan: (
    items: Array<{ id?: string; content: string; status?: string }>,
    meta?: { goal?: string; chatTabId?: string },
  ) => Promise<void>;
  updateStep: (stepId: string, patch: Partial<PlanStep>) => void;
  moveStep: (stepId: string, direction: -1 | 1) => void;
  removeStep: (stepId: string) => void;
  addStep: (content?: string) => void;
  refreshList: (opts?: { includeArchived?: boolean }) => Promise<void>;
  openPlan: (planId: string) => Promise<void>;
  clonePlan: (planId?: string) => Promise<PlanArtifact | null>;
  archivePlan: (planId?: string) => Promise<void>;
  unarchivePlan: (planId: string) => Promise<void>;
  deletePlan: (planId: string) => Promise<void>;
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;
};

async function workspaceRootOf(plan: PlanArtifact | null): Promise<string> {
  return (
    plan?.workspaceRoot ||
    (await getWorkspaceCwd().catch(() => "")) ||
    ""
  );
}

function unlockedFor(plan: PlanArtifact | null): boolean {
  return plan?.status === "running";
}

export const usePlanStore = create<PlanStoreState>((set, get) => ({
  activePlan: null,
  recentPlans: [],
  planExecuteUnlocked: false,
  executionDrift: null,
  loading: false,
  error: null,
  showArchived: false,
  setShowArchived: (showArchived) => set({ showArchived }),

  setActivePlan: (activePlan) =>
    set({
      activePlan,
      error: null,
      planExecuteUnlocked: unlockedFor(activePlan),
      executionDrift: activePlan?.execution?.drift || null,
    }),

  createDraft: async (goal, steps, meta) => {
    try {
      const workspaceRoot = await getWorkspaceCwd().catch(() => "");
      const plan = createPlanArtifact({
        goal,
        steps,
        workspaceRoot: workspaceRoot || undefined,
        chatTabId: meta?.chatTabId,
      });
      if (workspaceRoot) {
        await savePlanArtifact(workspaceRoot, plan);
      }
      set({
        activePlan: plan,
        planExecuteUnlocked: false,
        executionDrift: null,
        error: null,
      });
      await get().refreshList();
      return plan;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create plan",
      });
      return null;
    }
  },

  persistActive: async (opts) => {
    let plan = get().activePlan;
    if (!plan) return;
    if (
      opts?.recordRevision !== false &&
      (plan.status === "draft" || plan.status === "approved")
    ) {
      plan = recordPlanRevision(plan, "edit");
    }
    const workspaceRoot = await workspaceRootOf(plan);
    if (!workspaceRoot) {
      set({ error: "No workspace open to save plan" });
      return;
    }
    const saved = { ...plan, workspaceRoot, updatedAt: Date.now() };
    await savePlanArtifact(workspaceRoot, saved);
    set({ activePlan: saved, error: null });
    await get().refreshList();
    // Best-effort cloud mirror when signed in (Cloud Bridge).
    try {
      const { useCloudAuthStore } = await import("./cloudAuthStore");
      const { pushPlanToCloud } = await import("../lib/cloud/plans-sync");
      const uid = useCloudAuthStore.getState().user?.uid;
      if (uid) await pushPlanToCloud(saved, uid);
    } catch {
      /* offline / not configured — local save already succeeded */
    }
  },

  approveActive: async () => {
    const plan = get().activePlan;
    if (!plan) return;
    const next = approvePlan(plan);
    set({ activePlan: next });
    await get().persistActive();
  },

  beginExecute: async () => {
    const plan = get().activePlan;
    if (!plan || plan.steps.length === 0) return null;
    if (plan.status === "paused") {
      return get().resumeExecute();
    }
    const next = startExecutingPlan(plan);
    set({
      activePlan: next,
      planExecuteUnlocked: true,
      executionDrift: null,
      error: null,
    });
    await get().persistActive();
    notifyCloudExecution(next);
    return formatPlanExecutePrompt(next);
  },

  pauseExecute: async () => {
    const plan = get().activePlan;
    if (!plan || plan.status !== "running") return;
    const next = pauseExecutingPlan(plan);
    set({
      activePlan: next,
      planExecuteUnlocked: false,
      error: null,
    });
    await get().persistActive();
    notifyCloudExecution(next);
  },

  resumeExecute: async () => {
    const plan = get().activePlan;
    if (!plan || plan.steps.length === 0) return null;
    const next = resumeExecutingPlan(plan);
    set({
      activePlan: next,
      planExecuteUnlocked: true,
      executionDrift: null,
      error: null,
    });
    await get().persistActive();
    notifyCloudExecution(next);
    return formatPlanResumePrompt(next, "resume");
  },

  cancelExecute: async () => {
    const plan = get().activePlan;
    if (!plan) {
      set({ planExecuteUnlocked: false, executionDrift: null });
      return;
    }
    const next = finishPlan(plan, "cancelled");
    set({
      activePlan: next,
      planExecuteUnlocked: false,
      executionDrift: null,
    });
    await get().persistActive();
    notifyCloudExecution(next);
  },

  completeExecute: async (ok, error) => {
    const plan = get().activePlan;
    if (!plan) {
      set({ planExecuteUnlocked: false, executionDrift: null });
      return;
    }
    if (!ok) {
      const next = markPlanFailedFromSteps(plan, error);
      set({
        activePlan: next,
        planExecuteUnlocked: false,
        executionDrift: null,
      });
      await get().persistActive();
      notifyCloudExecution(next);
      return;
    }
    const next = finishPlan(plan, "completed", error);
    set({
      activePlan: next,
      planExecuteUnlocked: false,
      executionDrift: null,
    });
    await get().persistActive();
    notifyCloudExecution(next);
  },

  retryFailed: async () => {
    const plan = get().activePlan;
    if (!plan) return null;
    const next = retryFailedStep(plan);
    set({
      activePlan: next,
      planExecuteUnlocked: true,
      executionDrift: null,
      error: null,
    });
    await get().persistActive();
    return formatPlanResumePrompt(next, "retry");
  },

  continueAfterFailure: async () => {
    const plan = get().activePlan;
    if (!plan) return null;
    const next = skipFailedAndContinue(plan);
    set({
      activePlan: next,
      planExecuteUnlocked: true,
      executionDrift: null,
      error: null,
    });
    await get().persistActive();
    return formatPlanResumePrompt(next, "continue");
  },

  reviseAfterFailure: async () => {
    const plan = get().activePlan;
    if (!plan) return;
    const next = revisePlanForEdit(plan);
    set({
      activePlan: next,
      planExecuteUnlocked: false,
      executionDrift: null,
      error: null,
    });
    await get().persistActive();
  },

  syncFromManagePlan: async (items, meta) => {
    const current = get().activePlan;
    const workspaceRoot =
      (await getWorkspaceCwd().catch(() => "")) || undefined;

    if (
      current &&
      (current.status === "running" ||
        current.status === "paused" ||
        current.status === "approved" ||
        current.status === "failed")
    ) {
      const { plan: merged, drift } = mergeManagePlanIntoExecution(
        current,
        items,
      );
      let plan: PlanArtifact = {
        ...merged,
        status: current.status,
        chatTabId: meta?.chatTabId || merged.chatTabId,
        workspaceRoot: workspaceRoot || merged.workspaceRoot,
      };
      // Mid-run failure → surface recovery UI (keep statuses).
      if (
        current.status === "running" &&
        plan.steps.some((s) => s.status === "failed")
      ) {
        plan = markPlanFailedFromSteps(plan);
      }
      set({
        activePlan: plan,
        planExecuteUnlocked: unlockedFor(plan),
        executionDrift: drift,
        error: null,
      });
      if (workspaceRoot) {
        try {
          await savePlanArtifact(workspaceRoot, {
            ...plan,
            workspaceRoot,
          });
        } catch {
          /* ignore persist race */
        }
      }
      return;
    }

    const merged = mergeManagePlanItems(current, items, {
      goal: meta?.goal,
      chatTabId: meta?.chatTabId,
      workspaceRoot,
    });
    set({
      activePlan: merged,
      executionDrift: merged.execution?.drift || null,
      error: null,
    });
    if (workspaceRoot) {
      try {
        await savePlanArtifact(workspaceRoot, {
          ...merged,
          workspaceRoot,
        });
      } catch {
        /* ignore persist race */
      }
    }
  },

  updateStep: (stepId, patch) => {
    const plan = get().activePlan;
    if (!plan) return;
    set({ activePlan: withUpdatedStep(plan, stepId, patch) });
  },

  moveStep: (stepId, direction) => {
    const plan = get().activePlan;
    if (!plan) return;
    const ids = plan.steps.map((s) => s.id);
    const index = ids.indexOf(stepId);
    if (index < 0) return;
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    const ordered = [...ids];
    const [removed] = ordered.splice(index, 1);
    ordered.splice(next, 0, removed);
    set({ activePlan: withReorderedSteps(plan, ordered) });
  },

  removeStep: (stepId) => {
    const plan = get().activePlan;
    if (!plan) return;
    set({ activePlan: withRemovedStep(plan, stepId) });
  },

  addStep: (content) => {
    const plan = get().activePlan;
    if (!plan) return;
    set({ activePlan: withAddedStep(plan, content || "New step") });
  },

  refreshList: async (opts) => {
    set({ loading: true });
    try {
      const workspaceRoot = await getWorkspaceCwd().catch(() => "");
      if (!workspaceRoot) {
        set({ recentPlans: [], loading: false });
        return;
      }
      const includeArchived =
        opts?.includeArchived ?? get().showArchived;
      const recentPlans = await listPlanArtifacts(workspaceRoot, {
        includeArchived,
      });
      set({ recentPlans, loading: false, error: null });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to list plans",
      });
    }
  },

  openPlan: async (planId) => {
    const workspaceRoot = await getWorkspaceCwd().catch(() => "");
    if (!workspaceRoot) {
      set({ error: "No workspace open to load plan" });
      return;
    }
    let plan = await loadPlanArtifact(workspaceRoot, planId);

    // Cloud Bridge: if missing (or stale) locally, pull from Firestore.
    try {
      const { useCloudAuthStore } = await import("./cloudAuthStore");
      const uid = useCloudAuthStore.getState().user?.uid;
      if (uid) {
        const { ensureLocalPlanFromCloud } = await import(
          "../lib/cloud/plans-sync"
        );
        const fromCloud = await ensureLocalPlanFromCloud({
          planId,
          userId: uid,
          workspaceRoot,
        });
        if (fromCloud) plan = fromCloud;
      }
    } catch (err) {
      if (!plan) {
        set({
          error:
            err instanceof Error
              ? err.message
              : "Failed to pull plan from cloud",
        });
        return;
      }
    }

    if (plan) {
      set({
        activePlan: plan,
        error: null,
        planExecuteUnlocked: unlockedFor(plan),
        executionDrift: plan.execution?.drift || null,
      });
      await get().refreshList();
    } else {
      set({
        error: `Plan ${planId} not found locally or in cloud`,
      });
    }
  },

  clonePlan: async (planId) => {
    try {
      const workspaceRoot = await getWorkspaceCwd().catch(() => "");
      const id = planId || get().activePlan?.id;
      if (!id || !workspaceRoot) return null;
      const source =
        get().activePlan?.id === id
          ? get().activePlan
          : await loadPlanArtifact(workspaceRoot, id);
      if (!source) return null;
      const plan = {
        ...clonePlanArtifact(source),
        workspaceRoot,
      };
      await savePlanArtifact(workspaceRoot, plan);
      set({
        activePlan: plan,
        planExecuteUnlocked: false,
        executionDrift: null,
        error: null,
      });
      await get().refreshList();
      return plan;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to clone plan",
      });
      return null;
    }
  },

  archivePlan: async (planId) => {
    const workspaceRoot = await getWorkspaceCwd().catch(() => "");
    const id = planId || get().activePlan?.id;
    if (!id || !workspaceRoot) return;
    const source =
      get().activePlan?.id === id
        ? get().activePlan!
        : await loadPlanArtifact(workspaceRoot, id);
    if (!source) return;
    const next = archivePlanArtifact(source);
    await savePlanArtifact(workspaceRoot, next);
    if (get().activePlan?.id === id) {
      set({
        activePlan: next,
        planExecuteUnlocked: false,
      });
    }
    await get().refreshList();
  },

  unarchivePlan: async (planId) => {
    const workspaceRoot = await getWorkspaceCwd().catch(() => "");
    if (!workspaceRoot) return;
    const source = await loadPlanArtifact(workspaceRoot, planId);
    if (!source) return;
    const next = unarchivePlanArtifact(source);
    await savePlanArtifact(workspaceRoot, next);
    if (get().activePlan?.id === planId) {
      set({ activePlan: next });
    }
    await get().refreshList();
  },

  deletePlan: async (planId) => {
    const workspaceRoot = await getWorkspaceCwd().catch(() => "");
    if (!workspaceRoot) return;
    await deletePlanArtifact(workspaceRoot, planId);
    if (get().activePlan?.id === planId) {
      set({
        activePlan: null,
        planExecuteUnlocked: false,
        executionDrift: null,
      });
    }
    await get().refreshList();
  },
}));
