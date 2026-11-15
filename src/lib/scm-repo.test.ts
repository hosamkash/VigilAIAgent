import { describe, expect, it } from "vitest";
import {
  makeScmRepo,
  scmRepoColorFromPath,
  scmRepoDisplayName,
  scmRepoIdFromPath,
} from "./scm-repo";

describe("scm-repo identity", () => {
  it("is stable across calls for the same path", () => {
    const a = "/Users/me/Work/VigilAIAgent";
    const b = "/Users/me/Work/VigilAIAgent/";
    expect(scmRepoIdFromPath(a)).toBe(scmRepoIdFromPath(b));
    expect(scmRepoColorFromPath(a)).toBe(scmRepoColorFromPath(b));
  });

  it("gives different colors for sibling products", () => {
    const desk = scmRepoColorFromPath(
      "/Users/me/Work/VigilAIAgent",
    );
    const web = scmRepoColorFromPath(
      "/Users/me/Work/Vigil-AI-Agent-Web",
    );
    expect(desk).not.toBe(web);
  });

  it("uses folder basename as display name", () => {
    expect(scmRepoDisplayName("/tmp/Vigil-AI-Agent-Web")).toBe(
      "Vigil-AI-Agent-Web",
    );
  });

  it("makeScmRepo fills id/color/name", () => {
    const r = makeScmRepo("/proj/foo", { isPrimary: true });
    expect(r.id).toBe(scmRepoIdFromPath("/proj/foo"));
    expect(r.displayName).toBe("foo");
    expect(r.isPrimary).toBe(true);
    expect(r.color).toMatch(/^#/);
  });
});
