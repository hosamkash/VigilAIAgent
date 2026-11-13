/**
 * Support Ticket Composer artifact (draft → ready → published).
 * Local persistence under `.vigil/tickets/`; Firestore/ADO later.
 */

export type SupportTicketType = "Bug" | "Task" | "User Story" | "Spike";

export type SupportTicketStatus = "draft" | "ready" | "published" | "archived";

export type SupportTicketPriority = "P0" | "P1" | "P2" | "P3";

export type SupportTicketSeverity = "Sev1" | "Sev2" | "Sev3" | "Sev4";

export type SupportTicket = {
  id: string;
  title: string;
  type: SupportTicketType;
  status: SupportTicketStatus;
  summary: string;
  businessImpact?: string;
  environment?: string;
  stepsToReproduce?: string[];
  expected?: string;
  actual?: string;
  evidence?: string[];
  suspectedArea?: string;
  acceptanceCriteria?: string[];
  outOfScope?: string;
  priority?: SupportTicketPriority;
  severity?: SupportTicketSeverity;
  /** Optional DB profile nickname (no secrets). */
  connectionLabel?: string;
  chatTabId?: string;
  workspaceRoot?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  /** Filled after ADO publish. */
  adoWorkItemId?: number;
  adoUrl?: string;
};

const TICKET_TYPES = new Set<SupportTicketType>([
  "Bug",
  "Task",
  "User Story",
  "Spike",
]);

const TICKET_STATUSES = new Set<SupportTicketStatus>([
  "draft",
  "ready",
  "published",
  "archived",
]);

const PRIORITIES = new Set<SupportTicketPriority>(["P0", "P1", "P2", "P3"]);
const SEVERITIES = new Set<SupportTicketSeverity>([
  "Sev1",
  "Sev2",
  "Sev3",
  "Sev4",
]);

export function ticketsRelativeDir(): string {
  return ".vigil/tickets";
}

export function ticketRelativePath(id: string): string {
  const safe = String(id || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
  return `${ticketsRelativeDir()}/${safe || "ticket"}.json`;
}

export function joinWorkspacePath(root: string, rel: string): string {
  const base = String(root || "").replace(/[/\\]+$/, "");
  const part = String(rel || "").replace(/^[/\\]+/, "");
  if (!base) return part;
  return `${base}/${part}`.replace(/\\/g, "/");
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/\n+/)
        .map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim())
        .filter(Boolean);
    }
    return undefined;
  }
  const items = value
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function newId(): string {
  return `tkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptySupportTicket(
  partial?: Partial<SupportTicket>,
): SupportTicket {
  const now = Date.now();
  return normalizeSupportTicket({
    id: partial?.id || newId(),
    title: partial?.title || "Untitled ticket",
    type: partial?.type || "Bug",
    status: partial?.status || "draft",
    summary: partial?.summary || "",
    createdAt: partial?.createdAt || now,
    updatedAt: partial?.updatedAt || now,
    ...partial,
  });
}

export function normalizeSupportTicket(raw: unknown): SupportTicket {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const type = TICKET_TYPES.has(o.type as SupportTicketType)
    ? (o.type as SupportTicketType)
    : "Bug";
  const status = TICKET_STATUSES.has(o.status as SupportTicketStatus)
    ? (o.status as SupportTicketStatus)
    : "draft";
  const priority = PRIORITIES.has(o.priority as SupportTicketPriority)
    ? (o.priority as SupportTicketPriority)
    : undefined;
  const severity = SEVERITIES.has(o.severity as SupportTicketSeverity)
    ? (o.severity as SupportTicketSeverity)
    : undefined;
  const now = Date.now();
  return {
    id: String(o.id || newId()),
    title: String(o.title || "Untitled ticket").trim() || "Untitled ticket",
    type,
    status,
    summary: String(o.summary || "").trim(),
    businessImpact: String(o.businessImpact || "").trim() || undefined,
    environment: String(o.environment || "").trim() || undefined,
    stepsToReproduce: asStringArray(o.stepsToReproduce),
    expected: String(o.expected || "").trim() || undefined,
    actual: String(o.actual || "").trim() || undefined,
    evidence: asStringArray(o.evidence),
    suspectedArea: String(o.suspectedArea || "").trim() || undefined,
    acceptanceCriteria: asStringArray(o.acceptanceCriteria),
    outOfScope: String(o.outOfScope || "").trim() || undefined,
    priority,
    severity,
    connectionLabel: String(o.connectionLabel || "").trim() || undefined,
    chatTabId: String(o.chatTabId || "").trim() || undefined,
    workspaceRoot: String(o.workspaceRoot || "").trim() || undefined,
    createdAt: Number(o.createdAt) || now,
    updatedAt: Number(o.updatedAt) || now,
    archivedAt:
      typeof o.archivedAt === "number" && o.archivedAt > 0
        ? o.archivedAt
        : undefined,
    adoWorkItemId:
      typeof o.adoWorkItemId === "number" ? o.adoWorkItemId : undefined,
    adoUrl: String(o.adoUrl || "").trim() || undefined,
  };
}

export function parseSupportTicketJson(text: string): SupportTicket | null {
  try {
    return normalizeSupportTicket(JSON.parse(text));
  } catch {
    return null;
  }
}

export function serializeSupportTicket(ticket: SupportTicket): string {
  return `${JSON.stringify(normalizeSupportTicket(ticket), null, 2)}\n`;
}

function bullets(items?: string[]): string {
  if (!items?.length) return "_None_";
  return items.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function listLines(items?: string[]): string {
  if (!items?.length) return "_None_";
  return items.map((s) => `- ${s}`).join("\n");
}

/** Developer-facing markdown for Copy / ADO description. */
export function formatSupportTicketMarkdown(ticket: SupportTicket): string {
  const t = normalizeSupportTicket(ticket);
  const meta = [
    `**Type:** ${t.type}`,
    t.priority ? `**Priority:** ${t.priority}` : null,
    t.severity ? `**Severity:** ${t.severity}` : null,
    t.status ? `**Status:** ${t.status}` : null,
    t.connectionLabel ? `**Connection:** ${t.connectionLabel}` : null,
    t.adoWorkItemId ? `**ADO:** #${t.adoWorkItemId}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const sections: string[] = [
    `# ${t.title}`,
    meta,
    "",
    "## Summary",
    t.summary || "_TBD_",
  ];

  if (t.businessImpact) {
    sections.push("", "## Business / user impact", t.businessImpact);
  }
  if (t.environment) {
    sections.push("", "## Environment", t.environment);
  }
  sections.push("", "## Steps to reproduce", bullets(t.stepsToReproduce));
  if (t.expected || t.actual) {
    sections.push(
      "",
      "## Expected vs actual",
      `**Expected:** ${t.expected || "_TBD_"}`,
      "",
      `**Actual:** ${t.actual || "_TBD_"}`,
    );
  }
  sections.push("", "## Evidence", listLines(t.evidence));
  if (t.suspectedArea) {
    sections.push("", "## Suspected area", t.suspectedArea);
  }
  sections.push(
    "",
    "## Acceptance criteria",
    listLines(t.acceptanceCriteria),
  );
  if (t.outOfScope) {
    sections.push("", "## Out of scope / notes", t.outOfScope);
  }
  if (t.adoUrl) {
    sections.push("", `ADO: ${t.adoUrl}`);
  }
  return sections.join("\n").trim() + "\n";
}

export function isSupportTicketArchived(ticket: SupportTicket): boolean {
  return (
    ticket.status === "archived" ||
    (typeof ticket.archivedAt === "number" && ticket.archivedAt > 0)
  );
}
