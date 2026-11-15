/**
 * Vigil Secure entitlement stub (Phase A).
 * Passive Quick scan is available for signed-in free/trial/paid/partner
 * and offline/local builders. Active packs / reports later gate on
 * `feature.vigilSecure` from the attached package.
 */

import type { PlanTier } from "./cloud/types";

export const SECURE_FEATURE_KEY = "feature.vigilSecure";

export type SecureEntitlement = {
  /** Passive Quick pack (headers/cookies/deps/secrets). */
  passive: boolean;
  /** Active probes / ZAP / report export (Phase B/C). */
  active: boolean;
  /** Sellable Secure Report export. */
  report: boolean;
  reason: string;
  reasonAr: string;
};

/**
 * @param opts.planTier Cloud user tier when signed in
 * @param opts.entitlements Package entitlement strings (from subscription/package)
 * @param opts.signedIn Whether Firebase Auth session exists
 */
export function resolveSecureEntitlement(opts?: {
  planTier?: PlanTier | null;
  entitlements?: string[] | null;
  signedIn?: boolean;
  /** When true, Active Standard pack is allowed for localhost/preview builders. */
  localTarget?: boolean;
}): SecureEntitlement {
  const entitlements = (opts?.entitlements || []).map((e) =>
    String(e || "").trim(),
  );
  const hasSku = entitlements.includes(SECURE_FEATURE_KEY);
  const tier = opts?.planTier || null;
  const localTarget = opts?.localTarget === true;

  // Phase A: passive always on for builders (local or any non-suspended account).
  if (tier === "suspended") {
    return {
      passive: false,
      active: false,
      report: false,
      reason: "Account suspended — Secure scans disabled.",
      reasonAr: "الحساب موقوف — فحوصات Secure متوقفة.",
    };
  }

  const passive = true;
  // Active: SKU/partner, or localhost/preview builder assist (Phase B).
  const active = hasSku || tier === "partner" || localTarget;
  const report = hasSku || tier === "partner";

  if (hasSku || tier === "partner") {
    return {
      passive,
      active,
      report,
      reason: "Vigil Secure add-on enabled.",
      reasonAr: "إضافة Vigil Secure مفعّلة.",
    };
  }

  if (localTarget) {
    return {
      passive,
      active: true,
      report: true,
      reason:
        "Local/preview Active pack + report. Remote hosts need Vigil Secure add-on.",
      reasonAr:
        "الفحص النشط والتقرير متاحان على localhost/المعاينة. النطاقات البعيدة تحتاج إضافة Vigil Secure.",
    };
  }

  return {
    passive,
    active: false,
    report: false,
    reason:
      "Passive Quick scan included. Active on remote hosts & Secure Report need Vigil Secure add-on.",
    reasonAr:
      "الفحص السريع متاح. النشط على نطاقات بعيدة وتقرير Secure يحتاج إضافة Vigil Secure.",
  };
}

/** True when URL hostname is localhost / loopback. */
export function isLocalSecureTarget(url: string | null | undefined): boolean {
  if (!url) return true;
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;
    const h = new URL(withScheme).hostname.toLowerCase();
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h === "0.0.0.0"
    );
  } catch {
    return false;
  }
}
