import { describe, expect, it } from "vitest";
import {
  parseGitRemoteUrl,
  remoteBranchUrl,
  remotePullRequestUrl,
} from "./git-remote-web";

describe("parseGitRemoteUrl", () => {
  it("parses GitHub HTTPS and SSH", () => {
    const https = parseGitRemoteUrl("https://github.com/acme/vigil.git");
    expect(https).toMatchObject({
      kind: "github",
      owner: "acme",
      repo: "vigil",
      webBase: "https://github.com/acme/vigil",
    });

    const ssh = parseGitRemoteUrl("git@github.com:acme/vigil.git");
    expect(ssh?.webBase).toBe("https://github.com/acme/vigil");
  });

  it("parses GitLab nested groups", () => {
    const remote = parseGitRemoteUrl("git@gitlab.com:group/sub/repo.git");
    expect(remote).toMatchObject({
      kind: "gitlab",
      owner: "group/sub",
      repo: "repo",
      webBase: "https://gitlab.com/group/sub/repo",
    });
  });

  it("parses Azure DevOps HTTPS and SSH", () => {
    const https = parseGitRemoteUrl(
      "https://dev.azure.com/org/project/_git/repo",
    );
    expect(https).toMatchObject({
      kind: "azure",
      webBase: "https://dev.azure.com/org/project/_git/repo",
    });

    const ssh = parseGitRemoteUrl("git@ssh.dev.azure.com:v3/org/project/repo");
    expect(ssh?.webBase).toBe("https://dev.azure.com/org/project/_git/repo");
  });
});

describe("remotePullRequestUrl", () => {
  it("builds GitHub pull/new for the current branch", () => {
    const remote = parseGitRemoteUrl("https://github.com/acme/vigil.git")!;
    expect(remotePullRequestUrl(remote, "feat/login")).toBe(
      "https://github.com/acme/vigil/pull/new/feat%2Flogin",
    );
  });

  it("builds a branch browse URL as fallback", () => {
    const remote = parseGitRemoteUrl("https://example.com/acme/vigil.git")!;
    expect(remoteBranchUrl(remote, "main")).toBe(
      "https://example.com/acme/vigil/tree/main",
    );
  });
});
