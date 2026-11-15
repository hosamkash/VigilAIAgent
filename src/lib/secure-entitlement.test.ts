import { describe, expect, it } from "vitest";
import {
  resolveSecureEntitlement,
  SECURE_FEATURE_KEY,
} from "./secure-entitlement";

describe("secure-entitlement", () => {
  it("allows passive for free builders", () => {
    const e = resolveSecureEntitlement({ planTier: "free", signedIn: true });
    expect(e.passive).toBe(true);
    expect(e.active).toBe(false);
    expect(e.report).toBe(false);
  });

  it("blocks suspended accounts", () => {
    const e = resolveSecureEntitlement({ planTier: "suspended" });
    expect(e.passive).toBe(false);
  });

  it("unlocks active/report with feature.vigilSecure", () => {
    const e = resolveSecureEntitlement({
      planTier: "paid",
      entitlements: [SECURE_FEATURE_KEY],
    });
    expect(e.passive).toBe(true);
    expect(e.active).toBe(true);
    expect(e.report).toBe(true);
  });

  it("partner tier unlocks active/report", () => {
    const e = resolveSecureEntitlement({ planTier: "partner" });
    expect(e.active).toBe(true);
    expect(e.report).toBe(true);
  });

  it("allows active on local targets without SKU", () => {
    const e = resolveSecureEntitlement({
      planTier: "free",
      localTarget: true,
    });
    expect(e.active).toBe(true);
    expect(e.report).toBe(true);
  });
});

