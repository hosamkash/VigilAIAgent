/**
 * Read and apply local restore points.
 * Bytes live in ~/.vigil-agent/checkpoints and are never written to VigilDB.
 */

import { homeDir, join } from "@tauri-apps/api/path";
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { deletePath, writeTextFile as writeProjectFile } from "./workspace-fs";
import {
  normalizeWorkspaceRoot,
  planRestore,
  type CheckpointFile,
  type CheckpointSnapshot,
} from "./checkpoint-plan";

async function workspaceKey(workspace: string): Promise<string> {
  const root = normalizeWorkspaceRoot(workspace);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(root));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

async function checkpointDir(workspace: string): Promise<string> {
  const home = await homeDir();
  return join(home, ".vigil-agent", "checkpoints", await workspaceKey(workspace));
}

function asSnapshot(raw: unknown): CheckpointSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const snap = raw as Partial<CheckpointSnapshot>;
  if (!snap.id || !Array.isArray(snap.files)) return null;
  const files: CheckpointFile[] = [];
  for (const file of snap.files) {
    if (!file || typeof file !== "object") continue;
    const item = file as Partial<CheckpointFile>;
    if (!item.path || item.path.includes("..") || item.path.startsWith("/")) continue;
    files.push({
      path: item.path,
      existed: Boolean(item.existed),
      content: typeof item.content === "string" ? item.content : "",
    });
  }
  return {
    id: snap.id,
    workspace: typeof snap.workspace === "string" ? snap.workspace : "",
    createdAt: typeof snap.createdAt === "number" ? snap.createdAt : 0,
    files,
  };
}

export async function listCheckpointIds(workspace: string): Promise<string[]> {
  const snaps = await readSnapshots(workspace);
  return snaps.map((snap) => snap.id);
}

async function readSnapshots(workspace: string): Promise<CheckpointSnapshot[]> {
  const dir = await checkpointDir(workspace);
  if (!(await exists(dir))) return [];
  const entries = await readDir(dir);
  const snaps: CheckpointSnapshot[] = [];
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith(".json")) continue;
    try {
      const text = await readTextFile(await join(dir, entry.name));
      const snap = asSnapshot(JSON.parse(text));
      if (snap) snaps.push(snap);
    } catch {
      /* Skip a damaged point. The others still restore. */
    }
  }
  return snaps;
}

export async function restoreCheckpoint(
  workspace: string,
  messageId: string,
): Promise<CheckpointFile[]> {
  const snaps = await readSnapshots(workspace);
  const files = planRestore(snaps, messageId);
  const root = normalizeWorkspaceRoot(workspace);
  for (const file of files) {
    const abs = `${root}/${file.path}`;
    if (file.existed) {
      await writeProjectFile(abs, file.content);
    } else {
      try {
        await deletePath(abs);
      } catch {
        /* Already gone. */
      }
    }
  }
  return files;
}
