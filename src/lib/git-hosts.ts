import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { runWorkspaceCommand } from "./workspace-fs";

export type GitHostId = "github" | "gitlab" | "azure" | "other";

export interface GitHostProfile {
  host: GitHostId;
  baseUrl: string;
  login: string;
  credentialUser: string;
  credentialHost: string;
}

export interface RemoteRepo {
  name: string;
  fullName: string;
  cloneUrl: string;
}

export const GIT_HOSTS: {
  id: GitHostId;
  label: string;
  defaultBase: string;
  tokenUrl: string;
  hint: string;
  credentialUser: string;
}[] = [
  {
    id: "github",
    label: "GitHub",
    defaultBase: "https://github.com",
    tokenUrl: "https://github.com/settings/tokens/new?scopes=repo,read:user&description=Vigil",
    hint: "Classic token with the repo scope.",
    credentialUser: "x-access-token",
  },
  {
    id: "gitlab",
    label: "GitLab",
    defaultBase: "https://gitlab.com",
    tokenUrl:
      "https://gitlab.com/-/user_settings/personal_access_tokens?scopes=read_user,read_api,read_repository,write_repository",
    hint: "Token with read_user, read_repository, and write_repository.",
    credentialUser: "oauth2",
  },
  {
    id: "azure",
    label: "Azure DevOps",
    defaultBase: "https://dev.azure.com/",
    tokenUrl: "https://dev.azure.com/",
    hint: "Organization URL, then a PAT with Code Read & write.",
    credentialUser: "pat",
  },
  {
    id: "other",
    label: "Other Git host",
    defaultBase: "",
    tokenUrl: "",
    hint: "HTTPS host that speaks the GitHub or GitLab API.",
    credentialUser: "oauth2",
  },
];

export function hostMeta(id: GitHostId) {
  return GIT_HOSTS.find((host) => host.id === id) ?? GIT_HOSTS[0]!;
}

/** Azure DevOps accepts a PAT as Basic auth, or a browser login JWT as Bearer. */
export function azureAuthorization(token: string): string {
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return `Bearer ${token}`;
  }
  return `Basic ${btoa(`:${token}`)}`;
}

export function credentialHostFromBase(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").split("/")[0] ?? baseUrl;
  }
}

export function repoFolderName(cloneUrl: string): string {
  const tail = cloneUrl
    .trim()
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .pop();
  const name = (tail || "repository").replace(/[^A-Za-z0-9._-]/g, "-");
  return name.replace(/^-|-$/g, "") || "repository";
}

export function safeProjectName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\w.\- ]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(0, 80) || "project";
}

export function isGitAuthFailure(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return (
    /\b401\b/.test(text) ||
    /\b403\b/.test(text) ||
    /bad credentials/i.test(text) ||
    /requires authentication/i.test(text) ||
    /invalid.*(token|credential)/i.test(text) ||
    /token.*(expired|revoked|invalid)/i.test(text) ||
    /sign-?in expired/i.test(text) ||
    /was revoked/i.test(text)
  );
}

function friendlyHttpError(status: number, body: string): string {
  let message = "";
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (typeof parsed.message === "string") message = parsed.message.trim();
  } catch {
    message = body.trim().slice(0, 180);
  }
  if (status === 401 || /bad credentials/i.test(message)) {
    return "GitHub sign-in expired or was revoked. Sign in again.";
  }
  if (status === 403) {
    return message || "Access denied by the Git host.";
  }
  return message || `Request failed (${status})`;
}

async function http(url: string, headers: Record<string, string>): Promise<unknown> {
  const init = { method: "GET", headers };
  let response: Response;
  try {
    response = await tauriFetch(url, init);
  } catch {
    response = await fetch(url, init);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(friendlyHttpError(response.status, text));
  }
  return text ? JSON.parse(text) : {};
}

export async function verifyGitHost(
  host: GitHostId,
  baseUrl: string,
  token: string,
): Promise<{ login: string }> {
  const base = baseUrl.trim().replace(/\/$/, "");
  if (host === "github") {
    const data = (await http("https://api.github.com/user", {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Vigil",
    })) as { login?: string };
    if (!data.login) throw new Error("GitHub did not return a username");
    return { login: data.login };
  }
  if (host === "gitlab" || host === "other") {
    try {
      const data = (await http(`${base}/api/v4/user`, {
        "PRIVATE-TOKEN": token,
      })) as { username?: string };
      if (data.username) return { login: data.username };
    } catch (err) {
      if (host === "gitlab") throw err;
    }
    const api = base.includes("/api/") ? base : `${base}/api/v3`;
    const data = (await http(`${api}/user`, {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Vigil",
    })) as { login?: string };
    if (!data.login) throw new Error("Could not sign in to this host");
    return { login: data.login };
  }
  const data = (await http(`${base}/_apis/connectionData`, {
    Authorization: azureAuthorization(token),
  })) as { authenticatedUser?: { providerDisplayName?: string; customDisplayName?: string } };
  const login =
    data.authenticatedUser?.customDisplayName ||
    data.authenticatedUser?.providerDisplayName ||
    "Azure DevOps";
  return { login };
}

export async function listHostRepos(
  host: GitHostId,
  baseUrl: string,
  token: string,
): Promise<RemoteRepo[]> {
  const base = baseUrl.trim().replace(/\/$/, "");
  if (host === "github") {
    const data = (await http(
      "https://api.github.com/user/repos?per_page=50&sort=updated&affiliation=owner,collaborator,organization_member",
      {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Vigil",
      },
    )) as { name?: string; full_name?: string; clone_url?: string }[];
    return data
      .filter((repo) => repo.clone_url && repo.name)
      .map((repo) => ({
        name: repo.name!,
        fullName: repo.full_name || repo.name!,
        cloneUrl: repo.clone_url!,
      }));
  }
  if (host === "other") {
    try {
      return await listGitlabRepos(base, token);
    } catch {
      const api = base.includes("/api/") ? base : `${base}/api/v3`;
      const data = (await http(`${api}/user/repos?per_page=50&sort=updated`, {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Vigil",
      })) as { name?: string; full_name?: string; clone_url?: string }[];
      return data
        .filter((repo) => repo.clone_url && repo.name)
        .map((repo) => ({
          name: repo.name!,
          fullName: repo.full_name || repo.name!,
          cloneUrl: repo.clone_url!,
        }));
    }
  }
  if (host === "azure") {
    const data = (await http(`${base}/_apis/git/repositories?api-version=7.1`, {
      Authorization: azureAuthorization(token),
    })) as {
      value?: { name?: string; remoteUrl?: string; project?: { name?: string } }[];
    };
    return (data.value ?? [])
      .filter((repo) => repo.remoteUrl && repo.name)
      .map((repo) => ({
        name: repo.name!,
        fullName: `${repo.project?.name ?? ""}/${repo.name}`.replace(/^\//, ""),
        cloneUrl: repo.remoteUrl!,
      }));
  }
  return listGitlabRepos(base, token);
}

async function listGitlabRepos(base: string, token: string): Promise<RemoteRepo[]> {
  const data = (await http(
    `${base}/api/v4/projects?membership=true&simple=true&per_page=50&order_by=last_activity_at`,
    { "PRIVATE-TOKEN": token },
  )) as { name?: string; path_with_namespace?: string; http_url_to_repo?: string }[];
  return data
    .filter((repo) => repo.http_url_to_repo && repo.name)
    .map((repo) => ({
      name: repo.name!,
      fullName: repo.path_with_namespace || repo.name!,
      cloneUrl: repo.http_url_to_repo!,
    }));
}

export async function listSavedGitHosts(): Promise<GitHostProfile[]> {
  return invoke<GitHostProfile[]>("list_git_hosts");
}

export async function saveGitHost(profile: GitHostProfile, token: string): Promise<void> {
  await invoke("save_git_host", {
    host: profile.host,
    token,
    baseUrl: profile.baseUrl,
    login: profile.login,
    credentialUser: profile.credentialUser,
    credentialHost: profile.credentialHost,
  });
}

export async function readGitToken(host: GitHostId): Promise<string> {
  return invoke<string>("get_git_token", { host });
}

export async function forgetGitHost(host: GitHostId): Promise<void> {
  await invoke("forget_git_host", { host });
}

/** Give the system Git credential store this HTTPS login, without writing it into the repo URL. */
export async function rememberHttpsCredential(
  cwd: string,
  host: string,
  username: string,
  secret: string,
): Promise<void> {
  if (/[\r\n]/.test(host) || /[\r\n]/.test(username) || /[\r\n]/.test(secret)) {
    throw new Error("Invalid credential");
  }
  const payload = `protocol=https\nhost=${host}\nusername=${username}\npassword=${secret}\n`;
  const b64 = btoa(unescape(encodeURIComponent(payload)));
  const out = await runWorkspaceCommand(
    `printf '%s' ${JSON.stringify(b64)} | base64 -d | git credential approve`,
    cwd,
  );
  if (/\[exit (?!0)\d+\]/.test(out)) {
    throw new Error(out.replace(/\n?\[exit -?\d+\]\s*$/, "").trim() || "Could not store Git credential");
  }
}
