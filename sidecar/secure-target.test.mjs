import { describe, expect, it } from "vitest";
import {
  assertAuthorizedTarget,
  hostAllowed,
  isLocalHostname,
  parseHttpUrl,
} from "./secure-target.mjs";

describe("secure-target", () => {
  it("recognizes local hostnames", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("example.com")).toBe(false);
  });

  it("parses URLs and adds scheme", () => {
    const p = parseHttpUrl("localhost:5173");
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.url.hostname).toBe("localhost");
      expect(p.url.port).toBe("5173");
    }
  });

  it("allows localhost without allowlist", () => {
    const r = assertAuthorizedTarget("http://127.0.0.1:3000/app", {
      allowHosts: [],
    });
    expect(r.ok).toBe(true);
  });

  it("blocks remote hosts not on allowlist", () => {
    const r = assertAuthorizedTarget("https://evil.example", { allowHosts: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not authorized/i);
  });

  it("allows remote when allowlisted or subdomain", () => {
    expect(hostAllowed("app.acme.test", ["acme.test"])).toBe(true);
    const r = assertAuthorizedTarget("https://app.acme.test/x", {
      allowHosts: ["acme.test"],
    });
    expect(r.ok).toBe(true);
  });

  it("allows preview host from previewUrl", () => {
    const r = assertAuthorizedTarget("http://192.168.1.10:5173", {
      allowHosts: [],
      previewUrl: "http://192.168.1.10:5173",
    });
    expect(r.ok).toBe(true);
  });
});
