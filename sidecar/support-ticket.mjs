/**
 * Support ticket normalize + markdown (shared with agent tools).
 * Keep field names aligned with src/lib/support-ticket.ts.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const TICKET_TYPES = new Set(["Bug", "Task", "User Story", "Spike"]);
const STATUSES = new Set(["draft", "ready", "published", "archived"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const SEVERITIES = new Set(["Sev1", "Sev2", "Sev3", "Sev4"]);

function asStringArray(value) {
  if (!Array.isArray(value)) {
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/\n+/)
        .map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim())
        .filter(Boolean);
    }
    return undefined;
  }
  const items = value.map((v) => String(v ?? "").trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function newId() {
  return `tkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeSupportTicket(raw = {}) {
  const o = raw && typeof raw === "object" ? raw : {};
  const now = Date.now();
  return {
    id: String(o.id || newId()),
    title: String(o.title || "Untitled ticket").trim() || "Untitled ticket",
    type: TICKET_TYPES.has(o.type) ? o.type : "Bug",
    status: STATUSES.has(o.status) ? o.status : "draft",
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
    priority: PRIORITIES.has(o.priority) ? o.priority : undefined,
    severity: SEVERITIES.has(o.severity) ? o.severity : undefined,
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

function bullets(items) {
  if (!items?.length) return "_None_";
  return items.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function listLines(items) {
  if (!items?.length) return "_None_";
  return items.map((s) => `- ${s}`).join("\n");
}

export function formatSupportTicketMarkdown(ticket) {
  const t = normalizeSupportTicket(ticket);
  const meta = [
    `**Type:** ${t.type}`,
    t.priority ? `**Priority:** ${t.priority}` : null,
    t.severity ? `**Severity:** ${t.severity}` : null,
    t.status ? `**Status:** ${t.status}` : null,
    t.connectionLabel ? `**Connection:** ${t.connectionLabel}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const sections = [
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
  sections.push("", "## Acceptance criteria", listLines(t.acceptanceCriteria));
  if (t.outOfScope) {
    sections.push("", "## Out of scope / notes", t.outOfScope);
  }
  return `${sections.join("\n").trim()}\n`;
}

export function ticketFilePath(cwd, id) {
  const safe = String(id || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
  return path.join(cwd, ".vigil", "tickets", `${safe || "ticket"}.json`);
}

export async function saveSupportTicketFile(cwd, ticket) {
  const t = normalizeSupportTicket({
    ...ticket,
    updatedAt: Date.now(),
    workspaceRoot: cwd,
  });
  const file = ticketFilePath(cwd, t.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(t, null, 2)}\n`, "utf8");
  return { ticket: t, path: file };
}

export async function listSupportTicketFiles(cwd) {
  const dir = path.join(cwd, ".vigil", "tickets");
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(
        await fs.readFile(path.join(dir, name), "utf8"),
      );
      const t = normalizeSupportTicket(raw);
      if (t.status === "archived") continue;
      out.push(t);
    } catch {
      /* skip bad */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
