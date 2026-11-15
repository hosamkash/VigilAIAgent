/** Load/save Plan artifacts under workspace `.vigil/plans/`. */

import {
  type PlanArtifact,
  joinWorkspacePath,
  parsePlanArtifactJson,
  planRelativePath,
  plansRelativeDir,
  serializePlanArtifact,
} from "./plan-artifact";
import { createDir, listDir, readTextFile, writeTextFile } from "./workspace-fs";

export async function ensurePlansDir(workspaceRoot: string): Promise<string> {
  const dir = joinWorkspacePath(workspaceRoot, plansRelativeDir());
  try {
    await createDir(dir);
  } catch {
    /* may already exist */
  }
  return dir;
}

export async function savePlanArtifact(
  workspaceRoot: string,
  plan: PlanArtifact,
): Promise<string> {
  await ensurePlansDir(workspaceRoot);
  const rel = planRelativePath(plan.id);
  const abs = joinWorkspacePath(workspaceRoot, rel);
  const next = { ...plan, updatedAt: Date.now(), workspaceRoot };
  await writeTextFile(abs, serializePlanArtifact(next));
  return abs;
}

export async function loadPlanArtifact(
  workspaceRoot: string,
  planId: string,
): Promise<PlanArtifact | null> {
  const abs = joinWorkspacePath(workspaceRoot, planRelativePath(planId));
  try {
    const text = await readTextFile(abs);
    return parsePlanArtifactJson(text);
  } catch {
    return null;
  }
}

export async function listPlanArtifacts(
  workspaceRoot: string,
  options?: { includeArchived?: boolean },
): Promise<PlanArtifact[]> {
  const dir = joinWorkspacePath(workspaceRoot, plansRelativeDir());
  let entries: { name: string; isDir: boolean }[] = [];
  try {
    entries = await listDir(dir);
  } catch {
    return [];
  }
  const plans: PlanArtifact[] = [];
  for (const entry of entries) {
    if (entry.isDir || !entry.name.endsWith(".json")) continue;
    const id = entry.name.replace(/\.json$/i, "");
    const plan = await loadPlanArtifact(workspaceRoot, id);
    if (!plan) continue;
    const archived =
      typeof plan.archivedAt === "number" && plan.archivedAt > 0;
    if (archived && !options?.includeArchived) continue;
    plans.push(plan);
  }
  return plans.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deletePlanArtifact(
  workspaceRoot: string,
  planId: string,
): Promise<void> {
  const abs = joinWorkspacePath(workspaceRoot, planRelativePath(planId));
  const { deletePath } = await import("./workspace-fs");
  await deletePath(abs);
}
