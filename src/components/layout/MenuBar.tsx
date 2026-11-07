import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAppMenus,
  listCommands,
  matchingCommand,
  type MenuNode,
  type TopMenu,
} from "../../lib/app-menu";
import {
  collectKnownFiles,
  installAutoSave,
  installEditorHistory,
  isEditorCommand,
  onMenuMessage,
  openEditorPath,
  runCommand,
  setAboutOpener,
  setPickerOpener,
} from "../../lib/ide-commands";
import { isMacPlatform, type PressedKey } from "../../lib/menu-accel";
import { useEditorTabsStore } from "../../store/editorTabsStore";
import { useExplorerStore } from "../../store/explorerStore";
import { useLayoutStore } from "../../store/layoutStore";
import { formatUsd, useCostStore } from "../../store/costStore";

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".monaco-editor")) return false;
  return (
    target.closest(".xterm") != null ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

function MenuPanel({
  items,
  onRun,
  scroll = false,
}: {
  items: MenuNode[];
  onRun: (id: string) => void;
  scroll?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [submenu, setSubmenu] = useState<{
    index: number;
    top: number;
    left: number;
  } | null>(null);
  const openSub = items[submenu?.index ?? -1];
  return (
    <>
    <div
      role="menu"
      className={`min-w-[280px] rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] py-1 text-[13px] text-[var(--vigil-text)] shadow-[0_8px_24px_rgba(0,0,0,0.16)] ${
        scroll ? "max-h-[calc(100vh-48px)] overflow-y-auto" : ""
      }`}
    >
      {items.map((item, index) => {
        if (item.kind === "sep") {
          return (
            <div
              key={`sep-${index}`}
              className="my-1 h-px bg-[var(--vigil-border)]"
            />
          );
        }
        const disabled = item.enabled === false;
        const active = hover === index && !disabled;
        return (
          <div
            key={item.id ?? `${item.label}-${index}`}
            className="relative"
            onMouseEnter={(event) => {
              setHover(index);
              if (!item.submenu || disabled) {
                setSubmenu(null);
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              setSubmenu({ index, top: rect.top, left: rect.right - 4 });
            }}
          >
            <button
              type="button"
              role="menuitem"
              aria-disabled={disabled}
              aria-checked={item.checked || undefined}
              className={`flex w-full items-center gap-2 px-2 py-[3px] text-left ${
                disabled
                  ? "cursor-default opacity-40"
                  : active
                    ? "bg-[var(--vigil-accent)] text-white"
                    : ""
              }`}
              onClick={() => {
                if (disabled || !item.id || item.submenu) return;
                onRun(item.id);
              }}
            >
              <span className="w-4 shrink-0 text-center text-[12px]">
                {item.checked ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.shortcut && (
                <span
                  className={`shrink-0 pl-6 text-[11px] ${
                    active ? "text-white/80" : "text-[var(--vigil-muted)]"
                  }`}
                >
                  {item.shortcut}
                </span>
              )}
              {item.submenu && <span className="w-3 shrink-0 text-right">›</span>}
            </button>
          </div>
        );
      })}
    </div>
    {submenu && openSub?.kind === "item" && openSub.submenu && (
      <div
        className="fixed z-[70]"
        style={{ top: submenu.top, left: submenu.left }}
      >
        <MenuPanel items={openSub.submenu} onRun={onRun} />
      </div>
    )}
    </>
  );
}

function Picker({
  title,
  rows,
  onClose,
  onPick,
  onQuerySubmit,
}: {
  title: string;
  rows: { id: string; label: string; detail?: string }[];
  onClose: () => void;
  onPick: (id: string) => void;
  onQuerySubmit?: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const filtered = rows.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      row.label.toLowerCase().includes(q) ||
      (row.detail ?? "").toLowerCase().includes(q)
    );
  });
  const current = filtered[Math.min(index, Math.max(filtered.length - 1, 0))];

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-center bg-black/25 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        className="w-[min(560px,calc(100%-32px))] overflow-hidden rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] shadow-[0_16px_40px_rgba(0,0,0,0.2)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((value) => Math.min(value + 1, Math.max(filtered.length - 1, 0)));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((value) => Math.max(value - 1, 0));
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (current) onPick(current.id);
              else onQuerySubmit?.(query.trim());
            }
          }}
          placeholder={title}
          className="w-full border-b border-[var(--vigil-border)] bg-transparent px-3 py-2 text-[13px] outline-none"
          aria-label={title}
        />
        <div className="max-h-80 overflow-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-[var(--vigil-muted)]">
              No matches
            </div>
          )}
          {filtered.map((row, rowIndex) => (
            <button
              key={row.id}
              type="button"
              className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-[13px] ${
                row.id === current?.id
                  ? "bg-[var(--vigil-accent)] text-white"
                  : "hover:bg-[var(--vigil-hover)]"
              }`}
              onMouseEnter={() => setIndex(rowIndex)}
              onClick={() => onPick(row.id)}
            >
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.detail && (
                <span
                  className={`shrink-0 text-[11px] ${
                    row.id === current?.id ? "text-white/80" : "text-[var(--vigil-muted)]"
                  }`}
                >
                  {row.detail}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MenuBar() {
  const root = useExplorerStore((s) => s.root);
  const tabs = useEditorTabsStore((s) => s.tabs);
  const activeId = useEditorTabsStore((s) => s.activeId);
  const autoSave = useEditorTabsStore((s) => s.autoSave);
  const wordWrap = useEditorTabsStore((s) => s.wordWrap);
  const minimap = useEditorTabsStore((s) => s.minimapEnabled);
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const chatVisible = useLayoutStore((s) => s.chatVisible);
  const panelVisible = useLayoutStore((s) => s.bottomVisible);
  const session = useCostStore((s) => s.sessionTotal);
  const tokenTotal = Math.max(0, session.inputTokens) + Math.max(0, session.outputTokens);
  const usageLabel = `${tokenTotal.toLocaleString("en-US")} tokens  /  ${formatUsd(session.cost)}`;
  const [open, setOpen] = useState<string | null>(null);
  const [picker, setPicker] = useState<"commands" | "files" | null>(null);
  const [about, setAbout] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  const menus = useMemo(() => {
    void revision;
    return buildAppMenus({
      root,
      hasActiveFile: active?.mode === "file",
      canRevert:
        active?.mode === "file" &&
        active.dirty &&
        !active.path.startsWith("untitled:"),
      canSaveAll: tabs.some((tab) => tab.mode === "file" && tab.dirty),
      canCloseEditor: !!activeId,
      autoSave,
      wordWrap,
      minimap,
      sidebarVisible,
      chatVisible,
      panelVisible,
    });
  }, [
    revision,
    root,
    active,
    tabs,
    activeId,
    autoSave,
    wordWrap,
    minimap,
    sidebarVisible,
    chatVisible,
    panelVisible,
  ]);

  useEffect(() => installAutoSave(), []);
  useEffect(() => installEditorHistory(), []);
  useEffect(() => {
    setPickerOpener(setPicker);
    setAboutOpener(() => setAbout(true));
    return onMenuMessage((message) => {
      setToast(message);
      window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2400);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    const mac = isMacPlatform();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (picker || about) return;
      const pressed: PressedKey = {
        key: event.key,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        code: event.code,
      };
      const id = matchingCommand(menus, pressed, mac);
      if (!id) return;
      if (isTextField(event.target) && isEditorCommand(id)) return;
      event.preventDefault();
      setOpen(null);
      void runCommand(id).finally(() => setRevision((value) => value + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menus, picker, about]);

  function run(id: string) {
    setOpen(null);
    setPicker(null);
    void runCommand(id).finally(() => setRevision((value) => value + 1));
  }

  const commandRows = listCommands(menus)
    .filter((command) => command.enabled && !command.id.startsWith("recent:"))
    .map((command) => ({
      id: command.id,
      label: command.label,
      detail: command.shortcut,
    }));
  const fileRows = collectKnownFiles().map((file) => ({
    id: file.path,
    label: file.name,
    detail: file.path,
  }));

  return (
    <div
      ref={barRef}
      className="relative z-40 flex h-8 shrink-0 items-center border-b border-[var(--vigil-border)] bg-[var(--vigil-activity)] px-1 select-none"
      role="menubar"
      aria-label="Application menu"
    >
      {menus.map((menu) => (
        <TopMenuButton
          key={menu.id}
          menu={menu}
          open={open === menu.id}
          anyOpen={open !== null}
          onOpen={() => setOpen(menu.id)}
          onToggle={() => setOpen((current) => (current === menu.id ? null : menu.id))}
          onRun={run}
        />
      ))}
      <div
        className="ml-auto shrink-0 px-2 text-[11px] font-bold !text-[var(--vigil-text)]"
        title="Session token usage and cost"
        aria-label={usageLabel}
      >
        {usageLabel}
      </div>
      {toast && (
        <div className="pointer-events-none absolute top-10 left-1/2 z-50 -translate-x-1/2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-3 py-1.5 text-[12px] text-[var(--vigil-text)] shadow">
          {toast}
        </div>
      )}
      {picker && (
        <Picker
          title={picker === "commands" ? "Type a command" : "Go to file"}
          rows={picker === "commands" ? commandRows : fileRows}
          onClose={() => setPicker(null)}
          onPick={(id) => {
            setPicker(null);
            if (picker === "commands") run(id);
            else void openEditorPath(id).catch((err) => setToast(String(err)));
          }}
          onQuerySubmit={
            picker === "files" && root
              ? (query) => {
                  const path = query.startsWith("/") ? query : `${root.replace(/\/$/, "")}/${query}`;
                  setPicker(null);
                  void openEditorPath(path).catch((err) => setToast(String(err)));
                }
              : undefined
          }
        />
      )}
      {about && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/25"
          onMouseDown={() => setAbout(false)}
        >
          <div
            className="w-80 rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-4 shadow-lg"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="text-sm font-semibold">Vigil AI Agent</div>
            <p className="mt-1 text-[12px] text-[var(--vigil-muted)]">Version 4.0.0</p>
            <p className="mt-2 text-[12px]">Personal desktop AI coding agent.</p>
            <button
              type="button"
              className="mt-3 rounded bg-[var(--vigil-accent)] px-2 py-1 text-[12px] !text-white"
              onClick={() => setAbout(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TopMenuButton({
  menu,
  open,
  anyOpen,
  onOpen,
  onToggle,
  onRun,
}: {
  menu: TopMenu;
  open: boolean;
  anyOpen: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onRun: (id: string) => void;
}) {
  return (
    <div
      className="relative"
      onMouseEnter={() => {
        if (anyOpen && !open) onOpen();
      }}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`rounded px-2.5 py-[3px] text-[13px] ${
          open
            ? "bg-[var(--vigil-accent)] text-white"
            : "hover:bg-[var(--vigil-hover)]"
        }`}
        onClick={onToggle}
      >
        {menu.label}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 pt-0.5">
          <MenuPanel items={menu.items} onRun={onRun} scroll />
        </div>
      )}
    </div>
  );
}
