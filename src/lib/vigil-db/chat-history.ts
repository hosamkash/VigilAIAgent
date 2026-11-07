import {
  CHAT_SESSIONS_COLLECTION,
  type ChatSessionDoc,
} from "./constants";
import { buildDocumentPath } from "./paths";
import { openUserVigilDb, saveUserVigilDb } from "./session";
import type { VigilDbStore } from "./store";

function asSession(
  id: string,
  data: Record<string, unknown>,
): ChatSessionDoc | null {
  const title = String(data.title ?? "Chat").trim() || "Chat";
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const createdAt = Number(data.createdAt) || Date.now();
  const updatedAt = Number(data.updatedAt) || createdAt;
  return {
    id,
    title,
    messages,
    archived: Boolean(data.archived),
    draft: data.draft != null ? String(data.draft) : "",
    titleCustom: Boolean(data.titleCustom),
    createdAt,
    updatedAt,
  };
}

async function persist(mutator: (store: VigilDbStore) => void): Promise<void> {
  const { path, store } = await openUserVigilDb();
  mutator(store);
  await saveUserVigilDb(path, store);
}

export async function listChatSessionDocs(): Promise<ChatSessionDoc[]> {
  const { store } = await openUserVigilDb();
  store.ensureCollection(CHAT_SESSIONS_COLLECTION);
  return store
    .listDocuments(CHAT_SESSIONS_COLLECTION, 2000)
    .map((d) => asSession(d.id, d.data))
    .filter((d): d is ChatSessionDoc => d !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function upsertChatSessionDoc(
  doc: Omit<ChatSessionDoc, "createdAt" | "updatedAt"> & {
    createdAt?: number;
    updatedAt?: number;
  },
): Promise<ChatSessionDoc> {
  const now = Date.now();
  const full: ChatSessionDoc = {
    id: doc.id,
    title: doc.title.trim() || "Chat",
    messages: Array.isArray(doc.messages) ? doc.messages : [],
    archived: Boolean(doc.archived),
    draft: doc.draft ?? "",
    titleCustom: Boolean(doc.titleCustom),
    createdAt: doc.createdAt ?? now,
    updatedAt: doc.updatedAt ?? now,
  };

  await persist((store) => {
    const path = buildDocumentPath(CHAT_SESSIONS_COLLECTION, full.id);
    const existing = store.getDocument(path);
    if (existing.exists) {
      const prev = asSession(full.id, existing.data);
      full.createdAt = prev?.createdAt ?? full.createdAt;
    }
    store.setDocument(path, { ...full }, false);
  });

  return full;
}

export async function deleteChatSessionDoc(id: string): Promise<void> {
  await persist((store) => {
    store.deleteDocument(buildDocumentPath(CHAT_SESSIONS_COLLECTION, id));
  });
}

/** One-time import from legacy SQLite rows into VigilDB (if DB empty). */
export async function migrateSqliteChatsIfNeeded(
  rows: Array<{
    id: string;
    title: string;
    messagesJson: string;
    archived: boolean;
    createdAt: number;
    updatedAt: number;
  }>,
): Promise<number> {
  if (!rows.length) return 0;
  const existing = await listChatSessionDocs();
  if (existing.length > 0) return 0;

  let written = 0;
  await persist((store) => {
    store.ensureCollection(CHAT_SESSIONS_COLLECTION);
    for (const row of rows) {
      let messages: unknown[] = [];
      try {
        const parsed = JSON.parse(row.messagesJson || "[]");
        messages = Array.isArray(parsed) ? parsed : [];
      } catch {
        messages = [];
      }
      store.setDocument(
        buildDocumentPath(CHAT_SESSIONS_COLLECTION, row.id),
        {
          id: row.id,
          title: row.title,
          messages,
          archived: row.archived,
          draft: "",
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        false,
      );
      written += 1;
    }
  });
  return written;
}
