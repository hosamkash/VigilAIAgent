import { useEffect, useState } from "react";
import { useExplorerStore } from "../../store/explorerStore";
import { useEditorTabsStore } from "../../store/editorTabsStore";
import {
  basename,
  createDir,
  deletePath,
  listDir,
  readTextFile,
  renamePath,
  writeTextFile,
  type DirEntryInfo,
} from "../../lib/workspace-fs";
import { fileIcon } from "../../lib/file-icons";

function TreeNode({
  entry,
  depth,
}: {
  entry: DirEntryInfo;
  depth: number;
}) {
  const { expanded, children, selectedPath, toggleExpand, selectPath, refresh } =
    useExplorerStore();
  const openFile = useEditorTabsStore((s) => s.openFile);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const open = !!expanded[entry.path];
  const kids = children[entry.path] ?? [];

  async function onOpen() {
    selectPath(entry.path);
    if (entry.isDir) {
      await toggleExpand(entry.path);
      return;
    }
    try {
      const content = await readTextFile(entry.path);
      openFile({ path: entry.path, content });
    } catch (err) {
      console.error(err);
    }
  }

  async function onNew(kind: "file" | "folder") {
    setMenu(null);
    const name = window.prompt(`New ${kind} name`);
    if (!name) return;
    const parent = entry.isDir ? entry.path : entry.path.replace(/[/\\][^/\\]+$/, "");
    const target = `${parent}/${name}`;
    if (kind === "folder") await createDir(target);
    else await writeTextFile(target, "");
    await refresh(parent);
  }

  async function onRename() {
    setMenu(null);
    const name = window.prompt("Rename to", entry.name);
    if (!name || name === entry.name) return;
    const parent = entry.path.replace(/[/\\][^/\\]+$/, "");
    await renamePath(entry.path, `${parent}/${name}`);
    await refresh(parent);
  }

  async function onDelete() {
    setMenu(null);
    if (!window.confirm(`Delete ${entry.name}?`)) return;
    const parent = entry.path.replace(/[/\\][^/\\]+$/, "");
    await deletePath(entry.path);
    await refresh(parent);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void onOpen()}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className={`flex w-full items-center gap-1 truncate px-1 py-[2px] text-left text-[12px] ${
          selectedPath === entry.path
            ? "bg-[var(--vigil-selection)] text-[var(--vigil-text)]"
            : "hover:bg-[var(--vigil-hover)]"
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <span className="w-3 shrink-0 text-[10px] text-[var(--vigil-muted)]">
          {entry.isDir ? (open ? "▾" : "▸") : ""}
        </span>
        <span className="truncate">
          <span className="mr-1" aria-hidden>
            {fileIcon(entry.name, entry.isDir)}
          </span>
          {entry.name}
        </span>
      </button>
      {entry.isDir && open &&
        kids.map((child) => (
          <TreeNode key={child.path} entry={child} depth={depth + 1} />
        ))}
      {menu && (
        <div
          className="fixed z-50 min-w-[140px] rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] py-1 text-xs shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onMouseLeave={() => setMenu(null)}
        >
          <button type="button" className="block w-full px-3 py-1 text-left hover:bg-[var(--vigil-hover)]" onClick={() => void onNew("file")}>New File</button>
          <button type="button" className="block w-full px-3 py-1 text-left hover:bg-[var(--vigil-hover)]" onClick={() => void onNew("folder")}>New Folder</button>
          <button type="button" className="block w-full px-3 py-1 text-left hover:bg-[var(--vigil-hover)]" onClick={() => void onRename()}>Rename</button>
          <button type="button" className="block w-full px-3 py-1 text-left hover:bg-[var(--vigil-hover)]" onClick={() => void navigator.clipboard.writeText(entry.path)}>Copy Path</button>
          <button type="button" className="block w-full px-3 py-1 text-left text-[var(--vigil-danger)] hover:bg-[var(--vigil-hover)]" onClick={() => void onDelete()}>Delete</button>
        </div>
      )}
    </div>
  );
}

export function FileExplorer() {
  const { root, extraRoots, children, init, loading, error } = useExplorerStore();

  useEffect(() => {
    void init();
  }, [init]);

  const roots = root ? [root, ...extraRoots] : [];
  const openLauncher = useExplorerStore((s) => s.openLauncher);

  if (!root) {
    return (
      <div className="flex h-full flex-col p-3 text-xs">
        <div className="mb-2 font-semibold uppercase text-[var(--vigil-muted)]">Explorer</div>
        <p className="mb-3 text-[var(--vigil-text)]">No project is open.</p>
        <button
          type="button"
          className="rounded bg-[var(--vigil-accent)] px-2 py-1 !text-white"
          onClick={openLauncher}
        >
          Open the start screen
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col text-[var(--vigil-text)]">
      <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--vigil-muted)]">
        <span>Explorer{roots.length === 1 ? `: ${basename(roots[0]!)}` : ""}</span>
        <button type="button" className="hover:text-[var(--vigil-text)]" onClick={() => void init()} title="Refresh">
          ↻
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {loading && <div className="px-3 text-xs text-[var(--vigil-muted)]">Loading…</div>}
        {error && <div className="px-3 text-xs text-[var(--vigil-danger)]">{error}</div>}
        {!loading && !error && roots.every((path) => (children[path] ?? []).length === 0) && (
          <div className="px-3 text-xs text-[var(--vigil-muted)]">Empty workspace</div>
        )}
        {roots.map((path) => (
          <div key={path}>
            {roots.length > 1 && (
              <div className="px-3 py-1 text-[11px] font-semibold text-[var(--vigil-muted)]">
                {basename(path)}
              </div>
            )}
            {(children[path] ?? []).map((entry) => (
              <TreeNode key={entry.path} entry={entry} depth={0} />
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--vigil-border)] px-3 py-2 text-[10px] text-[var(--vigil-muted)]">
        <div className="mb-1 font-semibold uppercase">Outline</div>
        <div>No symbols</div>
        <div className="mt-2 mb-1 font-semibold uppercase">Timeline</div>
        <div>Local history coming soon</div>
      </div>
    </div>
  );
}

export async function prefetchRoot() {
  const store = useExplorerStore.getState();
  if (!store.root) await store.init();
  if (store.root && !store.children[store.root]) {
    const entries = await listDir(store.root);
    useExplorerStore.setState((s) => ({
      children: { ...s.children, [store.root!]: entries },
    }));
  }
}
