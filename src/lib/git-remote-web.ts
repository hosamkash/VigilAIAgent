/** Turn a git remote URL into a browser page for the current branch / PR. */

export type GitRemoteKind = "github" | "gitlab" | "bitbucket" | "azure" | "other";

export type ParsedGitRemote = {
  host: string;
  owner: string;
  repo: string;
  webBase: string;
  kind: GitRemoteKind;
};

function detectKind(host: string): GitRemoteKind {
  const h = host.toLowerCase();
  if (h === "github.com" || h.endsWith(".github.com")) return "github";
  if (h === "gitlab.com" || h.includes("gitlab")) return "gitlab";
  if (h === "bitbucket.org" || h.includes("bitbucket")) return "bitbucket";
  if (
    h === "dev.azure.com" ||
    h.endsWith(".visualstudio.com") ||
    h === "ssh.dev.azure.com"
  ) {
    return "azure";
  }
  return "other";
}

function splitOwnerRepo(path: string): { owner: string; repo: string } | null {
  const parts = path
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) return null;
  const repo = parts.pop()!;
  const owner = parts.join("/");
  return { owner, repo };
}

/** Parse `git remote get-url` output into a browsable repo base. */
export function parseGitRemoteUrl(raw: string): ParsedGitRemote | null {
  const s = raw.trim();
  if (!s) return null;

  const scp = /^git@([^:]+):(.+)$/i.exec(s);
  if (scp) {
    const host = scp[1]!;
    let path = scp[2]!.replace(/\.git$/i, "").replace(/^\/+/, "");

    if (host === "ssh.dev.azure.com" && path.startsWith("v3/")) {
      const parts = path.slice(3).split("/").filter(Boolean);
      if (parts.length >= 3) {
        const [org, project, repo] = parts;
        return {
          host: "dev.azure.com",
          owner: `${org}/${project}`,
          repo: repo!,
          webBase: `https://dev.azure.com/${org}/${project}/_git/${repo}`,
          kind: "azure",
        };
      }
    }

    const split = splitOwnerRepo(path);
    if (!split) return null;
    return {
      host,
      owner: split.owner,
      repo: split.repo,
      webBase: `https://${host}/${split.owner}/${split.repo}`,
      kind: detectKind(host),
    };
  }

  let href = s;
  if (href.startsWith("ssh://")) {
    try {
      const u = new URL(href);
      const host = u.hostname;
      const path = u.pathname.replace(/^\/+/, "").replace(/\.git$/i, "");
      if (host === "ssh.dev.azure.com" && path.startsWith("v3/")) {
        const parts = path.slice(3).split("/").filter(Boolean);
        if (parts.length >= 3) {
          const [org, project, repo] = parts;
          return {
            host: "dev.azure.com",
            owner: `${org}/${project}`,
            repo: repo!,
            webBase: `https://dev.azure.com/${org}/${project}/_git/${repo}`,
            kind: "azure",
          };
        }
      }
      const split = splitOwnerRepo(path);
      if (!split) return null;
      return {
        host,
        owner: split.owner,
        repo: split.repo,
        webBase: `https://${host}/${split.owner}/${split.repo}`,
        kind: detectKind(host),
      };
    } catch {
      return null;
    }
  }

  if (!/^https?:\/\//i.test(href)) {
    href = `https://${href}`;
  }

  try {
    const u = new URL(href);
    const host = u.hostname;
    let pathname = u.pathname.replace(/\.git$/i, "").replace(/\/+$/, "");

    const azure = pathname.match(/^\/([^/]+)\/([^/]+)\/_git\/([^/]+)/);
    if (azure) {
      const [, org, project, repo] = azure;
      return {
        host,
        owner: `${org}/${project}`,
        repo: repo!,
        webBase: `https://${host}/${org}/${project}/_git/${repo}`,
        kind: "azure",
      };
    }

    // visualstudio.com: /DefaultCollection/project/_git/repo
    const vs = pathname.match(/^\/(?:[^/]+\/)?([^/]+)\/_git\/([^/]+)/);
    if (host.endsWith(".visualstudio.com") && vs) {
      const [, project, repo] = vs;
      return {
        host,
        owner: project!,
        repo: repo!,
        webBase: `${u.origin}${pathname}`,
        kind: "azure",
      };
    }

    const split = splitOwnerRepo(pathname);
    if (!split) return null;
    return {
      host,
      owner: split.owner,
      repo: split.repo,
      webBase: `${u.origin}/${split.owner}/${split.repo}`,
      kind: detectKind(host),
    };
  } catch {
    return null;
  }
}

/** Open a create-PR / create-MR page with the current branch as the source. */
export function remotePullRequestUrl(
  remote: ParsedGitRemote,
  branch: string,
): string {
  const encoded = encodeURIComponent(branch);
  switch (remote.kind) {
    case "github":
      return `${remote.webBase}/pull/new/${encoded}`;
    case "gitlab":
      return `${remote.webBase}/-/merge_requests/new?merge_request[source_branch]=${encoded}`;
    case "bitbucket":
      return `${remote.webBase}/pull-requests/new?source=${encoded}`;
    case "azure":
      return `${remote.webBase}/pullrequestcreate?sourceRef=${encoded}`;
    default:
      return remoteBranchUrl(remote, branch);
  }
}

/** Browse the branch on the host (fallback when PR URL isn't known). */
export function remoteBranchUrl(remote: ParsedGitRemote, branch: string): string {
  const encoded = encodeURIComponent(branch)
    .replace(/%2F/gi, "/")
    .replace(/%2f/g, "/");
  switch (remote.kind) {
    case "gitlab":
      return `${remote.webBase}/-/tree/${encoded}`;
    case "bitbucket":
      return `${remote.webBase}/src/${encoded}/`;
    case "azure":
      return `${remote.webBase}?version=GB${encodeURIComponent(branch)}`;
    case "github":
    default:
      return `${remote.webBase}/tree/${encoded}`;
  }
}

export function remoteHostLabel(kind: GitRemoteKind): string {
  switch (kind) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    case "azure":
      return "Azure DevOps";
    default:
      return "remote";
  }
}

export function buildRemotePageUrl(
  remoteUrl: string,
  branch: string,
  mode: "pr" | "branch",
): { href: string; hostLabel: string; kind: GitRemoteKind } {
  const parsed = parseGitRemoteUrl(remoteUrl);
  if (!parsed) {
    throw new Error(`Could not parse remote URL: ${remoteUrl}`);
  }
  const href =
    mode === "pr"
      ? remotePullRequestUrl(parsed, branch)
      : remoteBranchUrl(parsed, branch);
  return {
    href,
    hostLabel: remoteHostLabel(parsed.kind),
    kind: parsed.kind,
  };
}
