import Database from "@tauri-apps/plugin-sql";
import type { UsageSnapshot } from "./cost";

let dbPromise: Promise<Database> | null = null;

async function db(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:vigil.db").then(async (database) => {
      await database.execute(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          messages_json TEXT NOT NULL DEFAULT '[]',
          archived INTEGER NOT NULL DEFAULT 0
        );
      `);
      await database.execute(`
        CREATE TABLE IF NOT EXISTS usage_logs (
          id TEXT PRIMARY KEY NOT NULL,
          session_id TEXT,
          provider TEXT,
          model TEXT,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cost REAL NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
      `);
      return database;
    });
  }
  return dbPromise;
}

export interface ChatSessionRow {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messagesJson: string;
  archived: boolean;
}

export async function upsertChatSession(row: {
  id: string;
  title: string;
  messagesJson: string;
  archived?: boolean;
}): Promise<void> {
  const database = await db();
  const now = Date.now();
  await database.execute(
    `INSERT INTO chat_sessions (id, title, created_at, updated_at, messages_json, archived)
     VALUES ($1, $2, $3, $3, $4, $5)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       updated_at = excluded.updated_at,
       messages_json = excluded.messages_json,
       archived = excluded.archived`,
    [row.id, row.title, now, row.messagesJson, row.archived ? 1 : 0],
  );
}

export async function deleteChatSession(id: string): Promise<void> {
  const database = await db();
  await database.execute(`DELETE FROM chat_sessions WHERE id = $1`, [id]);
}

export async function listChatSessions(includeArchived = true): Promise<ChatSessionRow[]> {
  const database = await db();
  const rows = await database.select<
    {
      id: string;
      title: string;
      created_at: number;
      updated_at: number;
      messages_json: string;
      archived: number;
    }[]
  >(
    includeArchived
      ? `SELECT * FROM chat_sessions ORDER BY updated_at DESC`
      : `SELECT * FROM chat_sessions WHERE archived = 0 ORDER BY updated_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messagesJson: r.messages_json,
    archived: !!r.archived,
  }));
}

export async function insertUsageLog(input: {
  id?: string;
  sessionId?: string;
  usage: UsageSnapshot;
}): Promise<void> {
  const database = await db();
  await database.execute(
    `INSERT INTO usage_logs (id, session_id, provider, model, input_tokens, output_tokens, cost, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.id ?? crypto.randomUUID(),
      input.sessionId ?? null,
      input.usage.provider ?? null,
      input.usage.model ?? null,
      input.usage.inputTokens,
      input.usage.outputTokens,
      input.usage.cost,
      Date.now(),
    ],
  );
}

export async function listUsageLogs(): Promise<
  {
    id: string;
    sessionId: string | null;
    provider: string | null;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    createdAt: number;
  }[]
> {
  const database = await db();
  const rows = await database.select<
    {
      id: string;
      session_id: string | null;
      provider: string | null;
      model: string | null;
      input_tokens: number;
      output_tokens: number;
      cost: number;
      created_at: number;
    }[]
  >(`SELECT * FROM usage_logs ORDER BY created_at DESC`);
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    provider: r.provider,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cost: r.cost,
    createdAt: r.created_at,
  }));
}
