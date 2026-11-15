/**
 * Push / pull Plan Mode artifacts to Firestore (account-scoped).
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import type { PlanArtifact } from "../plan-artifact";
import { loadPlanArtifact, savePlanArtifact } from "../plan-artifact-fs";
import { CLOUD_COLLECTIONS } from "./collections";
import { getFirebaseDb } from "./firebase";
import { rejectIfCodeUpload } from "./no-code-upload";
import { cloudDocToPlanArtifact, planArtifactToCloudDoc } from "./plan-cloud";
import type { CloudPlanDoc } from "./types";

export async function pushPlanToCloud(
  plan: PlanArtifact,
  userId: string,
): Promise<CloudPlanDoc> {
  const payload = planArtifactToCloudDoc(plan, userId);
  rejectIfCodeUpload(payload);
  const db = getFirebaseDb();
  await setDoc(doc(db, CLOUD_COLLECTIONS.plans, plan.id), payload, {
    merge: true,
  });
  return payload;
}

export async function pullPlanFromCloud(
  planId: string,
  workspaceRoot?: string,
): Promise<PlanArtifact | null> {
  const db = getFirebaseDb();
  const snap = await getDoc(doc(db, CLOUD_COLLECTIONS.plans, planId));
  if (!snap.exists()) return null;
  return cloudDocToPlanArtifact(snap.data() as CloudPlanDoc, workspaceRoot);
}

export async function listCloudPlansForUser(
  userId: string,
): Promise<CloudPlanDoc[]> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, CLOUD_COLLECTIONS.plans),
    where("userId", "==", userId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as CloudPlanDoc);
}

/** Prefer cloud when missing locally or cloud updatedAt is newer. */
export function shouldReplaceLocalPlanWithCloud(
  local: PlanArtifact | null,
  cloudUpdatedAt: number,
): boolean {
  if (!local) return true;
  return (cloudUpdatedAt || 0) > (local.updatedAt || 0);
}

/**
 * Ensure a plan exists under `.vigil/plans/` for Execute.
 * Pulls from Firestore when missing locally or cloud is newer.
 */
export async function ensureLocalPlanFromCloud(opts: {
  planId: string;
  userId: string;
  workspaceRoot: string;
}): Promise<PlanArtifact | null> {
  const { planId, userId, workspaceRoot } = opts;
  if (!planId || !userId || !workspaceRoot) return null;

  const local = await loadPlanArtifact(workspaceRoot, planId);
  const db = getFirebaseDb();
  const snap = await getDoc(doc(db, CLOUD_COLLECTIONS.plans, planId));
  if (!snap.exists()) return local;

  const cloudDoc = snap.data() as CloudPlanDoc;
  if (cloudDoc.userId && cloudDoc.userId !== userId) {
    throw new Error("Cloud plan belongs to another account.");
  }

  if (!shouldReplaceLocalPlanWithCloud(local, cloudDoc.updatedAt || 0)) {
    return local;
  }

  const fromCloud = cloudDocToPlanArtifact(cloudDoc, workspaceRoot);
  await savePlanArtifact(workspaceRoot, fromCloud);
  return fromCloud;
}
