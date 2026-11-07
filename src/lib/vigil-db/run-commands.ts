import {
  RUN_COMMANDS_COLLECTION,
  type RunCommandDoc,
} from "./constants";
import { buildDocumentPath } from "./paths";
import { openUserVigilDb, saveUserVigilDb } from "./session";
import type { VigilDbStore } from "./store";

function asRunDoc(
  id: string,
  data: Record<string, unknown>,
): RunCommandDoc | null {
  const command = String(data.command ?? "").trim();
  if (!command) return null;
  const kind = data.kind === "override" ? "override" : "custom";
  return {
    id,
    command,
    description: String(data.description ?? ""),
    kind,
    baseId: data.baseId ? String(data.baseId) : undefined,
    updatedAt: String(data.updatedAt ?? new Date().toISOString()),
  };
}

export async function listRunCommandDocs(): Promise<RunCommandDoc[]> {
  const { store } = await openUserVigilDb();
  store.ensureCollection(RUN_COMMANDS_COLLECTION);
  return store
    .listDocuments(RUN_COMMANDS_COLLECTION)
    .map((d) => asRunDoc(d.id, d.data))
    .filter((d): d is RunCommandDoc => d !== null);
}

async function persist(mutator: (store: VigilDbStore) => void): Promise<void> {
  const { path, store } = await openUserVigilDb();
  mutator(store);
  await saveUserVigilDb(path, store);
}

export async function upsertRunCommand(
  doc: Omit<RunCommandDoc, "updatedAt"> & { updatedAt?: string },
): Promise<RunCommandDoc> {
  const full: RunCommandDoc = {
    ...doc,
    command: doc.command.trim(),
    description: doc.description.trim(),
    updatedAt: doc.updatedAt ?? new Date().toISOString(),
  };
  await persist((store) => {
    store.setDocument(
      buildDocumentPath(RUN_COMMANDS_COLLECTION, full.id),
      { ...full },
      false,
    );
  });
  return full;
}

export async function deleteRunCommand(id: string): Promise<void> {
  await persist((store) => {
    store.deleteDocument(buildDocumentPath(RUN_COMMANDS_COLLECTION, id));
  });
}

/** Override a discovered script without editing package.json. */
export async function upsertRunOverride(input: {
  baseId: string;
  command: string;
  description: string;
}): Promise<RunCommandDoc> {
  return upsertRunCommand({
    id: `override:${input.baseId}`,
    baseId: input.baseId,
    command: input.command.trim(),
    description: input.description.trim(),
    kind: "override",
  });
}
