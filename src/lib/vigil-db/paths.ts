export function normalizeVigilDbPath(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}

export function isDocumentPath(path: string): boolean {
  if (!path) return false;
  return path.split("/").filter(Boolean).length % 2 === 0;
}

export function isCollectionPath(path: string): boolean {
  if (!path) return false;
  return path.split("/").filter(Boolean).length % 2 === 1;
}

export function buildTenantCollectionPath(
  tenantSlug: string,
  collectionName: string,
): string {
  const slug = tenantSlug.trim();
  const name = collectionName.trim();
  if (!slug || !name) throw new Error("tenant and collection required");
  return `${slug}.${name}`;
}

export function buildDocumentPath(
  collectionPath: string,
  documentId: string,
): string {
  const col = normalizeVigilDbPath(collectionPath);
  const id = String(documentId ?? "").trim();
  if (!col || !id) throw new Error("collection and document id required");
  return `${col}/${id}`;
}
