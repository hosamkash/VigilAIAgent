/**
 * VigilDB in-memory store — compatible with VigilHub-Assist `.vigilDB` ZIP format.
 * Odd path segments = collection, even = document (Firestore-style).
 */

import JSZip from "jszip";
import {
  VIGIL_DB_DATA_PREFIX,
  VIGIL_DB_EMPTY_COLLECTIONS_FILE,
  VIGIL_DB_EXTENSION,
  VIGIL_DB_FORMAT_VERSION,
  VIGIL_DB_KIND,
  VIGIL_DB_META_FILE,
  type VigilDbMeta,
} from "./constants";
import {
  isCollectionPath,
  isDocumentPath,
  normalizeVigilDbPath,
} from "./paths";

function documentPathToZipEntry(documentPath: string): string {
  const path = normalizeVigilDbPath(documentPath);
  if (!path || !isDocumentPath(path)) {
    throw new Error(`Invalid document path: ${documentPath}`);
  }
  return `${VIGIL_DB_DATA_PREFIX}${path}.json`;
}

function zipEntryToDocumentPath(entryName: string): string | null {
  const name = entryName.replace(/\\/g, "/");
  if (!name.startsWith(VIGIL_DB_DATA_PREFIX) || !name.endsWith(".json")) {
    return null;
  }
  const path = name.slice(VIGIL_DB_DATA_PREFIX.length, -".json".length);
  if (!path || !isDocumentPath(path)) return null;
  return path;
}

function parseJsonText(text: string): unknown {
  const cleaned = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
  return JSON.parse(cleaned);
}

function sanitizeDbName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\.vigilDB$/i, "")
    .replace(/[^\w.\- \u0600-\u06FF]+/g, "_")
    .slice(0, 80);
  return cleaned || "vigil-agent";
}

export class VigilDbStore {
  readonly meta: VigilDbMeta;
  private readonly docs = new Map<string, Record<string, unknown>>();
  private readonly emptyCollections = new Set<string>();
  dirty = false;

  private constructor(meta: VigilDbMeta) {
    this.meta = meta;
  }

  static create(name: string): VigilDbStore {
    const now = new Date().toISOString();
    return new VigilDbStore({
      kind: VIGIL_DB_KIND,
      formatVersion: VIGIL_DB_FORMAT_VERSION,
      name: sanitizeDbName(name),
      createdAt: now,
      updatedAt: now,
      extension: VIGIL_DB_EXTENSION,
    });
  }

  static async fromBuffer(
    buffer: ArrayBuffer | Uint8Array,
  ): Promise<VigilDbStore> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch {
      throw new Error("Not a valid .vigilDB ZIP archive");
    }
    const metaFile = zip.file(VIGIL_DB_META_FILE);
    if (!metaFile) {
      throw new Error(`Missing ${VIGIL_DB_META_FILE} in .vigilDB`);
    }
    const metaRaw = parseJsonText(
      await metaFile.async("string"),
    ) as Partial<VigilDbMeta>;
    if (metaRaw.kind !== VIGIL_DB_KIND) {
      throw new Error("Invalid VigilDB kind");
    }
    if (Number(metaRaw.formatVersion) !== VIGIL_DB_FORMAT_VERSION) {
      throw new Error(`Unsupported VigilDB format: ${metaRaw.formatVersion}`);
    }

    const store = new VigilDbStore({
      kind: VIGIL_DB_KIND,
      formatVersion: VIGIL_DB_FORMAT_VERSION,
      name: sanitizeDbName(String(metaRaw.name || "vigil-agent")),
      createdAt: String(metaRaw.createdAt || new Date().toISOString()),
      updatedAt: String(metaRaw.updatedAt || new Date().toISOString()),
      extension: VIGIL_DB_EXTENSION,
    });

    const emptyFile = zip.file(VIGIL_DB_EMPTY_COLLECTIONS_FILE);
    if (emptyFile) {
      const list = parseJsonText(await emptyFile.async("string")) as unknown;
      if (Array.isArray(list)) {
        for (const item of list) {
          const p = normalizeVigilDbPath(String(item || ""));
          if (p && isCollectionPath(p)) store.emptyCollections.add(p);
        }
      }
    }

    for (const entryName of Object.keys(zip.files)) {
      const entry = zip.files[entryName];
      if (!entry || entry.dir) continue;
      const docPath = zipEntryToDocumentPath(entryName);
      if (!docPath) continue;
      const text = await entry.async("string");
      let data: Record<string, unknown> = {};
      try {
        const parsed = parseJsonText(text);
        data =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { value: parsed };
      } catch {
        data = { _raw: text };
      }
      store.docs.set(docPath, data);
      const parts = docPath.split("/");
      for (let i = 1; i < parts.length; i += 2) {
        store.emptyCollections.delete(parts.slice(0, i).join("/"));
      }
    }

    store.dirty = false;
    return store;
  }

  get docCount(): number {
    return this.docs.size;
  }

  getDocument(documentPath: string): {
    id: string;
    path: string;
    exists: boolean;
    data: Record<string, unknown>;
  } {
    const path = normalizeVigilDbPath(documentPath);
    if (!path || !isDocumentPath(path)) {
      throw new Error(`Invalid document path: ${documentPath}`);
    }
    const parts = path.split("/");
    const id = parts[parts.length - 1] || "";
    const data = this.docs.get(path);
    return {
      id,
      path,
      exists: data !== undefined,
      data: data ? structuredClone(data) : {},
    };
  }

  setDocument(
    documentPath: string,
    data: Record<string, unknown>,
    merge = false,
  ): void {
    const path = normalizeVigilDbPath(documentPath);
    if (!path || !isDocumentPath(path)) {
      throw new Error(`Invalid document path: ${documentPath}`);
    }
    const prev = this.docs.get(path);
    if (merge && prev) {
      this.docs.set(path, { ...prev, ...data });
    } else {
      this.docs.set(path, { ...data });
    }
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i += 2) {
      this.emptyCollections.delete(parts.slice(0, i).join("/"));
    }
    this.touch();
  }

  deleteDocument(documentPath: string): boolean {
    const path = normalizeVigilDbPath(documentPath);
    if (!path || !isDocumentPath(path)) {
      throw new Error(`Invalid document path: ${documentPath}`);
    }
    const deleted = this.docs.delete(path);
    if (deleted) this.touch();
    return deleted;
  }

  listDocuments(collectionPath: string, limit = 500): Array<{
    id: string;
    path: string;
    data: Record<string, unknown>;
  }> {
    const path = normalizeVigilDbPath(collectionPath);
    if (!path || !isCollectionPath(path)) {
      throw new Error(`Invalid collection path: ${collectionPath}`);
    }
    const prefix = `${path}/`;
    const depth = path.split("/").filter(Boolean).length;
    const matches: string[] = [];
    for (const docPath of this.docs.keys()) {
      if (!docPath.startsWith(prefix)) continue;
      const parts = docPath.split("/").filter(Boolean);
      if (parts.length === depth + 1) matches.push(docPath);
    }
    matches.sort((a, b) => a.localeCompare(b));
    return matches.slice(0, Math.max(1, limit)).map((docPath) => ({
      id: docPath.split("/").pop() || "",
      path: docPath,
      data: structuredClone(this.docs.get(docPath) || {}),
    }));
  }

  ensureCollection(collectionPath: string): void {
    const path = normalizeVigilDbPath(collectionPath);
    if (!path || !isCollectionPath(path)) {
      throw new Error(`Invalid collection path: ${collectionPath}`);
    }
    const hasDocs = [...this.docs.keys()].some(
      (p) => p === path || p.startsWith(`${path}/`),
    );
    if (!hasDocs) {
      this.emptyCollections.add(path);
      this.touch();
    }
  }

  async toBytes(): Promise<Uint8Array> {
    const zip = new JSZip();
    this.meta.updatedAt = new Date().toISOString();
    zip.file(VIGIL_DB_META_FILE, JSON.stringify(this.meta, null, 2));
    zip.file(
      VIGIL_DB_EMPTY_COLLECTIONS_FILE,
      JSON.stringify(
        [...this.emptyCollections].sort((a, b) => a.localeCompare(b)),
        null,
        2,
      ),
    );
    const paths = [...this.docs.keys()].sort((a, b) => a.localeCompare(b));
    for (const docPath of paths) {
      zip.file(
        documentPathToZipEntry(docPath),
        JSON.stringify(this.docs.get(docPath) || {}, null, 2),
      );
    }
    const out = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    this.dirty = false;
    return out;
  }

  suggestedFileName(): string {
    return `${this.meta.name}${VIGIL_DB_EXTENSION}`;
  }

  private touch(): void {
    this.dirty = true;
    this.meta.updatedAt = new Date().toISOString();
  }
}
