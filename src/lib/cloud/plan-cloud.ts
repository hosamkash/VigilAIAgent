/**
 * Map local Plan artifacts ↔ cloud-safe plan docs (no workspace files).
 */

import type { PlanArtifact } from "../plan-artifact";
import { rejectIfCodeUpload } from "./no-code-upload";
import type { CloudPlanDoc } from "./types";

export function planArtifactToCloudDoc(
  plan: PlanArtifact,
  userId: string,
): CloudPlanDoc {
  const doc: CloudPlanDoc = {
    id: plan.id,
    userId,
    chatId: plan.chatTabId || null,
    title: plan.title,
    goal: plan.goal,
    status: plan.status,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    assumptions: plan.assumptions,
    risks: plan.risks,
    steps: plan.steps.map((s) => ({
      ...s,
      // hints may list paths/symbols — names only, not file bodies
      hints: s.hints
        ? {
            files: s.hints.files,
            symbols: s.hints.symbols,
            commands: s.hints.commands,
          }
        : undefined,
    })),
    execution: plan.execution,
    archivedAt: plan.archivedAt ?? null,
    workspaceHint: plan.workspaceRoot
      ? plan.workspaceRoot.split(/[/\\]/).filter(Boolean).slice(-2).join("/")
      : null,
  };
  rejectIfCodeUpload(doc);
  return doc;
}

export function cloudDocToPlanArtifact(
  doc: CloudPlanDoc,
  workspaceRoot?: string,
): PlanArtifact {
  return {
    id: doc.id,
    title: doc.title,
    goal: doc.goal,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    workspaceRoot,
    chatTabId: doc.chatId || undefined,
    assumptions: doc.assumptions,
    risks: doc.risks,
    steps: doc.steps || [],
    execution: doc.execution,
    archivedAt: doc.archivedAt || undefined,
  };
}
