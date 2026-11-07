import { invoke } from "@tauri-apps/api/core";
import { getWorkspaceCwd } from "./secure-storage";
import { hostMeta, type GitHostId } from "./git-hosts";
import { runWorkspaceCommand } from "./workspace-fs";

/** A copied host token, or nothing if the clipboard text is not one. */
export function tokenFromClipboard(
  text: string,
  host: GitHostId,
  explicit = false,
): string | null {
  const value = text.trim();
  if (!value || value.length > 300 || /\s/.test(value)) return null;
  if (host === "github") {
    return /^(ghp_|gho_|ghu_|github_pat_)[A-Za-z0-9_]{20,}$/.test(value) ? value : null;
  }
  if (host === "gitlab" || host === "other") {
    return /^(glpat-|gloas-|glptt-|gldt-)[A-Za-z0-9_-]{16,}$/.test(value) ? value : null;
  }
  if (!explicit) return null;
  return /^[A-Za-z0-9+/=._-]{20,}$/.test(value) ? value : null;
}

/** Page that signs the user in, then shows a token they can bring back. */
export function browserSignInUrl(host: GitHostId, baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/$/, "");
  if (host === "gitlab" && base && base !== "https://gitlab.com") {
    return `${base}/-/user_settings/personal_access_tokens?scopes=read_user,read_api,read_repository,write_repository`;
  }
  const preset = hostMeta(host).tokenUrl;
  if (preset) return preset;
  return /^https:\/\//i.test(base) ? base : "";
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("[exit")) ?? ""
  );
}

async function commandExists(name: string, cwd: string): Promise<boolean> {
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  const out = await runWorkspaceCommand(`command -v ${name}`, cwd);
  return out.trim().length > 0 && !out.includes("[exit ");
}

/**
 * Token already stored by the official host CLI (GitHub CLI or Azure CLI).
 * Those tools perform the browser login; Vigil only reads the session.
 */
/** Opens GitHub, waits for the confirmation, and returns the access token. */
export async function githubBrowserLogin(): Promise<string> {
  const token = (await invoke<string>("github_browser_login")).trim();
  if (!token || /[\s]/.test(token)) throw new Error("GitHub did not return a token");
  return token;
}

export async function existingCliToken(host: GitHostId): Promise<string | null> {
  let cwd = "";
  try {
    cwd = await getWorkspaceCwd();
  } catch {
    return null;
  }
  if (!cwd) return null;
  if (host === "github" && (await commandExists("gh", cwd))) {
    const out = await runWorkspaceCommand("gh auth token --hostname github.com", cwd);
    return tokenFromClipboard(firstLine(out), "github");
  }
  if (host === "azure" && (await commandExists("az", cwd))) {
    const out = await runWorkspaceCommand(
      "az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv",
      cwd,
    );
    const line = firstLine(out);
    return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(line) ? line : null;
  }
  return null;
}
