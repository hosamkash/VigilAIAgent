import { describe, expect, it } from "vitest";
import {
  getVigilWebUrlFromEnv,
  isCloudEmbedHref,
  isLoopbackHttpUrl,
  resolveVigilWebUrl,
  vigilWebEmbedUrl,
} from "./vigil-web-url";

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

describe("isCloudEmbedHref", () => {
  it("matches embed auth URLs", () => {
    expect(
      isCloudEmbedHref("http://127.0.0.1:3000/embed/auth?embed=1&next=%2Fapp"),
    ).toBe(true);
    expect(isCloudEmbedHref("http://127.0.0.1:3000/app")).toBe(false);
  });
});

describe("getVigilWebUrlFromEnv", () => {
  it("returns a string (env or local DEV default)", () => {
    expect(typeof getVigilWebUrlFromEnv()).toBe("string");
  });
});

describe("resolveVigilWebUrl", () => {
  it("replaces leftover localhost Settings with production env", () => {
    expect(isLoopbackHttpUrl("http://127.0.0.1:3000")).toBe(true);
    expect(
      resolveVigilWebUrl(
        "http://127.0.0.1:3000",
        "https://agent.vigilhub.app",
      ),
    ).toBe("https://agent.vigilhub.app");
  });

  it("keeps a non-loopback Settings override", () => {
    expect(
      resolveVigilWebUrl(
        "https://preview.example.com",
        "https://agent.vigilhub.app",
      ),
    ).toBe("https://preview.example.com");
  });
});
