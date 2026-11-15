/**
 * Vigil Browser visit history — metadata only (url / title / visitedAt).
 * Never stores page HTML, cookies, passwords, or screenshots.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { browserTabTitle, normalizeBrowserUrl } from "../browser-url";
import { CLOUD_COLLECTIONS } from "./collections";
import { getFirebaseDb, isFirebaseConfigured } from "./firebase";
import { rejectIfCodeUpload } from "./no-code-upload";
import type { CloudBrowserVisitDoc } from "./types";

export const BROWSER_HISTORY_MAX = 200;
export const BROWSER_HISTORY_LOCAL_KEY = "vigil.browser.visits";

export type BrowserVisit = {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  /** Present when synced / owned by a cloud user */
  userId?: string;
};

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `visit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Strip anything that is not safe visit metadata. */
export function sanitizeBrowserVisitInput(input: {
  url: string;
  title?: string;
  visitedAt?: number;
  id?: string;
}): BrowserVisit | null {
  const raw = (input.url || "").trim();
  if (!raw) return null;
  // Refuse dangerous schemes before normalize (which may rewrite search queries).
  const rawLower = raw.toLowerCase();
  if (
    rawLower.startsWith("data:") ||
    rawLower.startsWith("javascript:") ||
    rawLower.startsWith("blob:") ||
    rawLower.startsWith("file:") ||
    raw.length > 2048
  ) {
    return null;
  }
  const url = normalizeBrowserUrl(raw);
  if (!url) return null;
  const lower = url.toLowerCase();
  if (
    lower.startsWith("data:") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("file:") ||
    url.length > 2048
  ) {
    return null;
  }
  const titleRaw = (input.title || browserTabTitle(url)).trim().slice(0, 200);
  return {
    id: input.id?.trim() || newId(),
    url,
    title: titleRaw || browserTabTitle(url),
    visitedAt: input.visitedAt && input.visitedAt > 0 ? input.visitedAt : Date.now(),
  };
}

export function loadLocalBrowserVisits(): BrowserVisit[] {
  try {
    const raw = localStorage.getItem(BROWSER_HISTORY_LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const r = row as Record<string, unknown>;
        return sanitizeBrowserVisitInput({
          id: typeof r.id === "string" ? r.id : undefined,
          url: typeof r.url === "string" ? r.url : "",
          title: typeof r.title === "string" ? r.title : undefined,
          visitedAt: typeof r.visitedAt === "number" ? r.visitedAt : undefined,
        });
      })
      .filter((v): v is BrowserVisit => Boolean(v))
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, BROWSER_HISTORY_MAX);
  } catch {
    return [];
  }
}

export function saveLocalBrowserVisits(visits: BrowserVisit[]): void {
  try {
    const clean = visits
      .map((v) =>
        sanitizeBrowserVisitInput({
          id: v.id,
          url: v.url,
          title: v.title,
          visitedAt: v.visitedAt,
        }),
      )
      .filter((v): v is BrowserVisit => Boolean(v))
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, BROWSER_HISTORY_MAX)
      .map((v) => ({
        id: v.id,
        url: v.url,
        title: v.title,
        visitedAt: v.visitedAt,
      }));
    localStorage.setItem(BROWSER_HISTORY_LOCAL_KEY, JSON.stringify(clean));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Insert or bump a visit: consecutive same URL updates timestamp;
 * otherwise prepends a new entry. Returns the new list head-first.
 */
export function mergeVisitIntoList(
  existing: BrowserVisit[],
  visit: BrowserVisit,
): BrowserVisit[] {
  const sameUrl = existing.find(
    (v) => v.url === visit.url || normalizeBrowserUrl(v.url) === visit.url,
  );
  let next: BrowserVisit[];
  if (sameUrl) {
    next = [
      { ...sameUrl, title: visit.title || sameUrl.title, visitedAt: visit.visitedAt },
      ...existing.filter((v) => v.id !== sameUrl.id),
    ];
  } else {
    next = [visit, ...existing];
  }
  return next.slice(0, BROWSER_HISTORY_MAX);
}

export function visitToCloudDoc(
  visit: BrowserVisit,
  userId: string,
): CloudBrowserVisitDoc {
  const doc: CloudBrowserVisitDoc = {
    id: visit.id,
    userId,
    url: visit.url,
    title: visit.title,
    visitedAt: visit.visitedAt,
    surface: "desktop",
  };
  rejectIfCodeUpload(doc);
  return doc;
}

export async function pushBrowserVisitToCloud(
  userId: string,
  visit: BrowserVisit,
): Promise<void> {
  if (!isFirebaseConfigured() || !userId.trim()) return;
  const payload = visitToCloudDoc(visit, userId);
  const db = getFirebaseDb();
  await setDoc(doc(db, CLOUD_COLLECTIONS.browserVisits, payload.id), payload, {
    merge: true,
  });
}

export async function listCloudBrowserVisits(
  userId: string,
  max = BROWSER_HISTORY_MAX,
): Promise<BrowserVisit[]> {
  if (!isFirebaseConfigured() || !userId.trim()) return [];
  const db = getFirebaseDb();
  // Filter by userId only (auto single-field index); sort client-side.
  const q = query(
    collection(db, CLOUD_COLLECTIONS.browserVisits),
    where("userId", "==", userId),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => {
      const data = d.data() as Partial<CloudBrowserVisitDoc>;
      return sanitizeBrowserVisitInput({
        id: data.id || d.id,
        url: data.url || "",
        title: data.title,
        visitedAt: data.visitedAt,
      });
    })
    .filter((v): v is BrowserVisit => Boolean(v))
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, Math.min(max, BROWSER_HISTORY_MAX));
}

export async function deleteCloudBrowserVisit(
  userId: string,
  visitId: string,
): Promise<void> {
  if (!isFirebaseConfigured() || !userId.trim() || !visitId.trim()) return;
  const db = getFirebaseDb();
  await deleteDoc(doc(db, CLOUD_COLLECTIONS.browserVisits, visitId));
}

/** Merge cloud + local by id/url, prefer newer visitedAt. */
export function mergeBrowserVisitLists(
  local: BrowserVisit[],
  cloud: BrowserVisit[],
): BrowserVisit[] {
  const byUrl = new Map<string, BrowserVisit>();
  for (const v of [...local, ...cloud]) {
    const key = normalizeBrowserUrl(v.url) || v.url;
    const prev = byUrl.get(key);
    if (!prev || v.visitedAt > prev.visitedAt) byUrl.set(key, { ...v, url: key });
  }
  return [...byUrl.values()]
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, BROWSER_HISTORY_MAX);
}
