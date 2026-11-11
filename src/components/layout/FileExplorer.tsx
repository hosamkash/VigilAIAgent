import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExplorerStore } from "../../store/explorerStore";
import { useEditorTabsStore } from "../../store/editorTabsStore";
import { useGitDecorationStore } from "../../store/gitDecorationStore";
import { notify } from "../../lib/ide-commands";
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
import type { ExplorerGitDecoration } from "../../lib/git-explorer-decorations";
import {
  isComposerUnderPoint,
  useExplorerDragStore,
} from "../../lib/explorer-drag-session";
import { useComposerContextStore } from "../../store/composerContextStore";
import { useWorkspaceIndexStore } from "../../store/workspaceIndexStore";
import { openAndRevealFile } from "../../lib/open-workspace-file";

function gitColorVar(kind: ExplorerGitDecoration["kind"]): string {
  return `var(--vigil-git-${kind})`;
}

type CreateDraft = { kind: "create-file" | "create-folder"; parent: string };
type RenameDraft = { kind: "rename"; path: string; parent: string; initial: string };
type Draft = CreateDraft | RenameDraft;
type MenuState = { x: number; y: number; entry: DirEntryInfo };

function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? normalized : normalized.slice(0, index);
}

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, "")}/${name}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function writeClipboard(text: string) {
  const pending = navigator.clipboard?.writeText(text);
  if (pending) {
    const copied = await Promise.race([
      pending.then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 400)),
    ]);
    if (copied) return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("Couldn't copy the path.");
}

async function ensureOpen(path: string) {
  const state = useExplorerStore.getState();
  if (state.expanded[path] && state.children[path]) return;
  if (!state.expanded[path]) {
    await state.toggleExpand(path);
    return;
  }
  const entries = await listDir(path);
  useExplorerStore.setState((current) => ({
    children: { ...current.children, [path]: entries },
    expanded: { ...current.expanded, [path]: true },
  }));
}

function NameField({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function finish(value: string, forceCancel = false) {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    if (forceCancel || !name || name === initial) onCancel();
    else onCommit(name);
  }

  return (
    <input
      ref={ref}
      defaultValue={initial}
      placeholder={placeholder}
      aria-label={placeholder}
      className="min-w-0 flex-1 select-text rounded-sm bg-[var(--vigil-bg)] px-1 text-[12px] text-[var(--vigil-text)] outline outline-1 outline-[var(--vigil-accent)]"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish("", true);
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}

function DraftRow({
  depth,
  placeholder,
  initial,
  onCommit,
  onCancel,
}: {
  depth: number;
  placeholder: string;
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1 px-1 py-[2px]"
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <span className="w-3 shrink-0" />
      <NameField
        initial={initial}
        placeholder={placeholder}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

function ExplorerMenu({
  menu,
  onClose,
  onNewFile,
  onNewFolder,
  onAddToChat,
  onRename,
  onCopyPath,
  onDelete,
}: {
  menu: MenuState;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onAddToChat: () => void;
  onRename: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  const items = [
    { label: "Add to Chat", run: onAddToChat },
    { label: "New File", run: onNewFile },
    { label: "New Folder", run: onNewFolder },
    { label: "Rename", run: onRename },
    { label: "Copy Path", run: onCopyPath },
    { label: "Delete", run: onDelete, danger: true },
  ];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const timer = window.setTimeout(() => {
      window.addEventListener("mousedown", onPointer);
      window.addEventListener("keydown", onKey);
      window.addEventListener("resize", onClose);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Folder actions"
      className="fixed z-[80] min-w-[180px] rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] py-1 text-[12px] text-[var(--vigil-text)] shadow-lg select-none"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`block w-full px-3 py-1.5 text-left hover:bg-[var(--vigil-hover)] ${
            item.danger ? "text-[var(--vigil-danger)]" : ""
          }`}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function TreeNode({
  entry,
  depth,
  draft,
  onOpenMenu,
  onCommitCreate,
  onCommitRename,
  onCancelDraft,
}: {
  entry: DirEntryInfo;
  depth: number;
  draft: Draft | null;
  onOpenMenu: (entry: DirEntryInfo, x: number, y: number) => void;
  onCommitCreate: (parent: string, kind: "file" | "folder", name: string) => void;
  onCommitRename: (entry: DirEntryInfo, name: string) => void;
  onCancelDraft: () => void;
}) {
  const { expanded, children, selectedPath, toggleExpand, selectPath } = useExplorerStore();
  const openFile = useEditorTabsStore((s) => s.openFile);
  const deco = useGitDecorationStore((s) => s.byPath[entry.path]);
  const open = !!expanded[entry.path];
  const kids = children[entry.path] ?? [];
  const renaming = draft?.kind === "rename" && draft.path === entry.path;
  const creatingHere =
    entry.isDir &&
    open &&
    draft !== null &&
    draft.kind !== "rename" &&
    draft.parent === entry.path;
  const gitStyle = deco ? { color: gitColorVar(deco.kind) } : undefined;

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
      notify(errorText(err));
    }
  }

  return (
    <div>
      {renaming ? (
        <div
          className="flex items-center gap-1 bg-[var(--vigil-selection)] px-1 py-[2px] text-[12px]"
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <span className="w-3 shrink-0 text-[10px] text-[var(--vigil-muted)]">
            {entry.isDir ? (open ? "▾" : "▸") : ""}
          </span>
          <span className="mr-1" aria-hidden>
            {fileIcon(entry.name, entry.isDir)}
          </span>
          <NameField
            initial={draft.initial}
            placeholder="New name"
            onCommit={(name) => onCommitRename(entry, name)}
            onCancel={onCancelDraft}
          />
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          data-explorer-path={entry.path}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            // Keep native click for open; start a pointer-drag session.
            const item = {
              path: entry.path,
              name: entry.name,
              isDir: entry.isDir,
            };
            useExplorerDragStore.getState().beginPointer(
              [item],
              event.clientX,
              event.clientY,
            );

            const onMove = (ev: PointerEvent) => {
              const drag = useExplorerDragStore.getState();
              // Once past the threshold, kill browser text-selection gestures.
              if (
                drag.dragging ||
                Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) >= 5
              ) {
                ev.preventDefault();
              }
              drag.movePointer(
                ev.clientX,
                ev.clientY,
                isComposerUnderPoint(ev.clientX, ev.clientY),
              );
            };

            const onUp = (ev: PointerEvent) => {
              window.removeEventListener("pointermove", onMove, true);
              window.removeEventListener("pointerup", onUp, true);
              window.removeEventListener("pointercancel", onUp, true);
              const drag = useExplorerDragStore.getState();
              const wasDragging = drag.dragging;
              const items = drag.endPointer();
              if (!wasDragging) {
                // Treated as a click — open the entry.
                void onOpen();
                return;
              }
              ev.preventDefault();
              if (items.length === 0) return;
              const root = useExplorerStore.getState().root;
              const added = useComposerContextStore
                .getState()
                .addExplorerItems(items, root);
              if (added > 0) {
                notify(
                  added === 1
                    ? `Added @${items[0]!.name} to chat`
                    : `Added ${added} paths to chat`,
                );
              }
            };

            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onUp, true);
          }}
          onMouseDown={(event) => {
            if (event.button === 2) event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void onOpen();
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            window.getSelection()?.removeAllRanges();
            onOpenMenu(entry, event.clientX, event.clientY);
          }}
          className={`flex w-full cursor-grab items-center gap-1 truncate px-1 py-[2px] text-left text-[12px] select-none active:cursor-grabbing ${
            selectedPath === entry.path
              ? "bg-[var(--vigil-selection)]"
              : "hover:bg-[var(--vigil-hover)]"
          } ${deco ? "" : "text-[var(--vigil-text)]"}`}
          style={{ paddingLeft: 8 + depth * 12, ...gitStyle }}
          title={
            deco
              ? `${entry.name} · ${deco.letter === "N" ? "New" : deco.letter === "M" ? "Modified" : deco.letter}`
              : "Drag into chat to mention this path"
          }
        >
          <span
            className={`w-3 shrink-0 text-[10px] ${deco ? "" : "text-[var(--vigil-muted)]"}`}
            style={gitStyle}
          >
            {entry.isDir ? (open ? "▾" : "▸") : ""}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="mr-1" aria-hidden>
              {fileIcon(entry.name, entry.isDir)}
            </span>
            {entry.name}
          </span>
          {deco && (
            <span
              className="ml-1 shrink-0 font-mono text-[10px] font-semibold tracking-wide"
              style={gitStyle}
              aria-label={deco.letter === "N" ? "New" : deco.letter}
            >
              {deco.letter}
            </span>
          )}
        </div>
      )}
      {creatingHere && (
        <DraftRow
          depth={depth + 1}
          initial=""
          placeholder={draft.kind === "create-folder" ? "Folder name" : "File name"}
          onCommit={(name) =>
            onCommitCreate(entry.path, draft.kind === "create-folder" ? "folder" : "file", name)
          }
          onCancel={onCancelDraft}
        />
      )}
      {entry.isDir &&
        open &&
        kids.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            draft={draft}
            onOpenMenu={onOpenMenu}
            onCommitCreate={onCommitCreate}
            onCommitRename={onCommitRename}
            onCancelDraft={onCancelDraft}
          />
        ))}
    </div>
  );
}

export function FileExplorer() {
  const { root, extraRoots, children, init, loading, error, selectPath, refresh, selectedPath } =
    useExplorerStore();
  const openFile = useEditorTabsStore((s) => s.openFile);
  const setGitRoot = useGitDecorationStore((s) => s.setRoot);
  const refreshGitDeco = useGitDecorationStore((s) => s.refresh);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const openLauncher = useExplorerStore((s) => s.openLauncher);
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    setGitRoot(root);
    return () => setGitRoot(null);
  }, [root, setGitRoot]);

  useEffect(() => {
    if (!selectedPath) return;
    const el = document.querySelector(
      `[data-explorer-path="${CSS.escape(selectedPath)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedPath, children, root]);

  const beginCreate = useCallback(async (entry: DirEntryInfo, kind: "file" | "folder") => {
    setMenu(null);
    const parent = entry.isDir ? entry.path : parentPath(entry.path);
    selectPath(entry.path);
    try {
      await ensureOpen(parent);
      setDraft({ kind: kind === "file" ? "create-file" : "create-folder", parent });
    } catch (err) {
      notify(errorText(err));
    }
  }, [selectPath]);

  const beginRename = useCallback((entry: DirEntryInfo) => {
    setMenu(null);
    selectPath(entry.path);
    setDraft({
      kind: "rename",
      path: entry.path,
      parent: parentPath(entry.path),
      initial: entry.name,
    });
  }, [selectPath]);

  const commitCreate = useCallback(async (parent: string, kind: "file" | "folder", name: string) => {
    setDraft(null);
    if (name.includes("/") || name.includes("\\")) {
      notify("Name can't include a slash.");
      return;
    }
    const target = joinPath(parent, name);
    try {
      if (kind === "folder") await createDir(target);
      else await writeTextFile(target, "");
      await refresh(parent);
      void refreshGitDeco();
      selectPath(target);
      if (kind === "file") openFile({ path: target, content: "" });
      notify(kind === "folder" ? `Created folder ${name}` : `Created file ${name}`);
    } catch (err) {
      notify(errorText(err));
    }
  }, [openFile, refresh, refreshGitDeco, selectPath]);

  const commitRename = useCallback(async (entry: DirEntryInfo, name: string) => {
    setDraft(null);
    if (name.includes("/") || name.includes("\\")) {
      notify("Name can't include a slash.");
      return;
    }
    const parent = parentPath(entry.path);
    const target = joinPath(parent, name);
    try {
      await renamePath(entry.path, target);
      useExplorerStore.setState((current) => {
        const expanded = { ...current.expanded };
        const nextChildren = { ...current.children };
        if (entry.path in expanded) {
          expanded[target] = expanded[entry.path]!;
          delete expanded[entry.path];
        }
        if (entry.path in nextChildren) {
          nextChildren[target] = nextChildren[entry.path]!;
          delete nextChildren[entry.path];
        }
        return { expanded, children: nextChildren, selectedPath: target };
      });
      await refresh(parent);
      void refreshGitDeco();
      notify(`Renamed to ${name}`);
    } catch (err) {
      notify(errorText(err));
    }
  }, [refresh, refreshGitDeco]);

  const copyEntryPath = useCallback(async (entry: DirEntryInfo) => {
    setMenu(null);
    selectPath(entry.path);
    try {
      await writeClipboard(entry.path);
      notify("Copied path");
    } catch (err) {
      notify(errorText(err));
    }
  }, [selectPath]);

  const deleteEntry = useCallback(async (entry: DirEntryInfo) => {
    setMenu(null);
    selectPath(entry.path);
    const kind = entry.isDir ? "folder" : "file";
    if (!window.confirm(`Delete ${kind} "${entry.name}"?`)) return;
    const parent = parentPath(entry.path);
    try {
      await deletePath(entry.path);
      const selected = useExplorerStore.getState().selectedPath;
      if (
        selected === entry.path ||
        (selected?.startsWith(`${entry.path}/`) ?? false)
      ) {
        selectPath(null);
      }
      await refresh(parent);
      void refreshGitDeco();
      notify(`Deleted ${entry.name}`);
    } catch (err) {
      notify(errorText(err));
    }
  }, [refresh, refreshGitDeco, selectPath]);

  const roots = root ? [root, ...extraRoots] : [];

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
      <div className="flex items-center justify-between py-2 pr-14 pl-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--vigil-muted)]">
        <span className="min-w-0 truncate">Explorer{roots.length === 1 ? `: ${basename(roots[0]!)}` : ""}</span>
        <button type="button" className="shrink-0 px-1 hover:text-[var(--vigil-text)]" onClick={() => void init()} title="Refresh">
          ↻
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto pb-2 select-none"
        onScroll={closeMenu}
        onMouseDown={() => {
          if (menu) setMenu(null);
        }}
      >
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
            {draft && draft.kind !== "rename" && draft.parent === path && (
              <DraftRow
                depth={0}
                initial=""
                placeholder={draft.kind === "create-folder" ? "Folder name" : "File name"}
                onCommit={(name) =>
                  void commitCreate(path, draft.kind === "create-folder" ? "folder" : "file", name)
                }
                onCancel={() => setDraft(null)}
              />
            )}
            {(children[path] ?? []).map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                draft={draft}
                onOpenMenu={(target, x, y) => {
                  window.getSelection()?.removeAllRanges();
                  selectPath(target.path);
                  setDraft(null);
                  setMenu({ x, y, entry: target });
                }}
                onCommitCreate={(parent, kind, name) => void commitCreate(parent, kind, name)}
                onCommitRename={(target, name) => void commitRename(target, name)}
                onCancelDraft={() => setDraft(null)}
              />
            ))}
          </div>
        ))}
      </div>
      <OutlinePanel />
      {menu && (
        <ExplorerMenu
          menu={menu}
          onClose={closeMenu}
          onAddToChat={() => {
            setMenu(null);
            const entry = menu.entry;
            const added = useComposerContextStore.getState().addExplorerItems(
              [
                {
                  path: entry.path,
                  name: entry.name,
                  isDir: entry.isDir,
                },
              ],
              useExplorerStore.getState().root,
            );
            if (added > 0) notify(`Added @${entry.name} to chat`);
          }}
          onNewFile={() => void beginCreate(menu.entry, "file")}
          onNewFolder={() => void beginCreate(menu.entry, "folder")}
          onRename={() => beginRename(menu.entry)}
          onCopyPath={() => void copyEntryPath(menu.entry)}
          onDelete={() => void deleteEntry(menu.entry)}
        />
      )}
    </div>
  );
}

function OutlinePanel() {
  const activeId = useEditorTabsStore((s) => s.activeId);
  const tabs = useEditorTabsStore((s) => s.tabs);
  const indexing = useWorkspaceIndexStore((s) => s.indexing);
  const symbolsForPath = useWorkspaceIndexStore((s) => s.symbolsForPath);
  const active = tabs.find((t) => t.id === activeId);
  const path = active?.mode === "file" ? active.path : null;
  const symbols = path ? symbolsForPath(path).slice(0, 40) : [];

  return (
    <div className="border-t border-[var(--vigil-border)] px-3 py-2 text-[10px] text-[var(--vigil-muted)]">
      <div className="mb-1 font-semibold uppercase">Outline</div>
      {!path ? (
        <div>Open a file to see symbols</div>
      ) : indexing && symbols.length === 0 ? (
        <div>Indexing…</div>
      ) : symbols.length === 0 ? (
        <div>No symbols</div>
      ) : (
        <ul className="max-h-28 space-y-0.5 overflow-auto">
          {symbols.map((sym) => (
            <li key={`${sym.path}:${sym.line}:${sym.name}`}>
              <button
                type="button"
                className="block w-full truncate text-left text-[var(--vigil-text)] hover:text-[var(--vigil-accent)]"
                title={`${sym.kind} · L${sym.line}`}
                onClick={() =>
                  void openAndRevealFile(sym.path, { revealLine: sym.line })
                }
              >
                <span className="text-[var(--vigil-muted)]">{sym.kind} </span>
                {sym.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 mb-1 font-semibold uppercase">Timeline</div>
      <div>Local history coming soon</div>
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
