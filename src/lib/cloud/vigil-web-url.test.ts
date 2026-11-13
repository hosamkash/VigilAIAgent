import { describe, expect, it } from "vitest";
import { getVigilWebUrlFromEnv, vigilWebEmbedUrl } from "./vigil-web-url";

describe("vigilWebEmbedUrl", () => {
  it("opens embed auth bridge with embed=1", () => {
    const out = vigilWebEmbedUrl("https://app.example.com/");
    expect(out).toContain("/embed/auth");
    expect(out).toContain("embed=1");
    expect(out).toContain("next=");
  });

  it("routes any base into auth bridge (not raw path)", () => {
    const out = vigilWebEmbedUrl("https://app.example.com/plans/1");
    expect(out).toContain("/embed/auth");
    expect(out).not.toContain("/plans/1");
  });

  it("returns empty for blank", () => {
    expect(vigilWebEmbedUrl("")).toBe("");
  });

  it("accepts a custom next path for plan deep link", () => {
    const out = vigilWebEmbedUrl(
      "https://app.example.com",
      "/app/plans/abc",
    );
    expect(out).toContain("/embed/auth");
    expect(decodeURIComponent(out)).toContain("/app/plans/abc");
  });
});

describe("getVigilWebUrlFromEnv", () => {
  it("returns a string (env or local DEV default)", () => {
    expect(typeof getVigilWebUrlFromEnv()).toBe("string");
  });
});
