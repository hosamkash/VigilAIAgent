import { getWorkspaceCwd } from "./secure-storage";
import { createDir, readTextFile, writeTextFile } from "./workspace-fs";
import { joinWorkspacePath } from "./support-ticket";
import type { TicketPlatformId } from "./ticket-platforms";

export type TicketConnectSettings = {
  "azure-devops"?: { organization?: string; project?: string; areaPath?: string };
  github?: { owner?: string; repo?: string };
  gitlab?: { host?: string; projectId?: string };
  jira?: { site?: string; email?: string; projectKey?: string };
  linear?: { teamId?: string };
  clickup?: { listId?: string };
};

const REL = ".vigil/ticket-platforms.json";

export function emptyTicketConnectSettings(): TicketConnectSettings {
  return {
    github: { owner: "", repo: "" },
    gitlab: { host: "https://gitlab.com", projectId: "" },
    jira: { site: "", email: "", projectKey: "" },
    linear: { teamId: "" },
    clickup: { listId: "" },
  };
}

export async function loadTicketConnectSettings(): Promise<TicketConnectSettings> {
  const root = await getWorkspaceCwd().catch(() => "");
  if (!root) return emptyTicketConnectSettings();
  try {
    const raw = await readTextFile(joinWorkspacePath(root, REL));
    const o = JSON.parse(raw) as TicketConnectSettings;
    return { ...emptyTicketConnectSettings(), ...o };
  } catch {
    return emptyTicketConnectSettings();
  }
}

export async function saveTicketConnectSettings(
  settings: TicketConnectSettings,
): Promise<void> {
  const root = await getWorkspaceCwd();
  if (!root) throw new Error("No workspace open");
  await createDir(joinWorkspacePath(root, ".vigil")).catch(() => undefined);
  await writeTextFile(
    joinWorkspacePath(root, REL),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}

export function platformNeeds(id: TicketPlatformId): string {
  switch (id) {
    case "azure-devops":
      return "Organization + project + PAT (Work Items).";
    case "github":
      return "Owner + repo + GitHub sign-in or PAT (repo scope).";
    case "gitlab":
      return "Host + project ID + PAT (api scope).";
    case "jira":
      return "Site + email + project key + API token.";
    case "linear":
      return "Team ID + Linear API key.";
    case "clickup":
      return "List ID + ClickUp API token.";
    default:
      return "Token stays in the local vault.";
  }
}
