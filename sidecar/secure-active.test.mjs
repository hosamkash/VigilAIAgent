import { describe, expect, it } from "vitest";
import {
  findUnprotectedForms,
  looksLikeDirectoryListing,
  looksLikeStackTrace,
  looksLikeUnescapedReflection,
  runActiveScan,
} from "./secure-active.mjs";

describe("secure-active", () => {
  it("requires confirm=true", async () => {
    const out = await runActiveScan({
      url: "http://127.0.0.1:5173",
      confirm: false,
      fetchImpl: async () => new Response("ok"),
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/confirm/i);
  });

  it("hard-fails unauthorized remote hosts", async () => {
    let fetched = false;
    const out = await runActiveScan({
      url: "https://evil.example",
      confirm: true,
      allowHosts: [],
      fetchImpl: async () => {
        fetched = true;
        return new Response("nope");
      },
    });
    expect(out.ok).toBe(false);
    expect(fetched).toBe(false);
  });

  it("detects directory listing and CSRF forms", () => {
    expect(
      looksLikeDirectoryListing(
        "<html><title>Index of /</title>Parent Directory</html>",
        200,
      ),
    ).toBe(true);
    const forms = findUnprotectedForms(
      `<form method="post" action="/save"><input name="x"/></form>`,
    );
    expect(forms.length).toBe(1);
    expect(
      findUnprotectedForms(
        `<form method="post"><input name="csrf_token" value="a"/></form>`,
      ).length,
    ).toBe(0);
  });

  it("detects unescaped reflection and stack traces", () => {
    const probe = "<vigil-abc>";
    expect(looksLikeUnescapedReflection(`<p>${probe}</p>`, probe)).toBe(true);
    expect(
      looksLikeUnescapedReflection(`<p>${probe.replace("<", "&lt;")}</p>`, probe),
    ).toBe(false);
    expect(
      looksLikeStackTrace("Traceback (most recent call last):\n  File app.py"),
    ).toBe(true);
  });

  it("runs active pack on localhost with mock fetch", async () => {
    const out = await runActiveScan({
      url: "http://127.0.0.1:5173/",
      confirm: true,
      allowHosts: [],
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes(".env")) {
          return new Response("SECRET_KEY=abc123def456\n", { status: 200 });
        }
        if (href.includes(".git/HEAD")) {
          return new Response("ref: refs/heads/main\n", { status: 200 });
        }
        if (href.includes("admin")) {
          return new Response("<html><h1>Admin Panel</h1></html>", {
            status: 200,
          });
        }
        if (href.includes("vigil_probe") || href.includes("q=")) {
          const u = new URL(href);
          const q = u.searchParams.get("q") || "";
          return new Response(`<html><body>Hello ${q}</body></html>`, {
            status: 200,
          });
        }
        return new Response(
          `<html><form method="post" action="/x"><input name="a"/></form></html>`,
          { status: 200 },
        );
      },
    });
    expect(out.ok).toBe(true);
    expect(out.pack).toBe("active");
    const cats = out.findings.map((f) => f.category);
    expect(cats).toContain("sensitive_path");
    expect(cats).toContain("csrf_form");
    expect(cats).toContain("reflected_xss");
    expect(cats).toContain("open_admin");
  });
});
