/**
 * Map local chat tabs ↔ cloud-safe chat/message docs.
 * Strips images, file diffs, and other local-only blobs.
 */

import type { ChatMessage } from "../../store/chatStore";
import type { ChatTab } from "../../store/tabsStore";
import { rejectIfCodeUpload } from "./no-code-upload";
import type { CloudChatDoc, CloudMessageDoc } from "./types";

/** Soft cap so chat text never smuggles a whole repo dump. */
export const CLOUD_MESSAGE_CONTENT_MAX = 50_000;

export function sanitizeMessageContent(content: string): string {
  const text = content ?? "";
  if (text.length <= CLOUD_MESSAGE_CONTENT_MAX) return text;
  return `${text.slice(0, CLOUD_MESSAGE_CONTENT_MAX)}\n…[truncated for cloud]`;
}

export function chatTabToCloudDoc(
  tab: Pick<ChatTab, "id" | "title" | "archived" | "createdAt" | "updatedAt">,
  userId: string,
  opts?: { projectId?: string | null; workspaceHint?: string | null },
): CloudChatDoc {
  const now = Date.now();
  const createdAt = tab.createdAt ?? now;
  const updatedAt = tab.updatedAt ?? now;
  const doc: CloudChatDoc = {
    id: tab.id,
    userId,
    uid: userId,
    title: (tab.title ?? "").trim() || "Chat",
    projectId: opts?.projectId ?? null,
    createdAt,
    updatedAt,
    createdAtMs: createdAt,
    updatedAtMs: updatedAt,
    archived: Boolean(tab.archived),
    linkedWorkspaceHint: opts?.workspaceHint ?? null,
  };
  rejectIfCodeUpload(doc);
  return doc;
}

export function messageToCloudDoc(
  msg: ChatMessage,
  chatId: string,
  userId: string,
): CloudMessageDoc {
  const role =
    msg.role === "user" || msg.role === "assistant" || msg.role === "system"
      ? msg.role
      : "assistant";
  const createdAt = msg.createdAt || Date.now();
  const doc: CloudMessageDoc = {
    id: msg.id,
    chatId,
    userId,
    uid: userId,
    role,
    content: sanitizeMessageContent(msg.content ?? ""),
    createdAt,
    createdAtMs: createdAt,
    model: msg.modelLabel ?? null,
  };
  rejectIfCodeUpload(doc);
  return doc;
}

/** Cloud-safe message list — never includes dataUrls or file bodies. */
export function messagesToCloudDocs(
  messages: ChatMessage[],
  chatId: string,
  userId: string,
): CloudMessageDoc[] {
  return messages.map((m) => messageToCloudDoc(m, chatId, userId));
}
