/**
 * Push / pull chat sessions to Firestore (account-scoped).
 * Best-effort: local VigilDB remains the offline cache until web embed lands.
 */

import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import type { ChatMessage } from "../../store/chatStore";
import type { ChatTab } from "../../store/tabsStore";
import { CLOUD_COLLECTIONS } from "./collections";
import {
  chatTabToCloudDoc,
  messagesToCloudDocs,
} from "./chat-cloud";
import { getFirebaseDb } from "./firebase";
import { rejectIfCodeUpload } from "./no-code-upload";
import type { CloudChatDoc, CloudMessageDoc } from "./types";

const MESSAGE_BATCH_LIMIT = 400;

export async function pushChatToCloud(
  tab: ChatTab,
  userId: string,
  opts?: { projectId?: string | null; workspaceHint?: string | null },
): Promise<{ chat: CloudChatDoc; messageCount: number }> {
  const chat = chatTabToCloudDoc(tab, userId, opts);
  const messages = messagesToCloudDocs(tab.messages ?? [], tab.id, userId);
  rejectIfCodeUpload(chat);
  for (const m of messages) rejectIfCodeUpload(m);

  const db = getFirebaseDb();
  await setDoc(doc(db, CLOUD_COLLECTIONS.chats, chat.id), chat, {
    merge: true,
  });

  // Batch message upserts (Firestore limit 500 ops/batch).
  for (let i = 0; i < messages.length; i += MESSAGE_BATCH_LIMIT) {
    const slice = messages.slice(i, i + MESSAGE_BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const m of slice) {
      batch.set(doc(db, CLOUD_COLLECTIONS.messages, m.id), m, { merge: true });
    }
    await batch.commit();
  }

  return { chat, messageCount: messages.length };
}

function normalizeChatDoc(
  id: string,
  raw: Record<string, unknown>,
): CloudChatDoc {
  const userId = String(raw.userId || raw.uid || "");
  const createdAt = Number(raw.createdAtMs ?? raw.createdAt) || 0;
  const updatedAt = Number(raw.updatedAtMs ?? raw.updatedAt) || createdAt;
  return {
    ...(raw as CloudChatDoc),
    id: String(raw.id || id),
    userId,
    uid: String(raw.uid || userId),
    title: String(raw.title || "Chat"),
    createdAt,
    updatedAt,
    createdAtMs: Number(raw.createdAtMs) || createdAt,
    updatedAtMs: Number(raw.updatedAtMs) || updatedAt,
    archived: Boolean(raw.archived),
  };
}

function normalizeMessageDoc(
  id: string,
  raw: Record<string, unknown>,
): CloudMessageDoc {
  const userId = String(raw.userId || raw.uid || "");
  const createdAt = Number(raw.createdAtMs ?? raw.createdAt) || 0;
  return {
    ...(raw as CloudMessageDoc),
    id: String(raw.id || id),
    chatId: String(raw.chatId || ""),
    userId,
    uid: String(raw.uid || userId),
    role:
      raw.role === "user" || raw.role === "assistant" || raw.role === "system"
        ? raw.role
        : "assistant",
    content: String(raw.content || ""),
    createdAt,
    createdAtMs: Number(raw.createdAtMs) || createdAt,
    model: (raw.model as string | null | undefined) ?? null,
  };
}

export async function listCloudChatsForUser(
  userId: string,
): Promise<CloudChatDoc[]> {
  const db = getFirebaseDb();
  const byUserId = query(
    collection(db, CLOUD_COLLECTIONS.chats),
    where("userId", "==", userId),
  );
  const byUid = query(
    collection(db, CLOUD_COLLECTIONS.chats),
    where("uid", "==", userId),
  );
  const [snapUser, snapUid] = await Promise.all([
    getDocs(byUserId),
    getDocs(byUid).catch(() => null),
  ]);
  const map = new Map<string, CloudChatDoc>();
  for (const d of snapUser.docs) {
    map.set(d.id, normalizeChatDoc(d.id, d.data() as Record<string, unknown>));
  }
  if (snapUid) {
    for (const d of snapUid.docs) {
      if (!map.has(d.id)) {
        map.set(
          d.id,
          normalizeChatDoc(d.id, d.data() as Record<string, unknown>),
        );
      }
    }
  }
  return [...map.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function listCloudMessagesForChat(
  chatId: string,
  userId: string,
): Promise<CloudMessageDoc[]> {
  const db = getFirebaseDb();
  const byUserId = query(
    collection(db, CLOUD_COLLECTIONS.messages),
    where("chatId", "==", chatId),
    where("userId", "==", userId),
  );
  const byUid = query(
    collection(db, CLOUD_COLLECTIONS.messages),
    where("chatId", "==", chatId),
    where("uid", "==", userId),
  );
  const [snapUser, snapUid] = await Promise.all([
    getDocs(byUserId),
    getDocs(byUid).catch(() => null),
  ]);
  const map = new Map<string, CloudMessageDoc>();
  for (const d of snapUser.docs) {
    map.set(
      d.id,
      normalizeMessageDoc(d.id, d.data() as Record<string, unknown>),
    );
  }
  if (snapUid) {
    for (const d of snapUid.docs) {
      if (!map.has(d.id)) {
        map.set(
          d.id,
          normalizeMessageDoc(d.id, d.data() as Record<string, unknown>),
        );
      }
    }
  }
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/** Minimal local message shape from a cloud message (no attachments). */
export function cloudMessageToLocal(msg: CloudMessageDoc): ChatMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.createdAt,
    modelLabel: msg.model ?? undefined,
  };
}
