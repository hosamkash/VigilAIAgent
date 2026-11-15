import { describe, expect, it } from "vitest";
import {
  analyzeCookies,
  analyzeSecurityHeaders,
  runPassiveScan,
} from "./secure-passive.mjs";
import { explainFinding } from "./secure-education.mjs";

describe("secure-passive", () => {
  it("flags missing security headers", () => {
    const headers = new Headers({ "content-type": "text/html" });
    const findings = analyzeSecurityHeaders(headers);
    const cats = findings.map((f) => f.category);
    expect(cats).toContain("missing_csp");
    expect(cats).toContain("missing_xfo");
    expect(cats).toContain("missing_xcto");
  });

  it("accepts CSP frame-ancestors instead of XFO", () => {
    const headers = new Headers({
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "strict-transport-security": "max-age=31536000",
      "referrer-policy": "no-referrer",
    });
    const findings = analyzeSecurityHeaders(headers);
    expect(findings.some((f) => f.category === "missing_xfo")).toBe(false);
    expect(findings.some((f) => f.category === "missing_csp")).toBe(false);
  });

  it("flags weak cookie flags", () => {
    const findings = analyzeCookies(["session=abc; Path=/"]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].category).toBe("cookie_flags");
  });

  it("explains findings in AR/EN", () => {
    expect(explainFinding("missing_csp", "en").title).toMatch(/Content-Security/i);
    expect(explainFinding("missing_csp", "ar").title).toMatch(/Content-Security|سياسة/i);
  });

  it("hard-fails unauthorized remote URL before fetch", async () => {
    let fetched = false;
    const out = await runPassiveScan({
      url: "https://not-allowed.example",
      workspaceRoot: "",
      allowHosts: [],
      fetchImpl: async () => {
        fetched = true;
        return new Response("ok");
      },
    });
    expect(out.ok).toBe(false);
    expect(fetched).toBe(false);
    expect(out.error).toMatch(/not authorized/i);
  });

  it("runs passive pack on authorized localhost with mock fetch", async () => {
    const out = await runPassiveScan({
      url: "http://localhost:5173",
      workspaceRoot: "",
      allowHosts: [],
      fetchImpl: async () =>
        new Response("<html></html>", {
          status: 200,
          headers: {
            "content-type": "text/html",
            "set-cookie": "sid=1; Path=/",
          },
        }),
    });
    expect(out.ok).toBe(true);
    expect(out.pack).toBe("passive");
    expect(out.findings.length).toBeGreaterThan(0);
    expect(out.summary.total).toBe(out.findings.length);
  });
});
