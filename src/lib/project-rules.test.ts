import { describe, expect, it } from "vitest";
import {
  PROJECT_RULES_REL,
  PROJECT_RULES_TEMPLATE,
  formatProjectRulesForAgent,
  projectRulesPath,
} from "./project-rules";

describe("projectRulesPath", () => {
  it("joins under .vigil/rules.md", () => {
    expect(projectRulesPath("/tmp/proj/")).toBe(`/tmp/proj/${PROJECT_RULES_REL}`);
  });
});

describe("formatProjectRulesForAgent", () => {
  it("skips empty and the default template", () => {
    expect(formatProjectRulesForAgent("")).toBe("");
    expect(formatProjectRulesForAgent(PROJECT_RULES_TEMPLATE)).toBe("");
  });

  it("wraps custom rules for the agent", () => {
    const out = formatProjectRulesForAgent("Always use TypeScript.");
    expect(out).toContain(PROJECT_RULES_REL);
    expect(out).toContain("Always use TypeScript.");
  });
});
