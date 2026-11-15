import { openCloudEmbedTab } from "./open-cloud-embed";
import { isVigilWebConfigured } from "./vigil-web-url";

/** Firestore-primary: open the account chat canvas in the Vigil Cloud embed. */
export function openAccountChatInCloud(chatId: string): boolean {
  const id = String(chatId || "").trim();
  if (!id || !isVigilWebConfigured()) return false;
  return openCloudEmbedTab({
    focus: true,
    nextPath: `/app/chats/${encodeURIComponent(id)}`,
  });
}

export function cloudHistoryHomePath(): string {
  return "/app";
}
