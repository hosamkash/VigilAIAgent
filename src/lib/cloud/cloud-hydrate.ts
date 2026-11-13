/**
 * Pull account chats/plans from Firestore into local cache (merge by id).
 * Prefers cloud when newer, or when cloud has more / newer messages.
 */

import { listPlanArtifacts, savePlanArtifact } from "../plan-artifact-fs";
import { getWorkspaceCwd } from "../secure-storage";
import {
  listChatSessionDocs,
  upsertChatSessionDoc,
} from "../vigil-db/chat-history";
import type { ChatSessionDoc } from "../vigil-db/constants";
import {
  cloudMessageToLocal,
  listCloudChatsForUser,
  listCloudMessagesForChat,
} from "./chats-sync";
import { cloudDocToPlanArtifact } from "./plan-cloud";
import {
  listCloudPlansForUser,
  shouldReplaceLocalPlanWithCloud,
} from "./plans-sync";
import type { CloudChatDoc, CloudMessageDoc } from "./types";

export type CloudHydrateResult = {
  imported: number;
  skipped: number;
  chatsSeen: number;
};

export type CloudPlanHydrateResult = {
  imported: number;
  skipped: number;
  plansSeen: number;
  workspaceRoot: string | null;
};

function maxMessageCreatedAt(
  messages: Array<{ createdAt?: number }> | undefined,
): number {
  if (!messages?.length) return 0;
  let max = 0;
  for (const m of messages) {
    const t = Number(m.createdAt) || 0;
    if (t > max) max = t;
  }
  return max;
}

/**
 * Decide whether cloud chat should replace local VigilDB copy.
 * Exported for unit tests.
 */
export function shouldReplaceLocalChatWithCloud(opts: {
  local: Pick<ChatSessionDoc, "updatedAt" | "messages"> | null;
  cloudUpdatedAt: number;
  cloudMessages: CloudMessageDoc[];
}): boolean {
  const { local, cloudUpdatedAt, cloudMessages } = opts;
  if (!local) return true;
  const localTs = Number(local.updatedAt) || 0;
  const cloudTs = Number(cloudUpdatedAt) || 0;
  if (cloudTs > localTs) return true;
  const localMessages = Array.isArray(local.messages)
    ? (local.messages as Array<{ createdAt?: number }>)
    : [];
  const localCount = localMessages.length;
  const cloudCount = cloudMessages.length;
  if (cloudCount > localCount) return true;
  const localMaxMsg = maxMessageCreatedAt(localMessages);
  const cloudMaxMsg = maxMessageCreatedAt(cloudMessages);
  if (cloudMaxMsg > localMaxMsg) return true;
  return false;
}

function cloudChatUpdatedAt(chat: CloudChatDoc): number {
  return Number(chat.updatedAtMs ?? chat.updatedAt) || 0;
}

export async function hydrateLocalChatsFromCloud(
  userId: string,
): Promise<CloudHydrateResult> {
  const localDocs = await listChatSessionDocs();
  const localById = new Map(localDocs.map((d) => [d.id, d] as const));

  const chats = await listCloudChatsForUser(userId);
  let imported = 0;
  let skipped = 0;

  for (const chat of chats) {
    const local = localById.get(chat.id) ?? null;
    const messages = await listCloudMessagesForChat(chat.id, userId);
    if (
      !shouldReplaceLocalChatWithCloud({
        local,
        cloudUpdatedAt: cloudChatUpdatedAt(chat),
        cloudMessages: messages,
      })
    ) {
      skipped += 1;
      continue;
    }
    const existed = Boolean(local);
    await upsertChatSessionDoc({
      id: chat.id,
      title: chat.title || "Chat",
      messages: messages.map(cloudMessageToLocal),
      // Keep open/archived state for existing; new imports → history
      archived: existed ? Boolean(local?.archived) : true,
      draft: "",
      titleCustom: false,
      createdAt: Number(chat.createdAtMs ?? chat.createdAt) || Date.now(),
      updatedAt: cloudChatUpdatedAt(chat) || Date.now(),
    });
    imported += 1;
  }

  return { imported, skipped, chatsSeen: chats.length };
}

/** Mirror cloud plans into `.vigil/plans/` for the open workspace. */
export async function hydrateLocalPlansFromCloud(
  userId: string,
  workspaceRoot?: string,
): Promise<CloudPlanHydrateResult> {
  const root =
    workspaceRoot ||
    (await getWorkspaceCwd().catch(() => "")) ||
    "";
  if (!root) {
    return { imported: 0, skipped: 0, plansSeen: 0, workspaceRoot: null };
  }

  const localPlans = await listPlanArtifacts(root, { includeArchived: true });
  const localById = new Map(localPlans.map((p) => [p.id, p] as const));
  const cloudPlans = await listCloudPlansForUser(userId);

  let imported = 0;
  let skipped = 0;
  for (const cloud of cloudPlans) {
    const local = localById.get(cloud.id) ?? null;
    if (!shouldReplaceLocalPlanWithCloud(local, cloud.updatedAt || 0)) {
      skipped += 1;
      continue;
    }
    const artifact = cloudDocToPlanArtifact(cloud, root);
    await savePlanArtifact(root, artifact);
    imported += 1;
  }

  return {
    imported,
    skipped,
    plansSeen: cloudPlans.length,
    workspaceRoot: root,
  };
}
