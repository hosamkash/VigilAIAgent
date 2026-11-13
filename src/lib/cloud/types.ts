/**
 * Shared Firestore document contracts for Vigil Cloud Bridge.
 * Portable to Vigil Web — keep fields sync-safe (no workspace source).
 */

import type { PlanArtifact } from "../plan-artifact";

export type PlanTier = "free" | "trial" | "paid" | "partner" | "suspended";

export type CloudUserDoc = {
  uid: string;
  email: string | null;
  displayName: string | null;
  planTier: PlanTier;
  createdAt: number;
  updatedAt: number;
  preferredLanguage?: "ar" | "en";
  defaultModel?: string;
};

export type CloudChatDoc = {
  id: string;
  userId: string;
  /** Mirror of userId for web continuum / legacy queries. */
  uid?: string;
  title: string;
  projectId?: string | null;
  createdAt: number;
  updatedAt: number;
  /** Explicit ms fields for web `iso()` / sorting when Timestamp missing. */
  createdAtMs?: number;
  updatedAtMs?: number;
  archived?: boolean;
  starred?: boolean;
  /** Never store workspace file trees here. */
  linkedWorkspaceHint?: string | null;
};

export type CloudMessageDoc = {
  id: string;
  chatId: string;
  userId: string;
  uid?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  createdAtMs?: number;
  model?: string | null;
  /** Optional small excerpts the user pinned — not repo dumps. */
  pinnedExcerpt?: string | null;
};

/** Cloud-safe plan: portable Plan Mode artifact without local-only blobs. */
export type CloudPlanDoc = {
  id: string;
  userId: string;
  chatId?: string | null;
  projectId?: string | null;
  title: string;
  goal: string;
  status: PlanArtifact["status"];
  createdAt: number;
  updatedAt: number;
  assumptions?: string[];
  risks?: string[];
  steps: PlanArtifact["steps"];
  execution?: PlanArtifact["execution"];
  archivedAt?: number | null;
  /** Display-only workspace name/path hint — never file contents. */
  workspaceHint?: string | null;
};

export type CloudWalletDoc = {
  userId: string;
  balanceTokens: number;
  currency?: string;
  updatedAt: number;
};

export type CloudPackageDoc = {
  id: string;
  name: string;
  price: number;
  currency: string;
  tokenAllowance: number;
  periodDays: number;
  entitlements: string[];
  partner?: boolean;
  active: boolean;
};

export type CloudUsageEventDoc = {
  id: string;
  userId: string;
  surface: "web" | "desktop";
  deviceId?: string | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  cost?: number;
  createdAt: number;
};

/** Forbidden keys that must never appear on cloud-bound payloads. */
export const CLOUD_FORBIDDEN_PAYLOAD_KEYS = [
  "sourceTree",
  "gitObjects",
  "codeIndex",
  "fileContents",
  "workspaceFiles",
  "deepIndex",
  "repoZip",
  "binaryBlob",
] as const;
