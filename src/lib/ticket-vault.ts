import { invoke } from "@tauri-apps/api/core";
import type { TicketPlatformId } from "./ticket-platforms";

export async function saveTicketPat(
  platform: TicketPlatformId,
  pat: string,
): Promise<void> {
  await invoke("save_ticket_pat", { platform, pat });
}

export async function deleteTicketPat(platform: TicketPlatformId): Promise<void> {
  await invoke("delete_ticket_pat", { platform });
}

export async function hasTicketPat(platform: TicketPlatformId): Promise<boolean> {
  try {
    return await invoke<boolean>("has_ticket_pat", { platform });
  } catch {
    return false;
  }
}

export async function getTicketPat(platform: TicketPlatformId): Promise<string> {
  return invoke<string>("get_ticket_pat", { platform });
}
