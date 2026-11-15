/** Load/save Support tickets under workspace `.vigil/tickets/`. */

import {
  type SupportTicket,
  joinWorkspacePath,
  normalizeSupportTicket,
  parseSupportTicketJson,
  serializeSupportTicket,
  ticketRelativePath,
  ticketsRelativeDir,
  isSupportTicketArchived,
} from "./support-ticket";
import { createDir, listDir, readTextFile, writeTextFile } from "./workspace-fs";

export async function ensureTicketsDir(workspaceRoot: string): Promise<string> {
  const dir = joinWorkspacePath(workspaceRoot, ticketsRelativeDir());
  try {
    await createDir(dir);
  } catch {
    /* may already exist */
  }
  return dir;
}

export async function saveSupportTicket(
  workspaceRoot: string,
  ticket: SupportTicket,
): Promise<string> {
  await ensureTicketsDir(workspaceRoot);
  const rel = ticketRelativePath(ticket.id);
  const abs = joinWorkspacePath(workspaceRoot, rel);
  const next = normalizeSupportTicket({
    ...ticket,
    updatedAt: Date.now(),
    workspaceRoot,
  });
  await writeTextFile(abs, serializeSupportTicket(next));
  return abs;
}

export async function loadSupportTicket(
  workspaceRoot: string,
  ticketId: string,
): Promise<SupportTicket | null> {
  const abs = joinWorkspacePath(workspaceRoot, ticketRelativePath(ticketId));
  try {
    const text = await readTextFile(abs);
    return parseSupportTicketJson(text);
  } catch {
    return null;
  }
}

export async function listSupportTickets(
  workspaceRoot: string,
  options?: { includeArchived?: boolean },
): Promise<SupportTicket[]> {
  const dir = joinWorkspacePath(workspaceRoot, ticketsRelativeDir());
  let entries: { name: string; isDir: boolean }[] = [];
  try {
    entries = await listDir(dir);
  } catch {
    return [];
  }
  const tickets: SupportTicket[] = [];
  for (const entry of entries) {
    if (entry.isDir || !entry.name.endsWith(".json")) continue;
    const id = entry.name.replace(/\.json$/i, "");
    const ticket = await loadSupportTicket(workspaceRoot, id);
    if (!ticket) continue;
    if (isSupportTicketArchived(ticket) && !options?.includeArchived) continue;
    tickets.push(ticket);
  }
  return tickets.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSupportTicket(
  workspaceRoot: string,
  ticketId: string,
): Promise<void> {
  const abs = joinWorkspacePath(workspaceRoot, ticketRelativePath(ticketId));
  const { deletePath } = await import("./workspace-fs");
  await deletePath(abs);
}
