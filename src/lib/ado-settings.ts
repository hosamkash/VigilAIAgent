/**
 * Azure DevOps integration settings (org/project — no PAT in workspace files).
 */

import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  formatSupportTicketMarkdown,
  type SupportTicket,
  type SupportTicketType,
  normalizeSupportTicket,
} from "./support-ticket";
import { getWorkspaceCwd } from "./secure-storage";
import {
  createDir,
  readTextFile,
  writeTextFile,
} from "./workspace-fs";
import { joinWorkspacePath } from "./support-ticket";

export type AdoSettings = {
  organization: string;
  project: string;
  defaultWorkItemType: SupportTicketType | "Bug" | "Task";
  areaPath?: string;
};

const SETTINGS_REL = ".vigil/ado-settings.json";

export function emptyAdoSettings(): AdoSettings {
  return {
    organization: "",
    project: "",
    defaultWorkItemType: "Bug",
  };
}

export async function loadAdoSettings(): Promise<AdoSettings> {
  const root = await getWorkspaceCwd().catch(() => "");
  if (!root) return emptyAdoSettings();
  try {
    const raw = await readTextFile(joinWorkspacePath(root, SETTINGS_REL));
    const o = JSON.parse(raw) as Partial<AdoSettings>;
    return {
      organization: String(o.organization || "").trim(),
      project: String(o.project || "").trim(),
      defaultWorkItemType: (o.defaultWorkItemType as AdoSettings["defaultWorkItemType"]) || "Bug",
      areaPath: String(o.areaPath || "").trim() || undefined,
    };
  } catch {
    return emptyAdoSettings();
  }
}

export async function saveAdoSettings(settings: AdoSettings): Promise<void> {
  const root = await getWorkspaceCwd();
  if (!root) throw new Error("No workspace open");
  await createDir(joinWorkspacePath(root, ".vigil")).catch(() => undefined);
  const next: AdoSettings = {
    organization: settings.organization.trim(),
    project: settings.project.trim(),
    defaultWorkItemType: settings.defaultWorkItemType || "Bug",
    areaPath: settings.areaPath?.trim() || undefined,
  };
  await writeTextFile(
    joinWorkspacePath(root, SETTINGS_REL),
    `${JSON.stringify(next, null, 2)}\n`,
  );
}

export async function saveAdoPat(pat: string): Promise<void> {
  await invoke("save_ado_pat", { pat });
}

export async function deleteAdoPat(): Promise<void> {
  await invoke("delete_ado_pat");
}

export async function hasAdoPat(): Promise<boolean> {
  try {
    return await invoke<boolean>("has_ado_pat");
  } catch {
    return false;
  }
}

async function getAdoPat(): Promise<string> {
  return invoke<string>("get_ado_pat");
}

function mapWorkItemType(type: SupportTicketType): string {
  if (type === "User Story") return "User Story";
  if (type === "Spike") return "Task";
  if (type === "Task") return "Task";
  return "Bug";
}

function ticketToHtmlDescription(ticket: SupportTicket): string {
  const md = formatSupportTicketMarkdown(ticket);
  // ADO description fields accept HTML; keep a simple preformatted body.
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre>${escaped}</pre>`;
}

export type AdoPublishResult = {
  id: number;
  url: string;
};

async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await tauriFetch(url, init);
  } catch {
    return fetch(url, init);
  }
}

/** Create an Azure DevOps work item from a Support ticket (PAT auth). */
export async function publishSupportTicketToAdo(
  ticket: SupportTicket,
  overrides?: Partial<AdoSettings>,
): Promise<AdoPublishResult> {
  const settings = { ...(await loadAdoSettings()), ...overrides };
  const org = settings.organization.trim();
  const project = settings.project.trim();
  if (!org || !project) {
    throw new Error("Set Azure DevOps organization + project in Settings.");
  }
  const pat = await getAdoPat();
  const t = normalizeSupportTicket(ticket);
  const wit = mapWorkItemType(t.type || settings.defaultWorkItemType || "Bug");
  const apiType = encodeURIComponent(wit);
  const url =
    `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}` +
    `/_apis/wit/workitems/$${apiType}?api-version=7.1`;

  const ops: Array<{ op: string; path: string; value: unknown }> = [
    { op: "add", path: "/fields/System.Title", value: t.title },
    {
      op: "add",
      path: "/fields/System.Description",
      value: ticketToHtmlDescription(t),
    },
  ];
  if (t.stepsToReproduce?.length) {
    ops.push({
      op: "add",
      path: "/fields/Microsoft.VSTS.TCM.ReproSteps",
      value: `<ol>${t.stepsToReproduce.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`,
    });
  }
  if (settings.areaPath) {
    ops.push({
      op: "add",
      path: "/fields/System.AreaPath",
      value: settings.areaPath,
    });
  }
  if (t.priority) {
    const p = Number(t.priority.replace(/\D/g, "")) || 2;
    ops.push({
      op: "add",
      path: "/fields/Microsoft.VSTS.Common.Priority",
      value: Math.min(Math.max(p, 1), 4),
    });
  }

  const auth = btoa(`:${pat}`);
  const res = await httpFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json-patch+json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(ops),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `ADO publish failed (${res.status}): ${text.slice(0, 400)}`,
    );
  }
  const body = JSON.parse(text) as { id?: number; url?: string; _links?: { html?: { href?: string } } };
  const id = Number(body.id);
  if (!id) throw new Error("ADO response missing work item id");
  const htmlUrl =
    body._links?.html?.href ||
    `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
  return { id, url: htmlUrl };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
