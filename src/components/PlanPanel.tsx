import { useEffect, useState } from "react";
import {
  countCompletedSteps,
  countInProgressSteps,
  formatLastPlanRevisionDiff,
  hintsToEditableText,
  isDangerousStepContent,
  isPlanArchived,
  parseHintsEditableText,
  type PlanStep,
} from "../lib/plan-artifact";
import {
  isOpsStepContent,
  looksArabic,
} from "../lib/plan-mode-heuristics";
import { usePlanStore } from "../store/planStore";
import { useTabsStore } from "../store/tabsStore";

const STATUS_BADGE_EN: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  running: "Running",
  paused: "Paused",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_BADGE_AR: Record<string, string> = {
  draft: "مسودة",
  approved: "معتمدة",
  running: "تشغيل",
  paused: "موقوفة",
  completed: "خلصت",
  failed: "فشلت",
  cancelled: "اتلغت",
};

const STEP_LABEL: Record<string, string> = {
  pending: "pending",
  in_progress: "working",
  completed: "done",
  cancelled: "cancelled",
  failed: "failed",
  skipped: "skipped",
};

type Props = {
  onExecute: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRetry?: () => void;
  onContinue?: () => void;
  busy?: boolean;
};

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Editable draft / running plan panel (Plan Mode). */
export function PlanPanel({
  onExecute,
  onPause,
  onResume,
  onRetry,
  onContinue,
  busy,
}: Props) {
  const plan = usePlanStore((s) => s.activePlan);
  const recentPlans = usePlanStore((s) => s.recentPlans);
  const showArchived = usePlanStore((s) => s.showArchived);
  const executionDrift = usePlanStore((s) => s.executionDrift);
  const approveActive = usePlanStore((s) => s.approveActive);
  const persistActive = usePlanStore((s) => s.persistActive);
  const cancelExecute = usePlanStore((s) => s.cancelExecute);
  const reviseAfterFailure = usePlanStore((s) => s.reviseAfterFailure);
  const updateStep = usePlanStore((s) => s.updateStep);
  const moveStep = usePlanStore((s) => s.moveStep);
  const removeStep = usePlanStore((s) => s.removeStep);
  const addStep = usePlanStore((s) => s.addStep);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const refreshList = usePlanStore((s) => s.refreshList);
  const openPlan = usePlanStore((s) => s.openPlan);
  const clonePlan = usePlanStore((s) => s.clonePlan);
  const archivePlan = usePlanStore((s) => s.archivePlan);
  const unarchivePlan = usePlanStore((s) => s.unarchivePlan);
  const deletePlan = usePlanStore((s) => s.deletePlan);
  const setShowArchived = usePlanStore((s) => s.setShowArchived);
  const createDraft = usePlanStore((s) => s.createDraft);
  const activeTabId = useTabsStore((s) => s.activeTabId);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);

  useEffect(() => {
    void refreshList();
  }, [refreshList, showArchived]);

  const ar = looksArabic(
    `${plan?.title || ""} ${plan?.goal || ""}`,
  );
  const STATUS_BADGE = ar ? STATUS_BADGE_AR : STATUS_BADGE_EN;
  const t = {
    plan: ar ? "خطة" : "Plan",
    history: ar ? "السجل" : "History",
    hideHistory: ar ? "إخفاء السجل" : "Hide history",
    approve: ar ? "موافقة" : "Approve",
    execute: ar ? "تنفيذ" : "Execute",
    pause: ar ? "إيقاف مؤقت" : "Pause",
    resume: ar ? "استكمال" : "Resume",
    retry: ar ? "إعادة الخطوة" : "Retry step",
    skip: ar ? "تخطّي وكمل" : "Skip & continue",
    revise: ar ? "عدّل الخطة" : "Revise plan",
    stop: ar ? "إيقاف الخطة" : "Stop plan",
    noActive: ar ? "مفيش خطة نشطة" : "No active plan",
    saved: ar ? "الخطط المحفوظة" : "Saved plans",
    showArchived: ar ? "اعرض المؤرشف" : "Show archived",
    newPlan: ar ? "+ جديدة" : "+ New",
    cloneActive: ar ? "نسخ النشطة" : "Clone active",
    addStep: ar ? "+ أضف خطوة" : "+ Add step",
    revisions: ar ? "مراجعات" : "Revisions",
  };

  const editable = plan
    ? plan.status === "draft" || plan.status === "approved"
    : false;
  const revisionDiff = plan ? formatLastPlanRevisionDiff(plan) : null;
  const canApprove = !!plan && plan.status === "draft" && plan.steps.length > 0;
  const canExecute =
    !!plan &&
    (plan.status === "draft" || plan.status === "approved") &&
    plan.steps.length > 0 &&
    !busy;
  const running = plan?.status === "running";
  const paused = plan?.status === "paused";
  const failed = plan?.status === "failed";
  const doneCount = plan ? countCompletedSteps(plan) : 0;
  const total = plan?.steps.length || 0;
  const inFlight = plan ? countInProgressSteps(plan) : 0;
  const drift = executionDrift || plan?.execution?.drift || null;

  function patchStep(stepId: string, patch: Partial<PlanStep>) {
    updateStep(stepId, patch);
  }

  return (
    <div className="mb-2 rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-2 text-[12px]">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--vigil-muted)]">
              {t.plan}
            </span>
            {plan ? (
              <span className="rounded bg-[var(--vigil-accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--vigil-accent)]">
                {STATUS_BADGE[plan.status] || plan.status}
                {isPlanArchived(plan)
                  ? ar
                    ? " · مؤرشفة"
                    : " · archived"
                  : ""}
              </span>
            ) : (
              <span className="text-[10px] text-[var(--vigil-muted)]">
                {t.noActive}
              </span>
            )}
            {plan && total > 0 ? (
              <span className="text-[10px] text-[var(--vigil-muted)]">
                {doneCount}/{total} done
                {running && inFlight > 0 ? ` · ${inFlight} active` : ""}
              </span>
            ) : null}
          </div>
          {plan && editable ? (
            <input
              className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-1.5 py-1 text-[12px] text-[var(--vigil-text)]"
              value={plan.title}
              onChange={(e) =>
                setActivePlan({
                  ...plan,
                  title: e.target.value,
                  updatedAt: Date.now(),
                })
              }
              onBlur={() => void persistActive()}
              aria-label="Plan title"
            />
          ) : plan ? (
            <div className="mt-0.5 font-medium text-[var(--vigil-text)]">
              {plan.title}
            </div>
          ) : null}
          {plan && editable ? (
            <textarea
              className="mt-1 w-full resize-y rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-1.5 py-1 text-[11px] text-[var(--vigil-muted)]"
              rows={2}
              value={plan.goal}
              onChange={(e) =>
                setActivePlan({
                  ...plan,
                  goal: e.target.value,
                  updatedAt: Date.now(),
                })
              }
              onBlur={() => void persistActive()}
              aria-label="Plan goal"
            />
          ) : plan ? (
            <div className="mt-0.5 text-[11px] text-[var(--vigil-muted)]">
              {plan.goal}
            </div>
          ) : null}
          {failed && plan?.execution?.lastError ? (
            <div className="mt-1 text-[11px] text-[var(--vigil-danger)]">
              {plan.execution.lastError}
            </div>
          ) : null}
          {plan?.chatTabId ? (
            <div className="mt-0.5 text-[10px] text-[var(--vigil-muted)]">
              {ar ? "مرتبطة بالشات" : "Linked chat"}: {plan.chatTabId.slice(0, 8)}…
            </div>
          ) : null}
          {revisionDiff ? (
            <pre className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-1.5 py-1 text-[10px] text-[var(--vigil-muted)]">
              {t.revisions}:{"\n"}
              {revisionDiff}
            </pre>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1 text-[11px] text-[var(--vigil-text)]"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            {historyOpen ? t.hideHistory : t.history}
          </button>
          {canApprove ? (
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1 text-[11px] text-[var(--vigil-text)]"
              onClick={() => void approveActive()}
            >
              {t.approve}
            </button>
          ) : null}
          {canExecute ? (
            <button
              type="button"
              className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-[11px] !text-white"
              onClick={onExecute}
            >
              {t.execute}
            </button>
          ) : null}
          {running ? (
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1 text-[11px] text-[var(--vigil-text)]"
              onClick={() => onPause?.()}
              disabled={!onPause}
            >
              {t.pause}
            </button>
          ) : null}
          {paused && !busy ? (
            <button
              type="button"
              className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-[11px] !text-white"
              onClick={() => onResume?.()}
            >
              {t.resume}
            </button>
          ) : null}
          {failed && !busy ? (
            <>
              <button
                type="button"
                className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-[11px] !text-white"
                onClick={() => onRetry?.()}
              >
                {t.retry}
              </button>
              <button
                type="button"
                className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1 text-[11px] text-[var(--vigil-text)]"
                onClick={() => onContinue?.()}
              >
                {t.skip}
              </button>
              <button
                type="button"
                className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1 text-[11px] text-[var(--vigil-text)]"
                onClick={() => void reviseAfterFailure()}
              >
                {t.revise}
              </button>
            </>
          ) : null}
          {running || paused || failed ? (
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1 text-[11px] text-[var(--vigil-danger)]"
              onClick={() => void cancelExecute()}
            >
              {t.stop}
            </button>
          ) : null}
        </div>
      </div>

      {historyOpen ? (
        <div className="mb-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-2">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--vigil-muted)]">
              {t.saved}
            </span>
            <div className="flex flex-wrap gap-1">
              <label className="flex items-center gap-1 text-[10px] text-[var(--vigil-muted)]">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => {
                    setShowArchived(e.target.checked);
                    void refreshList({ includeArchived: e.target.checked });
                  }}
                />
                {t.showArchived}
              </label>
              <button
                type="button"
                className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] text-[var(--vigil-accent)]"
                onClick={() =>
                  void createDraft(ar ? "خطة جديدة" : "New plan", undefined, {
                    chatTabId: activeTabId || undefined,
                  })
                }
              >
                {t.newPlan}
              </button>
              {plan ? (
                <button
                  type="button"
                  className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] text-[var(--vigil-text)]"
                  onClick={() => void clonePlan(plan.id)}
                >
                  {t.cloneActive}
                </button>
              ) : null}
            </div>
          </div>
          {recentPlans.length === 0 ? (
            <div className="text-[11px] text-[var(--vigil-muted)]">
              {ar
                ? "مفيش خطط محفوظة بعد. نفّذ أو احفظ مسودة."
                : "No saved plans yet. Execute or save a draft to create one."}
            </div>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {recentPlans.map((item) => {
                const active = plan?.id === item.id;
                const archived = isPlanArchived(item);
                return (
                  <li
                    key={item.id}
                    className={`flex items-start gap-1 rounded px-1 py-1 ${
                      active
                        ? "bg-[var(--vigil-accent-soft)]/50"
                        : "hover:bg-[var(--vigil-bg)]"
                    }`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => void openPlan(item.id)}
                    >
                      <div className="truncate text-[11px] text-[var(--vigil-text)]">
                        {item.title}
                        {archived ? " (archived)" : ""}
                      </div>
                      <div className="truncate text-[10px] text-[var(--vigil-muted)]">
                        {STATUS_BADGE[item.status] || item.status} ·{" "}
                        {item.steps.length} steps · {formatWhen(item.updatedAt)}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded px-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
                      title="Clone"
                      onClick={() => void clonePlan(item.id)}
                    >
                      Clone
                    </button>
                    {archived ? (
                      <button
                        type="button"
                        className="shrink-0 rounded px-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
                        onClick={() => void unarchivePlan(item.id)}
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="shrink-0 rounded px-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
                        onClick={() => void archivePlan(item.id)}
                      >
                        Archive
                      </button>
                    )}
                    <button
                      type="button"
                      className="shrink-0 rounded px-1 text-[10px] text-[var(--vigil-danger)]"
                      title="Delete"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete plan “${item.title}”? This cannot be undone.`,
                          )
                        ) {
                          void deletePlan(item.id);
                        }
                      }}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {drift ? (
        <div
          className="mb-2 rounded border border-[var(--vigil-danger)]/40 bg-[var(--vigil-danger)]/10 px-2 py-1.5 text-[11px] text-[var(--vigil-danger)]"
          role="status"
        >
          <div className="font-medium">Plan drift</div>
          <div className="opacity-90">{drift.message}</div>
          {drift.extraStepContents.length > 0 ? (
            <ul className="mt-1 list-inside list-disc opacity-80">
              {drift.extraStepContents.slice(0, 4).map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {plan ? (
        <ol className="space-y-1.5">
          {plan.steps.map((step, index) => {
            const dangerous = isDangerousStepContent(step.content);
            const ops = isOpsStepContent(step.content);
            const expanded = expandedStepId === step.id;
            return (
              <li
                key={step.id}
                className={`rounded border px-0.5 ${
                  step.status === "in_progress"
                    ? "border-[var(--vigil-accent)]/50 bg-[var(--vigil-accent-soft)]/40"
                    : step.status === "failed" || dangerous
                      ? "border-[var(--vigil-danger)]/40"
                      : "border-transparent hover:border-[var(--vigil-border)]"
                }`}
              >
                <div className="flex items-start gap-1.5">
                  <span className="mt-1.5 w-4 shrink-0 text-center text-[10px] text-[var(--vigil-muted)]">
                    {index + 1}
                  </span>
                  {editable ? (
                    <input
                      className="min-w-0 flex-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-1.5 py-1 text-[12px] text-[var(--vigil-text)]"
                      value={step.content}
                      onChange={(e) =>
                        patchStep(step.id, { content: e.target.value })
                      }
                      onBlur={() => void persistActive()}
                    />
                  ) : (
                    <span
                      className={`min-w-0 flex-1 py-1 ${
                        step.status === "completed" ||
                        step.status === "skipped"
                          ? "text-[var(--vigil-muted)] line-through"
                          : step.status === "failed"
                            ? "text-[var(--vigil-danger)]"
                            : "text-[var(--vigil-text)]"
                      }`}
                    >
                      {step.content}
                      {dangerous ? (
                        <span className="ml-1 text-[10px] text-[var(--vigil-danger)]">
                          · {ar ? "خطرة" : "risky"}
                        </span>
                      ) : null}
                      {ops ? (
                        <span className="ml-1 text-[10px] text-[var(--vigil-accent)]">
                          · ops
                        </span>
                      ) : null}
                      {step.optional ? (
                        <span className="ml-1 text-[10px] text-[var(--vigil-muted)]">
                          · {ar ? "اختيارية" : "optional"}
                        </span>
                      ) : null}
                      {step.parallelizable ? (
                        <span className="ml-1 text-[10px] text-[var(--vigil-muted)]">
                          · {ar ? "متوازية" : "parallel"}
                        </span>
                      ) : null}
                      <span
                        className={`ml-1.5 text-[10px] ${
                          step.status === "in_progress"
                            ? "text-[var(--vigil-accent)]"
                            : step.status === "failed"
                              ? "text-[var(--vigil-danger)]"
                              : "text-[var(--vigil-muted)]"
                        }`}
                      >
                        · {STEP_LABEL[step.status] || step.status}
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    className="mt-1 shrink-0 rounded px-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
                    title="Step details"
                    onClick={() =>
                      setExpandedStepId(expanded ? null : step.id)
                    }
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                  {editable ? (
                    <span className="flex shrink-0 gap-0.5">
                      <button
                        type="button"
                        className="rounded px-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
                        title="Move up"
                        onClick={() => {
                          moveStep(step.id, -1);
                          void persistActive();
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rounded px-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
                        title="Move down"
                        onClick={() => {
                          moveStep(step.id, 1);
                          void persistActive();
                        }}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="rounded px-1 text-[10px] text-[var(--vigil-danger)]"
                        title="Remove"
                        onClick={() => {
                          removeStep(step.id);
                          void persistActive();
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ) : null}
                </div>
                {expanded ? (
                  <div className="mb-1 ml-5 mt-1 space-y-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-1.5">
                    {editable ? (
                      <>
                        <label className="flex items-center gap-2 text-[10px] text-[var(--vigil-muted)]">
                          <input
                            type="checkbox"
                            checked={step.optional === true}
                            onChange={(e) => {
                              patchStep(step.id, {
                                optional: e.target.checked ? true : undefined,
                              });
                              void persistActive();
                            }}
                          />
                          Optional
                        </label>
                        <label className="flex items-center gap-2 text-[10px] text-[var(--vigil-muted)]">
                          <input
                            type="checkbox"
                            checked={step.parallelizable === true}
                            onChange={(e) => {
                              patchStep(step.id, {
                                parallelizable: e.target.checked
                                  ? true
                                  : undefined,
                              });
                              void persistActive();
                            }}
                          />
                          Parallelizable (delegate_tasks)
                        </label>
                        <label className="block text-[10px] text-[var(--vigil-muted)]">
                          Acceptance
                          <input
                            className="mt-0.5 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-1.5 py-1 text-[11px] text-[var(--vigil-text)]"
                            value={step.acceptance || ""}
                            placeholder="e.g. npm test passes"
                            onChange={(e) =>
                              patchStep(step.id, {
                                acceptance: e.target.value.trim() || undefined,
                              })
                            }
                            onBlur={() => void persistActive()}
                          />
                        </label>
                        <label className="block text-[10px] text-[var(--vigil-muted)]">
                          Hints / citations (files, @symbols, !commands)
                          <input
                            className="mt-0.5 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-1.5 py-1 text-[11px] text-[var(--vigil-text)]"
                            value={hintsToEditableText(step.hints)}
                            placeholder="src/foo.ts, @MySymbol, !npm test"
                            onChange={(e) =>
                              patchStep(step.id, {
                                hints: parseHintsEditableText(e.target.value),
                              })
                            }
                            onBlur={() => void persistActive()}
                          />
                        </label>
                      </>
                    ) : (
                      <div className="space-y-0.5 text-[10px] text-[var(--vigil-muted)]">
                        {step.optional ? <div>Optional</div> : null}
                        {step.parallelizable ? (
                          <div>Parallelizable</div>
                        ) : null}
                        {step.acceptance ? (
                          <div>Acceptance: {step.acceptance}</div>
                        ) : null}
                        {hintsToEditableText(step.hints) ? (
                          <div>Hints: {hintsToEditableText(step.hints)}</div>
                        ) : (
                          <div>No hints attached</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {editable && plan ? (
        <button
          type="button"
          className="mt-1.5 text-[11px] text-[var(--vigil-accent)]"
          onClick={() => {
            addStep("New step");
            void persistActive();
          }}
        >
          {t.addStep}
        </button>
      ) : null}
    </div>
  );
}
