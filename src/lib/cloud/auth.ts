/**
 * Firebase Auth helpers for Vigil Desktop Cloud Bridge.
 */

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { CLOUD_COLLECTIONS } from "./collections";
import { getFirebaseAuth, getFirebaseDb, isFirebaseConfigured } from "./firebase";
import type { CloudUserDoc, PlanTier } from "./types";
import { rejectIfCodeUpload } from "./no-code-upload";

export type CloudSessionUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

export type CloudBillingProfile = {
  planTier: PlanTier;
  tokenBalance: number;
  entitlements: string[];
  planId: string | null;
};

export async function fetchCloudBillingProfile(
  uid: string,
): Promise<CloudBillingProfile | null> {
  if (!isFirebaseConfigured() || !uid) return null;
  try {
    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, CLOUD_COLLECTIONS.users, uid));
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, unknown>;
    const entitlements = Array.isArray(data.entitlements)
      ? data.entitlements.filter((x): x is string => typeof x === "string")
      : [];
    const planTier = (typeof data.planTier === "string"
      ? data.planTier
      : "free") as PlanTier;
    let tokenBalance = Number(data.tokenBalance ?? 0) || 0;
    try {
      const wallet = await getDoc(doc(db, CLOUD_COLLECTIONS.wallets, uid));
      if (wallet.exists()) {
        const w = wallet.data() as Record<string, unknown>;
        const remaining = Number(w.remaining ?? w.tokenBalance ?? w.balance ?? 0);
        if (Number.isFinite(remaining) && remaining > 0) tokenBalance = remaining;
      }
    } catch {
      /* users.tokenBalance is enough */
    }
    return {
      planTier,
      tokenBalance,
      entitlements,
      planId: typeof data.planId === "string" ? data.planId : null,
    };
  } catch {
    return null;
  }
}

export function toSessionUser(user: User): CloudSessionUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
  };
}

export function subscribeAuth(
  onChange: (user: CloudSessionUser | null) => void,
): () => void {
  if (!isFirebaseConfigured()) {
    onChange(null);
    return () => {};
  }
  const auth = getFirebaseAuth();
  return onAuthStateChanged(auth, (user) => {
    onChange(user ? toSessionUser(user) : null);
  });
}

async function ensureUserDoc(user: User, planTier: PlanTier = "free"): Promise<void> {
  const db = getFirebaseDb();
  const ref = doc(db, CLOUD_COLLECTIONS.users, user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  const now = Date.now();
  const payload: CloudUserDoc = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    planTier,
    createdAt: now,
    updatedAt: now,
  };
  rejectIfCodeUpload(payload);
  await setDoc(ref, {
    ...payload,
    // serverTimestamp for audit; keep millis for clients that prefer numbers
    createdAtServer: serverTimestamp(),
  });
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<CloudSessionUser> {
  const cred = await signInWithEmailAndPassword(
    getFirebaseAuth(),
    email.trim(),
    password,
  );
  await ensureUserDoc(cred.user);
  return toSessionUser(cred.user);
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string,
): Promise<CloudSessionUser> {
  const cred = await createUserWithEmailAndPassword(
    getFirebaseAuth(),
    email.trim(),
    password,
  );
  if (displayName?.trim()) {
    await updateProfile(cred.user, { displayName: displayName.trim() });
  }
  await ensureUserDoc(cred.user, "trial");
  return toSessionUser(cred.user);
}

export async function signOutCloud(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  await signOut(getFirebaseAuth());
}

/** Fresh ID token for Vigil Web session cookie handoff (embed bridge). */
export async function getCloudIdToken(forceRefresh = true): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}
