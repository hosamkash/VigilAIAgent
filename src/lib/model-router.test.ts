import { describe, expect, it } from "vitest";
import { inferTaskComplexity, routeTask, toClineProviderId } from "./model-router";

describe("model-router", () => {
  it("routes Auto quick prompts to Gemini 3.8 Flash", () => {
    const routed = routeTask({
      prompt: "quick list files in src",
      preferredProvider: "auto",
    });
    expect(routed.tier).toBe("fast");
    expect(routed.providerId).toBe("gemini");
    expect(routed.clineProviderId).toBe("gemini");
    expect(routed.modelId).toBe("gemini-3.8-flash");
  });

  it("uses the model picked in chat", () => {
    const routed = routeTask({
      prompt: "quick list files in src",
      pinnedModelId: "gpt-4o",
    });
    expect(routed.providerId).toBe("openai");
    expect(routed.modelId).toBe("gpt-4o");
  });

  it("routes complex prompts to the chosen provider", () => {
    const routed = routeTask({
      prompt: "Please refactor the architecture and migrate the auth module",
      preferredProvider: "anthropic",
    });
    expect(routed.tier).toBe("smart");
    expect(routed.providerId).toBe("anthropic");
    expect(routed.clineProviderId).toBe("anthropic");
    expect(routed.modelId).toBe("claude-3-5-sonnet-latest");
  });

  it("infers smart for long prompts", () => {
    expect(inferTaskComplexity("x".repeat(900))).toBe("smart");
  });

  it("maps openai preference to Cline openai-native id", () => {
    expect(toClineProviderId("openai")).toBe("openai-native");
    expect(toClineProviderId("gemini")).toBe("gemini");
  });

  it("routes Auto coding prompts to a Gemini model Google still serves", () => {
    const routed = routeTask({
      prompt: "Please refactor the architecture and migrate the auth module",
      preferredProvider: "auto",
    });
    expect(routed.tier).toBe("smart");
    expect(routed.modelId).toBe("gemini-3.1-pro-preview");
  });

  it("rewrites the retired gemini-3.8-pro id", () => {
    const routed = routeTask({
      prompt: "fix login",
      pinnedModelId: "gemini-3.8-pro",
    });
    expect(routed.modelId).toBe("gemini-3.1-pro-preview");
  });
});
