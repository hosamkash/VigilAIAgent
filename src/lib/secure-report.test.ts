import { describe, expect, it } from "vitest";
import { buildSecureReportMarkdown } from "./secure-report";
import type { SecureScanResult } from "./secure-sidecar";

const scan: SecureScanResult = {
  ok: true,
  pack: "passive",
  target: "http://127.0.0.1:5173",
  scannedAt: 1,
  findings: [
    {
      id: "csp",
      severity: "medium",
      category: "headers",
      title: "Missing CSP",
      detail: "No Content-Security-Policy header.",
      education: {
        title: "CSP",
        what: "Browser policy",
        why: "XSS impact",
        fixHint: "Add CSP header",
      },
    },
  ],
  summary: {
    total: 1,
    critical: 0,
    high: 0,
    medium: 1,
    low: 0,
    info: 0,
  },
};

describe("secure report", () => {
  it("builds markdown with target and finding", () => {
    const md = buildSecureReportMarkdown(scan, "en");
    expect(md).toContain("Vigil Secure Report");
    expect(md).toContain("127.0.0.1");
    expect(md).toContain("Missing CSP");
    expect(md).toContain("Add CSP header");
  });

  it("builds Arabic report title", () => {
    expect(buildSecureReportMarkdown(scan, "ar")).toContain("تقرير Vigil Secure");
  });
});
