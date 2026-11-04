import { describe, expect, it } from "vitest";
import { inferTaskComplexity, routeTask, toClineProviderId } from "./model-router";

describe("model-router", () => {
  it("routes quick prompts to Gemini 3.8 Flash (MVP default)", () => {
    const routed = routeTask({
      prompt: "quick list files in src",
      preferredProvider: "openai",
    });
    expect(routed.tier).toBe("fast");
    expect(routed.providerId).toBe("gemini");
    expect(routed.clineProviderId).toBe("gemini");
    expect(routed.modelId).toBe("gemini-3.8-flash");
  });

  it("routes complex prompts to Gemini 3.8 Pro (MVP default)", () => {
    const routed = routeTask({
      prompt: "Please refactor the architecture and migrate the auth module",
      preferredProvider: "anthropic",
    });
    expect(routed.tier).toBe("smart");
    expect(routed.providerId).toBe("gemini");
    expect(routed.clineProviderId).toBe("gemini");
    expect(routed.modelId).toBe("gemini-3.8-pro");
  });

  it("infers smart for long prompts", () => {
    expect(inferTaskComplexity("x".repeat(900))).toBe("smart");
  });

  it("maps openai preference to Cline openai-native id", () => {
    expect(toClineProviderId("openai")).toBe("openai-native");
    expect(toClineProviderId("gemini")).toBe("gemini");
  });
});
