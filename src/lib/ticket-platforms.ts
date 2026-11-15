/** Generic ticket publishers — Vigil drafts locally, then pushes to one board. */

export type TicketPlatformId =
  | "azure-devops"
  | "github"
  | "gitlab"
  | "jira"
  | "linear"
  | "clickup";

export type TicketPlatformStatus = "ready" | "soon";

export type TicketPlatform = {
  id: TicketPlatformId;
  label: string;
  hint: string;
  status: TicketPlatformStatus;
};

export const TICKET_PLATFORMS: TicketPlatform[] = [
  {
    id: "azure-devops",
    label: "Azure DevOps",
    hint: "Work Items — PAT in Connect",
    status: "ready",
  },
  {
    id: "github",
    label: "GitHub Issues",
    hint: "Sign in or PAT — owner/repo in Connect",
    status: "ready",
  },
  {
    id: "gitlab",
    label: "GitLab Issues",
    hint: "PAT + project ID in Connect",
    status: "ready",
  },
  {
    id: "jira",
    label: "Jira Cloud",
    hint: "Email + API token + project key",
    status: "ready",
  },
  {
    id: "linear",
    label: "Linear",
    hint: "API key + team ID in Connect",
    status: "ready",
  },
  {
    id: "clickup",
    label: "ClickUp",
    hint: "API token + list ID in Connect",
    status: "ready",
  },
];

export const DEFAULT_TICKET_PLATFORM: TicketPlatformId = "azure-devops";

export function ticketPlatformById(
  id: string | null | undefined,
): TicketPlatform {
  return (
    TICKET_PLATFORMS.find((p) => p.id === id) ||
    TICKET_PLATFORMS[0]!
  );
}

export function isTicketPlatformReady(id: string): boolean {
  return ticketPlatformById(id).status === "ready";
}
