/**
 * Open / save user VigilDB (.vigilDB) on disk via Tauri FS.
 * Path preference lives in localStorage; the portable data is the .vigilDB file.
 */

import { exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { dirname, homeDir, join } from "@tauri-apps/api/path";
import { VigilDbStore } from "./store";
import {
  CHAT_SESSIONS_COLLECTION,
  RUN_COMMANDS_COLLECTION,
  VIGIL_DB_EXTENSION,
} from "./constants";
import { buildDocumentPath } from "./paths";

function ensureAgentCollections(store: VigilDbStore): void {
  store.ensureCollection(RUN_COMMANDS_COLLECTION);
  store.ensureCollection(CHAT_SESSIONS_COLLECTION);
}

const PATH_KEY = "vigil.userDbPath";
const LEGACY_RUN_KEY = "vigil.runConfigs";

let cached: { path: string; store: VigilDbStore } | null = null;

export function getConfiguredVigilDbPath(): string | null {
  try {
    const p = localStorage.getItem(PATH_KEY)?.trim();
    return p || null;
  } catch {
    return null;
  }
}

export function setConfiguredVigilDbPath(path: string): void {
  localStorage.setItem(PATH_KEY, path.trim());
  cached = null;
}

export async function defaultVigilDbPath(): Promise<string> {
  try {
    const home = await homeDir();
    const dir = await join(home, ".vigil-agent");
    return await join(dir, `user${VIGIL_DB_EXTENSION}`);
  } catch {
    return `user${VIGIL_DB_EXTENSION}`;
  }
}

export async function resolveVigilDbPath(): Promise<string> {
  return getConfiguredVigilDbPath() || (await defaultVigilDbPath());
}

async function ensureParentDir(filePath: string): Promise<void> {
  try {
    const dir = await dirname(filePath);
    if (dir && !(await exists(dir))) {
      await mkdir(dir, { recursive: true });
    }
  } catch {
    /* preview / permission */
  }
}

function migrateLegacyRunCommands(store: VigilDbStore): void {
  try {
    const raw = localStorage.getItem(LEGACY_RUN_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Array<{
      id?: string;
      command?: string;
      description?: string;
      label?: string;
    }>;
    if (!Array.isArray(parsed) || parsed.length === 0) return;

    for (const item of parsed) {
      const command = String(item.command ?? "").trim();
      if (!command) continue;
      const id = String(item.id || crypto.randomUUID());
      const path = buildDocumentPath(RUN_COMMANDS_COLLECTION, id);
      if (store.getDocument(path).exists) continue;
      store.setDocument(path, {
        id,
        command,
        description: String(item.description ?? item.label ?? ""),
        kind: "custom",
        updatedAt: new Date().toISOString(),
      });
    }
    localStorage.removeItem(LEGACY_RUN_KEY);
  } catch {
    /* ignore */
  }
}

function isTauriUnavailable(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes("plugin") ||
    msg.includes("not allowed") ||
    msg.includes("Tauri") ||
    msg.includes("IPC") ||
    msg.includes("__TAURI")
  );
}

export async function openUserVigilDb(options?: {
  path?: string;
  createIfMissing?: boolean;
}): Promise<{ path: string; store: VigilDbStore }> {
  const path = options?.path?.trim() || (await resolveVigilDbPath());
  if (cached && cached.path === path) {
    return cached;
  }

  let store: VigilDbStore;
  try {
    const fileExists = await exists(path);
    if (fileExists) {
      const bytes = await readFile(path);
      store = await VigilDbStore.fromBuffer(bytes);
      const before = store.docCount;
      migrateLegacyRunCommands(store);
      if (store.dirty && store.docCount > before) {
        await saveUserVigilDb(path, store);
      }
    } else if (options?.createIfMissing !== false) {
      store = VigilDbStore.create("vigil-agent-user");
      ensureAgentCollections(store);
      migrateLegacyRunCommands(store);
      await ensureParentDir(path);
      const bytes = await store.toBytes();
      await writeFile(path, bytes);
      setConfiguredVigilDbPath(path);
    } else {
      throw new Error(`VigilDB not found: ${path}`);
    }
  } catch (err) {
    if (isTauriUnavailable(err)) {
      store = VigilDbStore.create("vigil-agent-user");
      ensureAgentCollections(store);
      migrateLegacyRunCommands(store);
      cached = { path, store };
      return cached;
    }
    throw err;
  }

  cached = { path, store };
  return cached;
}

export async function saveUserVigilDb(
  path: string,
  store: VigilDbStore,
): Promise<void> {
  try {
    await ensureParentDir(path);
    const bytes = await store.toBytes();
    await writeFile(path, bytes);
    setConfiguredVigilDbPath(path);
    cached = { path, store };
  } catch (err) {
    console.warn("saveUserVigilDb:", err);
    cached = { path, store };
  }
}

export function clearVigilDbCache(): void {
  cached = null;
}

export function getCachedVigilDb(): {
  path: string;
  store: VigilDbStore;
} | null {
  return cached;
}
