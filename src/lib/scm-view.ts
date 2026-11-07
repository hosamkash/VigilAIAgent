import type { GitChange } from "./git";

export type ChangeSort = "name" | "path" | "status";
export type ChangeView = "list" | "tree";

export interface ChangeTreeDir {
  type: "dir";
  name: string;
  path: string;
  children: ChangeTreeNode[];
}

export interface ChangeTreeFile {
  type: "file";
  change: GitChange;
}

export type ChangeTreeNode = ChangeTreeDir | ChangeTreeFile;

function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function sortChanges(changes: GitChange[], sort: ChangeSort): GitChange[] {
  const copy = [...changes];
  copy.sort((a, b) => {
    if (sort === "status") {
      const byStatus = a.status.localeCompare(b.status);
      if (byStatus !== 0) return byStatus;
    }
    if (sort === "name") return baseName(a.path).localeCompare(baseName(b.path));
    return a.path.localeCompare(b.path);
  });
  return copy;
}

function compareNodes(a: ChangeTreeNode, b: ChangeTreeNode, sort: ChangeSort): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  const aName = a.type === "dir" ? a.name : baseName(a.change.path);
  const bName = b.type === "dir" ? b.name : baseName(b.change.path);
  if (sort === "status" && a.type === "file" && b.type === "file") {
    const byStatus = a.change.status.localeCompare(b.change.status);
    if (byStatus !== 0) return byStatus;
  }
  if (sort === "path" && a.type === "file" && b.type === "file") {
    return a.change.path.localeCompare(b.change.path);
  }
  return aName.localeCompare(bName);
}

export function buildChangeTree(
  changes: GitChange[],
  sort: ChangeSort = "path",
): ChangeTreeNode[] {
  const root: ChangeTreeDir = { type: "dir", name: "", path: "", children: [] };
  for (const change of changes) {
    const parts = change.path.split("/").filter(Boolean);
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = dir.children.find(
        (child): child is ChangeTreeDir =>
          child.type === "dir" && child.name === parts[i],
      );
      if (!next) {
        next = { type: "dir", name: parts[i], path, children: [] };
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push({ type: "file", change });
  }

  const sortNodes = (nodes: ChangeTreeNode[]) => {
    nodes.sort((a, b) => compareNodes(a, b, sort));
    for (const node of nodes) {
      if (node.type === "dir") sortNodes(node.children);
    }
  };
  sortNodes(root.children);
  return root.children;
}
