import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  formatSupportTicketMarkdown,
  type SupportTicket,
} from "./support-ticket";
import type { TicketPlatformId } from "./ticket-platforms";
import { publishSupportTicketToAdo } from "./ado-settings";
import {
  loadTicketConnectSettings,
  type TicketConnectSettings,
} from "./ticket-connect-settings";
import { getTicketPat } from "./ticket-vault";

export type TicketPublishResult = {
  id: number | string;
  url: string;
  platformId: TicketPlatformId;
};

export function ticketIssuePayload(ticket: SupportTicket): {
  title: string;
  body: string;
} {
  return {
    title: ticket.title.trim() || "Untitled ticket",
    body: formatSupportTicketMarkdown(ticket),
  };
}

async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await tauriFetch(url, init);
  } catch {
    return fetch(url, init);
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Publish failed (${res.status}): ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Publish failed: invalid JSON (${text.slice(0, 200)})`);
  }
}

export async function publishTicketToPlatform(
  ticket: SupportTicket,
  platformId: TicketPlatformId,
): Promise<TicketPublishResult> {
  if (platformId === "azure-devops") {
    const result = await publishSupportTicketToAdo(ticket);
    return { id: result.id, url: result.url, platformId };
  }
  const settings = await loadTicketConnectSettings();
  const token = await resolveToken(platformId);
  if (platformId === "github") return publishGithub(ticket, settings, token);
  if (platformId === "gitlab") return publishGitlab(ticket, settings, token);
  if (platformId === "jira") return publishJira(ticket, settings, token);
  if (platformId === "linear") return publishLinear(ticket, settings, token);
  if (platformId === "clickup") return publishClickup(ticket, settings, token);
  throw new Error("Unknown ticket platform.");
}

async function resolveToken(platformId: TicketPlatformId): Promise<string> {
  try {
    const saved = await getTicketPat(platformId);
    if (saved.trim()) return saved.trim();
  } catch {
    /* none */
  }
  throw new Error("Connect this platform first (token / sign-in in Tickets → Connect).");
}

async function publishGithub(
  ticket: SupportTicket,
  settings: TicketConnectSettings,
  token: string,
): Promise<TicketPublishResult> {
  const owner = settings.github?.owner?.trim();
  const repo = settings.github?.repo?.trim();
  if (!owner || !repo) throw new Error("Set GitHub owner and repo in Connect.");
  const { title, body } = ticketIssuePayload(ticket);
  const json = await readJson(
    await httpFetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body }),
      },
    ),
  );
  const number = json.number ?? json.id;
  const url = String(json.html_url || "");
  if (!number || !url) throw new Error("GitHub response missing issue url.");
  return { id: number as number | string, url, platformId: "github" };
}

async function publishGitlab(
  ticket: SupportTicket,
  settings: TicketConnectSettings,
  token: string,
): Promise<TicketPublishResult> {
  const host = (settings.gitlab?.host || "https://gitlab.com").replace(/\/$/, "");
  const projectId = settings.gitlab?.projectId?.trim();
  if (!projectId) throw new Error("Set GitLab project ID in Connect.");
  const { title, body } = ticketIssuePayload(ticket);
  const json = await readJson(
    await httpFetch(
      `${host}/api/v4/projects/${encodeURIComponent(projectId)}/issues`,
      {
        method: "POST",
        headers: {
          "PRIVATE-TOKEN": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, description: body }),
      },
    ),
  );
  const iid = json.iid ?? json.id;
  const url = String(json.web_url || "");
  if (!iid || !url) throw new Error("GitLab response missing issue url.");
  return { id: iid as number | string, url, platformId: "gitlab" };
}

function jiraSiteHost(site: string): string {
  const s = site.trim().replace(/\/$/, "");
  if (s.startsWith("http")) return s;
  return `https://${s}`;
}

async function publishJira(
  ticket: SupportTicket,
  settings: TicketConnectSettings,
  token: string,
): Promise<TicketPublishResult> {
  const site = settings.jira?.site?.trim();
  const email = settings.jira?.email?.trim();
  const projectKey = settings.jira?.projectKey?.trim();
  if (!site || !email || !projectKey) {
    throw new Error("Set Jira site, email, and project key in Connect.");
  }
  const { title, body } = ticketIssuePayload(ticket);
  const auth = btoa(`${email}:${token}`);
  const json = await readJson(
    await httpFetch(`${jiraSiteHost(site)}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: title,
          issuetype: { name: ticket.type === "Task" ? "Task" : "Bug" },
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: body.slice(0, 30000) }],
              },
            ],
          },
        },
      }),
    }),
  );
  const key = String(json.key || "");
  if (!key) throw new Error("Jira response missing issue key.");
  const url = `${jiraSiteHost(site)}/browse/${key}`;
  return { id: key, url, platformId: "jira" };
}

async function publishLinear(
  ticket: SupportTicket,
  settings: TicketConnectSettings,
  token: string,
): Promise<TicketPublishResult> {
  const teamId = settings.linear?.teamId?.trim();
  if (!teamId) throw new Error("Set Linear team ID in Connect.");
  const { title, body } = ticketIssuePayload(ticket);
  const json = await readJson(
    await httpFetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query:
          "mutation IssueCreate($title: String!, $description: String, $teamId: String!) { issueCreate(input: { title: $title, description: $description, teamId: $teamId }) { success issue { id identifier url } } }",
        variables: { title, description: body, teamId },
      }),
    }),
  );
  const data = json.data as
    | { issueCreate?: { issue?: { identifier?: string; url?: string } } }
    | undefined;
  const issue = data?.issueCreate?.issue;
  if (!issue?.url || !issue.identifier) {
    throw new Error("Linear response missing issue url.");
  }
  return { id: issue.identifier, url: issue.url, platformId: "linear" };
}

async function publishClickup(
  ticket: SupportTicket,
  settings: TicketConnectSettings,
  token: string,
): Promise<TicketPublishResult> {
  const listId = settings.clickup?.listId?.trim();
  if (!listId) throw new Error("Set ClickUp list ID in Connect.");
  const { title, body } = ticketIssuePayload(ticket);
  const json = await readJson(
    await httpFetch(`https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}/task`, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: title, markdown_description: body }),
    }),
  );
  const id = String(json.id || "");
  const url = String(json.url || "");
  if (!id || !url) throw new Error("ClickUp response missing task url.");
  return { id, url, platformId: "clickup" };
}
