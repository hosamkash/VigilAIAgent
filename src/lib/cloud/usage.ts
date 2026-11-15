/**
 * Desktop usage events → Firestore + best-effort shared tokenBalance debit.
 */

import { doc, getDoc, setDoc } from "firebase/firestore";
import { CLOUD_COLLECTIONS } from "./collections";
import { getFirebaseDb } from "./firebase";
import { rejectIfCodeUpload } from "./no-code-upload";
import type { CloudUsageEventDoc } from "./types";

export type RecordUsageInput = {
  userId: string;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  cost?: number;
  deviceId?: string | null;
};

/** Rough token debit for shared wallet (input+output). */
export function estimateTokenDebit(input: {
  inputTokens: number;
  outputTokens: number;
}): number {
  const inn = Math.max(0, Math.floor(Number(input.inputTokens) || 0));
  const out = Math.max(0, Math.floor(Number(input.outputTokens) || 0));
  return inn + out;
}

export async function recordDesktopUsageEvent(
  input: RecordUsageInput,
): Promise<CloudUsageEventDoc> {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `usage-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const event: CloudUsageEventDoc = {
    id,
    userId: input.userId,
    surface: "desktop",
    deviceId: input.deviceId ?? null,
    model: input.model ?? null,
    inputTokens: Math.max(0, Math.floor(input.inputTokens || 0)),
    outputTokens: Math.max(0, Math.floor(input.outputTokens || 0)),
    cost: input.cost,
    createdAt: Date.now(),
  };
  rejectIfCodeUpload(event);
  const db = getFirebaseDb();
  await setDoc(doc(db, CLOUD_COLLECTIONS.usageEvents, id), event);

  // Shared wallet continuum: debit users.tokenBalance (same field web chat uses).
  const debit = estimateTokenDebit(event);
  if (debit > 0) {
    try {
      const userRef = doc(db, CLOUD_COLLECTIONS.users, input.userId);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const current = Number(snap.data()?.tokenBalance ?? 0) || 0;
        const next = Math.max(0, current - debit);
        await setDoc(
          userRef,
          { tokenBalance: next, updatedAt: Date.now() },
          { merge: true },
        );
      }
    } catch {
      /* rules / offline — event already written */
    }
  }

  return event;
}
