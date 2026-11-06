import { describe, expect, it } from "vitest";
import { browserSignInUrl, tokenFromClipboard } from "./git-oauth";
import {
  azureAuthorization,
  credentialHostFromBase,
  repoFolderName,
  safeProjectName,
} from "./git-hosts";

describe("git host helpers", () => {
  it("reads the host from an organization URL", () => {
    expect(credentialHostFromBase("https://dev.azure.com/contoso")).toBe(
      "dev.azure.com",
    );
    expect(credentialHostFromBase("https://gitlab.example.com/group")).toBe(
      "gitlab.example.com",
    );
  });

  it("names a clone folder from the repository URL", () => {
    expect(repoFolderName("https://github.com/acme/vigil.git")).toBe("vigil");
    expect(repoFolderName("git@gitlab.com:acme/my-app.git")).toBe("my-app");
  });

  it("turns a project title into a folder name", () => {
    expect(safeProjectName("Vigil Radiology")).toBe("Vigil-Radiology");
  });

  it("accepts a copied host token and ignores other clipboard text", () => {
    const classic = `ghp_${"a".repeat(36)}`;
    expect(tokenFromClipboard(`  ${classic}\n`, "github")).toBe(classic);
    expect(tokenFromClipboard("github_pat_11AAAAAAA_bbbbbbbbbbbbbbbb", "github")).toMatch(
      /^github_pat_/,
    );
    expect(tokenFromClipboard("my github password", "github")).toBeNull();
    expect(tokenFromClipboard("glpat-abcdefghijklmnop", "gitlab")).toMatch(/^glpat-/);
    expect(tokenFromClipboard("not-a-token", "azure")).toBeNull();
    expect(tokenFromClipboard("A".repeat(52), "azure", true)?.length).toBe(52);
  });

  it("opens the host sign-in page", () => {
    expect(browserSignInUrl("github", "https://github.com")).toContain("github.com/settings/tokens");
    expect(browserSignInUrl("gitlab", "https://gitlab.example.com")).toBe(
      "https://gitlab.example.com/-/user_settings/personal_access_tokens?scopes=read_user,read_api,read_repository,write_repository",
    );
    expect(browserSignInUrl("other", "https://git.example.com")).toBe("https://git.example.com");
  });

  it("sends an Azure browser token as Bearer", () => {
    expect(azureAuthorization("header.payload.sig")).toBe("Bearer header.payload.sig");
    expect(azureAuthorization("personal-token")).toMatch(/^Basic /);
  });
});
