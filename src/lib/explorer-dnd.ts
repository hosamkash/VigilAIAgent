/**
 * Explorer → chat composer drag payload (HTML5 DnD).
 * WKWebView/Tauri often strips custom MIME types — always mirror into text/plain.
 */

export const VIGIL_EXPLORER_MIME = "application/x-vigil-explorer-items";
export const VIGIL_EXPLORER_PREFIX = "vigil-explorer-v1:";

export type VigilExplorerDragItem = {
  path: string;
  name: string;
  isDir: boolean;
};

export function packExplorerDragItems(items: VigilExplorerDragItem[]): string {
  return JSON.stringify(items);
}

export function unpackExplorerDragItems(raw: string): VigilExplorerDragItem[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: VigilExplorerDragItem[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const path = String((item as VigilExplorerDragItem).path ?? "").trim();
      const name = String((item as VigilExplorerDragItem).name ?? "").trim();
      if (!path) continue;
      out.push({
        path,
        name: name || path.split(/[/\\]/).pop() || path,
        isDir: Boolean((item as VigilExplorerDragItem).isDir),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function relativeWorkspaceLabel(
  absPath: string,
  workspaceRoot: string | null | undefined,
): string {
  const norm = absPath.replace(/\\/g, "/");
  const root = (workspaceRoot ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (root && (norm === root || norm.startsWith(`${root}/`))) {
    return norm === root ? "." : norm.slice(root.length + 1);
  }
  return norm.split("/").slice(-2).join("/") || norm;
}

export function setExplorerDragData(
  dataTransfer: DataTransfer,
  items: VigilExplorerDragItem[],
): void {
  if (items.length === 0) return;
  const packed = packExplorerDragItems(items);
  const plain = `${VIGIL_EXPLORER_PREFIX}${packed}`;
  try {
    dataTransfer.setData(VIGIL_EXPLORER_MIME, packed);
  } catch {
    /* custom MIME unsupported in some webviews */
  }
  try {
    dataTransfer.setData("text/plain", plain);
  } catch {
    /* ignore */
  }
  dataTransfer.effectAllowed = "copy";
}

export function readExplorerDragItems(
  dataTransfer: DataTransfer,
): VigilExplorerDragItem[] {
  try {
    const custom = dataTransfer.getData(VIGIL_EXPLORER_MIME);
    if (custom) {
      const items = unpackExplorerDragItems(custom);
      if (items.length > 0) return items;
    }
  } catch {
    /* ignore */
  }

  try {
    const plain = dataTransfer.getData("text/plain") || "";
    if (plain.startsWith(VIGIL_EXPLORER_PREFIX)) {
      return unpackExplorerDragItems(plain.slice(VIGIL_EXPLORER_PREFIX.length));
    }
  } catch {
    /* ignore */
  }

  return [];
}

export function isExplorerDrag(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types).map((t) => t.toLowerCase());
  return (
    types.includes(VIGIL_EXPLORER_MIME.toLowerCase()) ||
    types.includes("text/plain") ||
    types.includes("text")
  );
}
