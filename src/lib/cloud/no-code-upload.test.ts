import { describe, expect, it } from "vitest";
import {
  assertNoCodeUpload,
  rejectIfCodeUpload,
} from "./no-code-upload";
import { planArtifactToCloudDoc } from "./plan-cloud";
import { createPlanArtifact } from "../plan-artifact";
import { CLOUD_COLLECTIONS } from "./collections";

describe("cloud no-code-upload guard", () => {
  it("allows clean plan payloads", () => {
    const plan = createPlanArtifact({
      goal: "Ship feature",
      steps: [{ content: "Edit src/a.ts", status: "pending" }],
      workspaceRoot: "/Users/me/proj",
    });
    const doc = planArtifactToCloudDoc(plan, "user-1");
    expect(assertNoCodeUpload(doc).ok).toBe(true);
    expect(doc.workspaceHint).toContain("proj");
    expect(doc).not.toHaveProperty("sourceTree");
  });

  it("rejects forbidden source keys", () => {
    const bad = {
      id: "x",
      userId: "u",
      sourceTree: { "src/a.ts": "secret" },
    };
    expect(assertNoCodeUpload(bad).ok).toBe(false);
    expect(() => rejectIfCodeUpload(bad)).toThrow(/Refusing cloud write/);
  });

  it("exports stable collection names", () => {
    expect(CLOUD_COLLECTIONS.plans).toBe("plans");
    expect(CLOUD_COLLECTIONS.chats).toBe("chats");
  });
});
