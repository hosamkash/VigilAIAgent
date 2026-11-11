/** In-app PR/MR create + CI status via host APIs (GitHub / GitLab first). */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { parseGitRemoteUrl, type ParsedGitRemote } from "./git-remote-web";
import {
  listSavedGitHosts,
  readGitToken,
  type GitHostId,
} from "./git-hosts";
import {
  fetchGitStatus,
  gitGetRemoteUrl,
  gitPreferredRemoteName,
} from "./git";

export type PullRequestDraft = {
  title: string;
  body?: string;
  draft?: boolean;
  base?: string;
  head?: string;
};

export type CreatedPullRequest = {
  number: number;
  url: string;
  title: string;
  draft: boolean;
  host: "github" | "gitlab";
};

export type CiCheck = {
  name: string;
  status: "queued" | "in_progress" | "completed" | "unknown";
  conclusion: string | null;
  url?: string;
};

export type CiStatusSummary = {
  state: "pending" | "success" | "failure" | "unknown";
  checks: CiCheck[];
  prNumber?: number;
  prUrl?: string;
};

async function http(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit,
): Promise<unknown> {
  const request: RequestInit = {
    ...init,
    headers: { ...(init?.headers as Record<string, string>), ...headers },
  };
  let response: Response;
  try {
    response = await tauriFetch(url, request);
  } catch {
    response = await fetch(url, request);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

function hostIdForRemote(remote: ParsedGitRemote): GitHostId | null {
  if (remote.kind === "github") return "github";
  if (remote.kind === "gitlab") return "gitlab";
  return null;
}

async function resolveToken(remote: ParsedGitRemote): Promise<string> {
  const hostId = hostIdForRemote(remote);
  if (!hostId) {
    throw new Error(`PR API not supported for ${remote.kind} yet — use the web PR page`);
  }
  const saved = await listSavedGitHosts();
  const profile = saved.find((p) => p.host === hostId);
  if (!profile) {
    throw new Error(`No saved ${hostId} credentials — add them in Start / Git hosts`);
  }
  return readGitToken(hostId);
}

export async function resolveWorkspaceRemote(
  cwd: string,
): Promise<{ remote: ParsedGitRemote; branch: string; remoteUrl: string }> {
  const status = await fetchGitStatus(cwd);
  const branch = status.branch?.trim();
  if (!branch || branch === "HEAD") {
    throw new Error("Checkout a named branch before creating a PR");
  }
  const preferred = gitPreferredRemoteName(status.upstream);
  let remoteUrl = await gitGetRemoteUrl(cwd, preferred);
  if (!remoteUrl && preferred !== "origin") {
    remoteUrl = await gitGetRemoteUrl(cwd, "origin");
  }
  if (!remoteUrl) throw new Error("No remote URL found — add origin first");
  const remote = parseGitRemoteUrl(remoteUrl);
  if (!remote) throw new Error(`Could not parse remote URL: ${remoteUrl}`);
  return { remote, branch, remoteUrl };
}

export async function createPullRequest(
  cwd: string,
  draft: PullRequestDraft,
): Promise<CreatedPullRequest> {
  const { remote, branch } = await resolveWorkspaceRemote(cwd);
  const token = await resolveToken(remote);
  const title = draft.title.trim();
  if (!title) throw new Error("PR title is required");
  const head = draft.head?.trim() || branch;
  const base = draft.base?.trim() || "main";
  const body = draft.body?.trim() || "";
  const isDraft = draft.draft !== false;

  if (remote.kind === "github") {
    const data = (await http(
      `https://api.github.com/repos/${remote.owner}/${remote.repo}/pulls`,
      {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Vigil",
        "Content-Type": "application/json",
      },
      {
        method: "POST",
        body: JSON.stringify({
          title,
          head,
          base,
          body,
          draft: isDraft,
        }),
      },
    )) as { number?: number; html_url?: string; title?: string; draft?: boolean };
    if (!data.number || !data.html_url) {
      throw new Error("GitHub did not return a pull request");
    }
    return {
      number: data.number,
      url: data.html_url,
      title: data.title || title,
      draft: !!data.draft,
      host: "github",
    };
  }

  if (remote.kind === "gitlab") {
    const project = encodeURIComponent(`${remote.owner}/${remote.repo}`);
    const apiBase = `https://${remote.host}/api/v4`;
    const data = (await http(
      `${apiBase}/projects/${project}/merge_requests`,
      {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
      {
        method: "POST",
        body: JSON.stringify({
          title,
          source_branch: head,
          target_branch: base,
          description: body,
          draft: isDraft,
        }),
      },
    )) as { iid?: number; web_url?: string; title?: string; draft?: boolean };
    if (!data.iid || !data.web_url) {
      throw new Error("GitLab did not return a merge request");
    }
    return {
      number: data.iid,
      url: data.web_url,
      title: data.title || title,
      draft: !!data.draft,
      host: "gitlab",
    };
  }

  throw new Error(`PR API not supported for ${remote.kind}`);
}

export async function fetchCiStatus(cwd: string): Promise<CiStatusSummary> {
  const { remote, branch } = await resolveWorkspaceRemote(cwd);
  const token = await resolveToken(remote);

  if (remote.kind === "github") {
    const pulls = (await http(
      `https://api.github.com/repos/${remote.owner}/${remote.repo}/pulls?head=${encodeURIComponent(`${remote.owner}:${branch}`)}&state=open`,
      {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Vigil",
      },
    )) as { number?: number; html_url?: string; head?: { sha?: string } }[];
    const pr = pulls[0];
    if (!pr?.number || !pr.head?.sha) {
      return { state: "unknown", checks: [] };
    }
    const checksPayload = (await http(
      `https://api.github.com/repos/${remote.owner}/${remote.repo}/commits/${pr.head.sha}/check-runs`,
      {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Vigil",
      },
    )) as {
      check_runs?: {
        name?: string;
        status?: string;
        conclusion?: string | null;
        html_url?: string;
      }[];
    };
    const checks: CiCheck[] = (checksPayload.check_runs || []).map((run) => ({
      name: run.name || "check",
      status:
        run.status === "queued" ||
        run.status === "in_progress" ||
        run.status === "completed"
          ? run.status
          : "unknown",
      conclusion: run.conclusion ?? null,
      url: run.html_url,
    }));
    const failed = checks.some(
      (c) =>
        c.status === "completed" &&
        c.conclusion &&
        !["success", "neutral", "skipped"].includes(c.conclusion),
    );
    const pending = checks.some(
      (c) => c.status === "queued" || c.status === "in_progress",
    );
    return {
      state: failed ? "failure" : pending ? "pending" : checks.length ? "success" : "unknown",
      checks,
      prNumber: pr.number,
      prUrl: pr.html_url,
    };
  }

  if (remote.kind === "gitlab") {
    const project = encodeURIComponent(`${remote.owner}/${remote.repo}`);
    const apiBase = `https://${remote.host}/api/v4`;
    const mrs = (await http(
      `${apiBase}/projects/${project}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=opened`,
      { "PRIVATE-TOKEN": token },
    )) as { iid?: number; web_url?: string; head_pipeline?: { status?: string; web_url?: string } }[];
    const mr = mrs[0];
    if (!mr?.iid) return { state: "unknown", checks: [] };
    const pipeStatus = mr.head_pipeline?.status || "unknown";
    const state =
      pipeStatus === "success" || pipeStatus === "passed"
        ? "success"
        : pipeStatus === "failed" || pipeStatus === "canceled"
          ? "failure"
          : pipeStatus === "running" || pipeStatus === "pending"
            ? "pending"
            : "unknown";
    return {
      state,
      checks: [
        {
          name: "pipeline",
          status:
            state === "pending"
              ? "in_progress"
              : state === "unknown"
                ? "unknown"
                : "completed",
          conclusion: pipeStatus,
          url: mr.head_pipeline?.web_url || mr.web_url,
        },
      ],
      prNumber: mr.iid,
      prUrl: mr.web_url,
    };
  }

  return { state: "unknown", checks: [] };
}

export function formatCiStatusForAgent(summary: CiStatusSummary): string {
  const lines = [
    `CI state: ${summary.state}`,
    summary.prNumber ? `PR/MR: #${summary.prNumber} ${summary.prUrl || ""}` : "PR/MR: (none open for this branch)",
    "",
    ...summary.checks.map(
      (c) =>
        `- ${c.name}: ${c.status}${c.conclusion ? ` (${c.conclusion})` : ""}${c.url ? ` ${c.url}` : ""}`,
    ),
  ];
  if (summary.state === "failure") {
    lines.push(
      "",
      "Fix failing checks with apply_patch + run_commands, push, then re-check CI.",
    );
  }
  return lines.join("\n");
}
