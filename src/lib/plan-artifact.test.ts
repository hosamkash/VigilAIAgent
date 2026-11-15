import { describe, expect, it } from "vitest";
import {
  approvePlan,
  archivePlanArtifact,
  clonePlanArtifact,
  countInProgressSteps,
  createPlanArtifact,
  deriveExecutionOutcome,
  enforceSingleInProgress,
  formatPlanExecutePrompt,
  formatPlanResumePrompt,
  hintsToEditableText,
  isDangerousStepContent,
  isPlanArchived,
  joinWorkspacePath,
  mergeManagePlanIntoExecution,
  mergeManagePlanItems,
  normalizePlanArtifact,
  parseHintsEditableText,
  parsePlanArtifactJson,
  pauseExecutingPlan,
  planRelativePath,
  resumeExecutingPlan,
  retryFailedStep,
  revisePlanForEdit,
  serializePlanArtifact,
  skipFailedAndContinue,
  startExecutingPlan,
  unarchivePlanArtifact,
  withReorderedSteps,
  withUpdatedStep,
} from "./plan-artifact";

describe("plan-artifact", () => {
  it("creates a draft plan with normalized steps", () => {
    const plan = createPlanArtifact({
      goal: "Add Plan Mode persistence",
      steps: [
        { content: "Model", status: "done" },
        { content: "Write-gate", status: "pending" },
      ],
    });
    expect(plan.status).toBe("draft");
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].status).toBe("completed");
    expect(plan.steps[0].id).toBeTruthy();
  });

  it("round-trips JSON persistence shape", () => {
    const plan = createPlanArtifact({
      title: "Test",
      goal: "Persist me",
      workspaceRoot: "/tmp/ws",
      steps: [{ id: "s1", content: "One", status: "pending" }],
    });
    const again = parsePlanArtifactJson(serializePlanArtifact(plan));
    expect(again).toMatchObject({
      id: plan.id,
      title: "Test",
      goal: "Persist me",
      status: "draft",
      steps: [{ id: "s1", content: "One", status: "pending" }],
    });
  });

  it("approves draft and updates steps / reorder", () => {
    let plan = createPlanArtifact({
      goal: "G",
      steps: [
        { id: "a", content: "A", status: "pending" },
        { id: "b", content: "B", status: "pending" },
      ],
    });
    plan = approvePlan(plan);
    expect(plan.status).toBe("approved");
    plan = withUpdatedStep(plan, "a", { status: "in_progress" });
    expect(countInProgressSteps(plan)).toBe(1);
    plan = withReorderedSteps(plan, ["b", "a"]);
    expect(plan.steps.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("rejects garbage normalize", () => {
    expect(normalizePlanArtifact(null)).toBeNull();
    expect(normalizePlanArtifact({ foo: 1 })).toBeNull();
  });

  it("builds plan file paths under .vigil/plans", () => {
    expect(planRelativePath("abc-123")).toBe(".vigil/plans/abc-123.json");
    expect(joinWorkspacePath("/Users/me/proj", ".vigil/plans/x.json")).toBe(
      "/Users/me/proj/.vigil/plans/x.json",
    );
  });

  it("merges manage_plan items and formats execute prompt", () => {
    const merged = mergeManagePlanItems(null, [
      { id: "1", content: "Investigate", status: "completed" },
      { id: "2", content: "Ship fix", status: "pending" },
    ]);
    expect(merged.steps).toHaveLength(2);
    const running = startExecutingPlan(merged);
    expect(running.status).toBe("running");
    expect(running.execution?.startedAt).toBeTruthy();
    // First incomplete step seeded as in_progress
    expect(running.steps.find((s) => s.id === "2")?.status).toBe("in_progress");
    const prompt = formatPlanExecutePrompt(running);
    expect(prompt).toContain("Execute the approved Vigil plan");
    expect(prompt).toContain("id=2");
    expect(prompt).toContain("Ship fix");
  });

  it("enforces one in_progress and merges execution statuses by id", () => {
    let plan = createPlanArtifact({
      goal: "Ship",
      steps: [
        { id: "a", content: "Explore", status: "pending" },
        { id: "b", content: "Patch", status: "pending" },
      ],
    });
    plan = startExecutingPlan(approvePlan(plan));
    expect(countInProgressSteps(plan)).toBe(1);

    const dual = enforceSingleInProgress({
      ...plan,
      steps: plan.steps.map((s) => ({ ...s, status: "in_progress" as const })),
    });
    expect(countInProgressSteps(dual)).toBe(1);

    const { plan: advanced, drift } = mergeManagePlanIntoExecution(plan, [
      { id: "a", content: "Explore", status: "completed" },
      { id: "b", content: "Patch", status: "in_progress" },
    ]);
    expect(drift).toBeNull();
    expect(advanced.steps.find((s) => s.id === "a")?.status).toBe("completed");
    expect(advanced.steps.find((s) => s.id === "b")?.status).toBe("in_progress");
    expect(deriveExecutionOutcome(advanced)).toBe("running");
  });

  it("flags drift when agent invents steps during execution", () => {
    let plan = createPlanArtifact({
      goal: "Ship",
      steps: [
        { id: "a", content: "Explore", status: "pending" },
        { id: "b", content: "Patch", status: "pending" },
      ],
    });
    plan = startExecutingPlan(approvePlan(plan));
    const { plan: next, drift } = mergeManagePlanIntoExecution(plan, [
      { id: "a", content: "Explore", status: "completed" },
      { id: "x", content: "Secret rewrite everything", status: "pending" },
    ]);
    expect(drift).not.toBeNull();
    expect(drift?.extraStepContents).toContain("Secret rewrite everything");
    expect(next.steps).toHaveLength(2);
    expect(next.steps.map((s) => s.id)).toEqual(["a", "b"]);
    expect(next.execution?.drift?.message).toMatch(/outside the approved plan/i);
  });

  it("matches by content when ids differ and settles outcome", () => {
    let plan = createPlanArtifact({
      goal: "Done",
      steps: [{ id: "a", content: "Only step", status: "pending" }],
    });
    plan = startExecutingPlan(approvePlan(plan));
    const { plan: next, drift } = mergeManagePlanIntoExecution(plan, [
      { id: "fresh", content: "Only step", status: "completed" },
    ]);
    expect(drift).toBeNull();
    expect(next.steps[0].id).toBe("a");
    expect(next.steps[0].status).toBe("completed");
    expect(deriveExecutionOutcome(next)).toBe("completed");
  });

  it("pauses and resumes without losing step progress", () => {
    let plan = createPlanArtifact({
      goal: "Ship",
      steps: [
        { id: "a", content: "Explore", status: "completed" },
        { id: "b", content: "Patch", status: "pending" },
      ],
    });
    plan = startExecutingPlan(approvePlan(plan));
    expect(plan.steps.find((s) => s.id === "b")?.status).toBe("in_progress");
    plan = pauseExecutingPlan(plan);
    expect(plan.status).toBe("paused");
    expect(plan.execution?.pausedAt).toBeTruthy();
    expect(plan.steps.find((s) => s.id === "a")?.status).toBe("completed");
    plan = resumeExecutingPlan(plan);
    expect(plan.status).toBe("running");
    expect(formatPlanResumePrompt(plan)).toContain("Resume the paused Vigil plan");
    expect(formatPlanResumePrompt(plan)).toContain("id=b");
  });

  it("recovers from failed step via retry, skip, or revise", () => {
    let plan = createPlanArtifact({
      goal: "Ship",
      steps: [
        { id: "a", content: "Explore", status: "completed" },
        { id: "b", content: "Patch", status: "failed" },
        { id: "c", content: "Test", status: "pending" },
      ],
    });
    plan = {
      ...plan,
      status: "failed",
      execution: { failedStepId: "b", lastError: "Patch broke" },
    };

    const retried = retryFailedStep(plan);
    expect(retried.status).toBe("running");
    expect(retried.steps.find((s) => s.id === "b")?.status).toBe("in_progress");
    expect(formatPlanResumePrompt(retried, "retry")).toContain("Retry the failed");

    const continued = skipFailedAndContinue(plan);
    expect(continued.steps.find((s) => s.id === "b")?.status).toBe("skipped");
    expect(continued.steps.find((s) => s.id === "c")?.status).toBe("in_progress");

    const revised = revisePlanForEdit(plan);
    expect(revised.status).toBe("draft");
  });

  it("clones, archives, and parses hints / dangerous flags", () => {
    const plan = createPlanArtifact({
      title: "Auth fix",
      goal: "Fix login",
      steps: [
        {
          id: "a",
          content: "Push migration",
          status: "completed",
          optional: true,
          parallelizable: true,
          acceptance: "npm test",
          hints: { files: ["src/auth.ts"], symbols: ["login"] },
        },
      ],
    });
    expect(isDangerousStepContent("Push migration")).toBe(true);
    expect(isDangerousStepContent("Read README")).toBe(false);

    const cloned = clonePlanArtifact(plan);
    expect(cloned.id).not.toBe(plan.id);
    expect(cloned.status).toBe("draft");
    expect(cloned.title).toContain("Copy of");
    expect(cloned.steps[0].status).toBe("pending");
    expect(cloned.steps[0].id).not.toBe("a");
    expect(cloned.steps[0].acceptance).toBe("npm test");

    const archived = archivePlanArtifact(plan);
    expect(isPlanArchived(archived)).toBe(true);
    expect(isPlanArchived(unarchivePlanArtifact(archived))).toBe(false);

    const hints = parseHintsEditableText(
      "src/a.ts, @Foo, !npm test",
    );
    expect(hints?.files).toEqual(["src/a.ts"]);
    expect(hints?.symbols).toEqual(["Foo"]);
    expect(hints?.commands).toEqual(["npm test"]);
    expect(hintsToEditableText(hints)).toContain("@Foo");

    const prompt = formatPlanExecutePrompt({
      ...plan,
      steps: [
        {
          ...plan.steps[0],
          status: "pending",
        },
      ],
    });
    expect(prompt).toContain("parallelizable");
    expect(prompt).toContain("acceptance: npm test");
    expect(prompt).toContain("hints:");
  });
});
