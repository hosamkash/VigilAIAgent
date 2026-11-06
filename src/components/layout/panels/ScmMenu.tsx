import { useEffect, useRef, useState } from "react";
import type { ScmMenuItem } from "../../../lib/scm-menu";

export type ScmPromptRequest =
  | {
      kind: "input";
      title: string;
      placeholder?: string;
      initial?: string;
      confirm?: string;
    }
  | {
      kind: "pick";
      title: string;
      options: { id: string; label: string; detail?: string }[];
      allowCustom?: boolean;
      empty?: string;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirm?: string;
      danger?: boolean;
    };

export function ScmOverflowMenu({
  items,
  top,
  left,
  onSelect,
  onClose,
}: {
  items: ScmMenuItem[];
  top: number;
  left: number;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const openLeft = left > window.innerWidth * 0.62;

  return (
    <div ref={ref} className="fixed z-[200]" style={{ top, left }}>
      <MenuList
        items={items}
        openLeft={openLeft}
        onSelect={(id) => {
          onClose();
          onSelect(id);
        }}
      />
    </div>
  );
}

function MenuList({
  items,
  openLeft,
  onSelect,
}: {
  items: ScmMenuItem[];
  openLeft: boolean;
  onSelect: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const canScroll = items.every((item) => !item.children);

  return (
    <div
      role="menu"
      className={`min-w-[220px] rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] py-1 text-[12px] text-[var(--vigil-text)] shadow-lg ${
        canScroll ? "max-h-[70vh] overflow-auto" : ""
      }`}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="relative"
          onMouseEnter={() => {
            if (item.disabled) {
              setOpenId(null);
              return;
            }
            setOpenId(item.children ? item.id : null);
          }}
        >
          {item.separatorBefore && (
            <div className="my-1 border-t border-[var(--vigil-border)]" />
          )}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-[var(--vigil-accent)] hover:text-white disabled:opacity-40 ${
              item.danger ? "text-[var(--vigil-danger)]" : ""
            } ${openId === item.id ? "bg-[var(--vigil-accent)] text-white" : ""}`}
            onClick={() => {
              if (item.disabled) return;
              if (item.children) {
                setOpenId((current) => (current === item.id ? null : item.id));
                return;
              }
              onSelect(item.id);
            }}
          >
            <span className="w-3 shrink-0 text-[10px]">
              {item.checked ? "✓" : ""}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.children && <span className="text-[10px] opacity-70">›</span>}
          </button>
          {item.children && openId === item.id && (
            <div
              className={`absolute top-0 z-[201] ${
                openLeft ? "right-[calc(100%-6px)] pr-1" : "left-[calc(100%-6px)] pl-1"
              }`}
            >
              <MenuList
                items={item.children}
                openLeft={openLeft}
                onSelect={onSelect}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ScmPromptDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: ScmPromptRequest;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [text, setText] = useState(
    request.kind === "input" ? (request.initial ?? "") : "",
  );
  const [filter, setFilter] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const options =
    request.kind === "pick"
      ? request.options.filter((option) => {
          const q = filter.trim().toLowerCase();
          if (!q) return true;
          return (
            option.label.toLowerCase().includes(q) ||
            (option.detail ?? "").toLowerCase().includes(q)
          );
        })
      : [];

  const custom =
    request.kind === "pick" && request.allowCustom ? filter.trim() : "";
  const showCustom =
    request.kind === "pick" &&
    !!custom &&
    !request.options.some(
      (option) => option.label === custom || option.id === custom,
    );

  return (
    <div
      className="fixed inset-0 z-[220] flex items-start justify-center bg-black/35 pt-20"
      onMouseDown={onCancel}
    >
      <div
        role="dialog"
        aria-label={request.title}
        className="w-[340px] overflow-hidden rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] text-[var(--vigil-text)] shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--vigil-border)] px-3 py-2 text-[12px] font-medium">
          {request.title}
        </div>

        {request.kind === "confirm" && (
          <div className="px-3 py-3">
            <p className="text-[12px] leading-5">{request.message}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                className="rounded border border-[var(--vigil-border)] px-2 py-1 text-[12px]"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`rounded px-2 py-1 text-[12px] text-white ${
                  request.danger
                    ? "bg-[var(--vigil-danger)]"
                    : "bg-[var(--vigil-accent)]"
                }`}
                onClick={() => onConfirm("yes")}
              >
                {request.confirm ?? "OK"}
              </button>
            </div>
          </div>
        )}

        {request.kind === "input" && (
          <form
            className="px-3 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) onConfirm(text.trim());
            }}
          >
            <input
              autoFocus
              value={text}
              placeholder={request.placeholder}
              onChange={(event) => setText(event.target.value)}
              className="w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1.5 text-[12px] outline-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-[var(--vigil-border)] px-2 py-1 text-[12px]"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!text.trim()}
                className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-[12px] text-white disabled:opacity-40"
              >
                {request.confirm ?? "OK"}
              </button>
            </div>
          </form>
        )}

        {request.kind === "pick" && (
          <div className="py-1">
            <input
              autoFocus
              value={filter}
              placeholder="Filter"
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  if (showCustom) onConfirm(`commit:${custom}`);
                  else if (options[0]) onConfirm(options[0].id);
                }
              }}
              className="mx-2 mb-1 w-[calc(100%-16px)] rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-[12px] outline-none"
            />
            <div className="max-h-64 overflow-auto">
              {showCustom && (
                <PickRow
                  label={`Checkout '${custom}'`}
                  onClick={() => onConfirm(`commit:${custom}`)}
                />
              )}
              {options.map((option) => (
                <PickRow
                  key={option.id}
                  label={option.label}
                  detail={option.detail}
                  onClick={() => onConfirm(option.id)}
                />
              ))}
              {options.length === 0 && !showCustom && (
                <div className="px-3 py-2 text-[11px] text-[var(--vigil-muted)]">
                  {request.empty ?? "Nothing to show"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PickRow({
  label,
  detail,
  onClick,
}: {
  label: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] hover:bg-[var(--vigil-accent)] hover:text-white"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && (
        <span className="shrink-0 text-[10px] opacity-70">{detail}</span>
      )}
    </button>
  );
}
