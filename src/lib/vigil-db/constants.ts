/** VigilDB format — ZIP of nested JSON docs (same as VigilHub-Assist). */

export const VIGIL_DB_EXTENSION = ".vigilDB" as const;
export const VIGIL_DB_KIND = "vigil-db" as const;
export const VIGIL_DB_FORMAT_VERSION = 1 as const;
export const VIGIL_DB_DATA_PREFIX = "data/";
export const VIGIL_DB_META_FILE = "meta.json";
export const VIGIL_DB_EMPTY_COLLECTIONS_FILE = "empty-collections.json";

/** Tenant-style collection for Vigil AI Agent user data */
export const AGENT_TENANT = "VigilAgent";
export const RUN_COMMANDS_COLLECTION = `${AGENT_TENANT}.runCommands`;
export const CHAT_SESSIONS_COLLECTION = `${AGENT_TENANT}.chatSessions`;

export interface ChatSessionDoc {
  id: string;
  title: string;
  /** Serialized ChatMessage[] */
  messages: unknown[];
  archived: boolean;
  draft?: string;
  /** Set when the user renames the tab. Auto titles stay unlocked. */
  titleCustom?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface VigilDbMeta {
  kind: typeof VIGIL_DB_KIND;
  formatVersion: typeof VIGIL_DB_FORMAT_VERSION;
  name: string;
  createdAt: string;
  updatedAt: string;
  extension: typeof VIGIL_DB_EXTENSION;
}

export interface RunCommandDoc {
  id: string;
  command: string;
  description: string;
  /** custom = user-created; override = edit of a package.json / launch item */
  kind: "custom" | "override";
  /** For overrides: original discovered id (e.g. npm:dev) */
  baseId?: string;
  updatedAt: string;
}
