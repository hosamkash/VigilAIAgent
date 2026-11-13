/**
 * Register this desktop session under the signed-in account (audit only — no seat limit).
 */

import { doc, setDoc } from "firebase/firestore";
import { CLOUD_COLLECTIONS } from "./collections";
import { getFirebaseDb } from "./firebase";
import { rejectIfCodeUpload } from "./no-code-upload";

export type CloudDeviceDoc = {
  id: string;
  userId: string;
  label: string;
  platform: string;
  surface: "desktop";
  lastSeenAt: number;
  createdAt: number;
};

const DEVICE_KEY = "vigil.cloud.deviceId";

export function getOrCreateLocalDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing?.trim()) return existing.trim();
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Date.now()}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return `dev-ephemeral-${Date.now()}`;
  }
}

export async function touchCloudDevice(userId: string): Promise<CloudDeviceDoc> {
  const id = getOrCreateLocalDeviceId();
  const now = Date.now();
  const payload: CloudDeviceDoc = {
    id,
    userId,
    label: "Vigil Desktop",
    platform:
      typeof navigator !== "undefined" ? navigator.platform || "unknown" : "unknown",
    surface: "desktop",
    lastSeenAt: now,
    createdAt: now,
  };
  rejectIfCodeUpload(payload);
  const db = getFirebaseDb();
  await setDoc(doc(db, CLOUD_COLLECTIONS.devices, id), payload, { merge: true });
  return payload;
}
