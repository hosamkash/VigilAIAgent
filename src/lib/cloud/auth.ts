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
