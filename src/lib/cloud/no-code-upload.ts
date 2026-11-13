/**
 * Hard guardrail: never upload workspace source / git / deep index to Firestore.
 */

import { CLOUD_FORBIDDEN_PAYLOAD_KEYS } from "./types";

export type CodeUploadScanResult = {
  ok: boolean;
  hits: string[];
};

function walk(value: unknown, path: string, hits: string[]): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, hits));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? `${path}.${key}` : key;
    if (
      CLOUD_FORBIDDEN_PAYLOAD_KEYS.includes(
        key as (typeof CLOUD_FORBIDDEN_PAYLOAD_KEYS)[number],
      )
    ) {
      hits.push(next);
    }
    // Heuristic: huge string fields that look like full file dumps
    if (
      typeof child === "string" &&
      child.length > 200_000 &&
      (key === "content" || key === "body" || key === "source")
    ) {
      hits.push(`${next} (oversized)`);
    }
    walk(child, next, hits);
  }
}

/** Returns ok:false if the payload appears to contain repo/source material. */
export function assertNoCodeUpload(payload: unknown): CodeUploadScanResult {
  const hits: string[] = [];
  walk(payload, "", hits);
  return { ok: hits.length === 0, hits };
}

export function rejectIfCodeUpload(payload: unknown): void {
  const result = assertNoCodeUpload(payload);
  if (!result.ok) {
    throw new Error(
      `Refusing cloud write: forbidden source fields (${result.hits.join(", ")})`,
    );
  }
}
