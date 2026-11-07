import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  useChatStore,
  type ChatEditedFile,
  type ChatImageAttachment,
  type ChatMessage,
} from "../store/chatStore";
import { useEditorTabsStore } from "../store/editorTabsStore";
import { findChatByRequestId, useTabsStore, type ChatTab } from "../store/tabsStore";
import { useCostStore } from "../store/costStore";
import { useTerminalStore } from "../store/terminalStore";
import { CHAT_MODEL_OPTIONS, chatModelLabel, routeTask } from "../lib/model-router";
import { runVigilTask, withAbort } from "../lib/cline-engine";
import { formatUsageLine, type UsageSnapshot } from "../lib/cost";
import { AgentTextStream } from "../lib/agent-stream";
import {
  COMPOSER_MAX_IMAGES,
  compressImageDataUrl,
  enrichPromptWithImageAnalysis,
} from "../lib/gemini-multimodal";
import { useNativeLiveDictation } from "../lib/hooks/useNativeLiveDictation";
import { useSpeechDictation } from "../lib/hooks/useSpeechDictation";
import { SpeechDictationMicButton } from "./SpeechDictationMicButton";
import { MessageVoiceBar } from "./MessageVoiceBar";
import { ChatQuickSettingsButton } from "./ChatQuickSettings";
import { MarkdownMessage } from "./MarkdownMessage";
import { EditedFilesList } from "./EditedFilesList";
import { ClipShelfButton } from "./ClipShelfButton";
import { buildReplyStyleInstruction } from "../lib/chat-preferences";
import { setClipImageSink, useClipShelf } from "../lib/clip-shelf";
import {
  backfillChatTabTitles,
  displayChatTitle,
  nameChatTabFromFirstMessage,
} from "../lib/chat-tab-title";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  History,
  Paperclip,
  Pencil,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { useLayoutStore } from "../store/layoutStore";
import { notify } from "../lib/ide-commands";
import { listCheckpointIds, restoreCheckpoint } from "../lib/checkpoints";
import {
  formatProjectRulesForAgent,
  readProjectRules,
} from "../lib/project-rules";
import { getWorkspaceCwd } from "../lib/secure-storage";
import { resolveWorkspacePath } from "../lib/open-workspace-file";
import { useExplorerStore } from "../store/explorerStore";
import { attachReferencedChats } from "../lib/chat-reference";
import {
  detectBrowserOpenIntent,
  extractPreviewUrls,
  isPureBrowserOpenRequest,
} from "../lib/browser-intent";
import { detectProjectPreviewUrl } from "../lib/project-url";
import {
  formatComposerChipLabels,
  formatComposerContext,
  useComposerContextStore,
} from "../store/composerContextStore";
import { useExplorerDragStore } from "../lib/explorer-drag-session";
import { openAndRevealFile } from "../lib/open-workspace-file";
import { PaneToggleButton } from "./layout/PaneToggleButton";

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

type QueuedTurn = {
  id: string;
  tabId: string;
  promptBase: string;
  userVisible: string;
  otherNote: string;
  displayImages: ChatImageAttachment[];
  attachments: Attachment[];
  modelChoice: string;
};

type Attachment = {
  id: string;
  name: string;
  kind: "file" | "image" | "video" | "folder";
  preview?: string;
  mimeType?: string;
};

function ImageLightbox({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <img
        src={src}
        alt="Preview"
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function ImageStrip({
  images,
  onRemove,
  onOpen,
  removable,
}: {
  images: { id: string; src: string; name?: string }[];
  onRemove?: (id: string) => void;
  onOpen: (src: string) => void;
  removable?: boolean;
}) {
  if (images.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {images.map((img) => (
        <div key={img.id} className="group relative">
          <button
            type="button"
            title={img.name ?? "Open preview"}
            className="block overflow-hidden rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-editor)]"
            onClick={() => onOpen(img.src)}
          >
            <img
              src={img.src}
              alt={img.name ?? ""}
              className="h-16 w-16 object-cover transition group-hover:opacity-90 sm:h-20 sm:w-20"
            />
          </button>
          {removable && onRemove && (
            <button
              type="button"
              aria-label="Remove image"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--vigil-border)] bg-[var(--vigil-panel)] text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
              onClick={() => onRemove(img.id)}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

type ChatTurn = {
  id: string;
  user: ChatMessage;
  replies: ChatMessage[];
};

type TurnFold = {
  mode: "all-open" | "all-closed";
  except: string[];
};

function groupChatTurns(messages: ChatMessage[]): {
  leading: ChatMessage[];
  turns: ChatTurn[];
} {
  const leading: ChatMessage[] = [];
  const turns: ChatTurn[] = [];
  let current: ChatTurn | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      current = { id: message.id, user: message, replies: [] };
      turns.push(current);
    } else if (current) {
      current.replies.push(message);
    } else {
      leading.push(message);
    }
  }
  return { leading, turns };
}

function turnIsOpen(fold: TurnFold, id: string): boolean {
  const listed = fold.except.includes(id);
  return fold.mode === "all-open" ? !listed : listed;
}

function previewText(message: ChatMessage): string {
  const text = message.content.replace(/\s+/g, " ").trim();
  if (text) return text;
  if (message.images && message.images.length > 0) {
    return message.images.length === 1 ? "Image" : `${message.images.length} images`;
  }
  return "Message";
}

function messageTooltip(message: ChatMessage): string {
  const text = message.content.trim();
  return text || previewText(message);
}

async function copyMessageText(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;
  const pending = navigator.clipboard?.writeText(value);
  if (pending) {
    const copied = await Promise.race([
      pending.then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 400)),
    ]);
    if (copied) {
      useClipShelf.getState().add(value);
      return true;
    }
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (copied) useClipShelf.getState().add(value);
  return copied;
}

function ChatMessageView({
  message,
  running,
  onStop,
  onOpenImage,
  onCollapse,
  onUndo,
  onEdit,
}: {
  message: ChatMessage;
  running: boolean;
  onStop: () => void;
  onOpenImage: (src: string) => void;
  onCollapse?: () => void;
  /** User-message undo — restore files to the checkpoint before this turn. */
  onUndo?: () => void;
  /** Put this user message back into the composer for editing. */
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = message.content.trim();
  const showToolbar =
    message.modelLabel ||
    text ||
    running ||
    onCollapse ||
    (message.role === "user" && (onUndo || onEdit));
  return (
    <div
      className={`rounded px-3 py-2 text-sm leading-relaxed ${
        message.role === "user"
          ? "ml-6 bg-[var(--vigil-accent-soft)]"
          : "mr-2 border border-[var(--vigil-border)] bg-[var(--vigil-editor)]"
      }`}
    >
      <MessageVoiceBar messageId={message.id} text={message.content}>
        {({ button: voiceButton, panel: voicePanel }) => (
          <>
            {showToolbar && (
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-0.5">
                  {message.modelLabel ? (
                    <span className="min-w-0 truncate text-[11px] font-medium text-[var(--vigil-accent)]">
                      {chatModelLabel(message.modelLabel)}
                    </span>
                  ) : null}
                  {text && (
                    <button
                      type="button"
                      title={copied ? "Copied" : "Copy"}
                      aria-label={copied ? "Copied" : "Copy message"}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded !text-[var(--vigil-accent)] hover:bg-[var(--vigil-hover)]"
                      onClick={() => {
                        void copyMessageText(message.content).then((ok) => {
                          if (!ok) return;
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1500);
                        });
                      }}
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </button>
                  )}
                  {text ? voiceButton : null}
                  {message.role === "user" && onEdit && (
                    <button
                      type="button"
                      title="Edit — put this message back in the composer"
                      aria-label="Edit message"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded !text-[var(--vigil-accent)] hover:bg-[var(--vigil-hover)]"
                      onClick={onEdit}
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                  {message.role === "user" && onUndo && (
                    <button
                      type="button"
                      title="تراجع — يرجع الملفات لحالة قبل الرسالة دي"
                      aria-label="تراجع"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded !text-blue-500 hover:bg-[var(--vigil-hover)] hover:!text-blue-600"
                      onClick={onUndo}
                    >
                      <Undo2 className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {running && (
                    <button
                      type="button"
                      title="Stop this command"
                      aria-label="Stop this command"
                      className="inline-flex items-center gap-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-1.5 py-0.5 normal-case tracking-normal text-[var(--vigil-danger)] hover:bg-[var(--vigil-hover)]"
                      onClick={onStop}
                    >
                      <Square className="h-2.5 w-2.5 fill-current" />
                      Stop
                    </button>
                  )}
                  {onCollapse && (
                    <button
                      type="button"
                      className="flex h-6 w-6 items-center justify-center rounded text-[var(--vigil-muted)] hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
                      onClick={onCollapse}
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </span>
              </div>
            )}
            {voicePanel}
            {message.role === "user" && message.images && message.images.length > 0 && (
              <ImageStrip
                images={message.images.map((img) => ({
                  id: img.id,
                  src: img.dataUrl,
                  name: img.name,
                }))}
                onOpen={onOpenImage}
              />
            )}
            {message.role === "assistant" ? (
              <>
                <MarkdownMessage content={message.content} />
                {message.editedFiles && message.editedFiles.length > 0 ? (
                  <EditedFilesList files={message.editedFiles} />
                ) : null}
              </>
            ) : (
              <div className="whitespace-pre-wrap" dir="auto" style={{ unicodeBidi: "plaintext" }}>
                {message.content}
              </div>
            )}
          </>
        )}
      </MessageVoiceBar>
    </div>
  );
}

function ModelSelect() {
  const value = useChatStore((s) => s.preferredProvider);
  const setPreferredProvider = useChatStore((s) => s.setPreferredProvider);
  const selected = CHAT_MODEL_OPTIONS.some((item) => item.id === value) ? value : "auto";
  return (
    <select
      aria-label="Model"
      className="h-7 max-w-[8.75rem] shrink-0 truncate rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-1.5 text-[11px] normal-case tracking-normal !text-[var(--vigil-text)]"
      value={selected}
      onChange={(event) => setPreferredProvider(event.target.value)}
    >
      {CHAT_MODEL_OPTIONS.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

type TabMenuState = { x: number; y: number; tabId: string };

async function copyRequestId(id: string) {
  const pending = navigator.clipboard?.writeText(id);
  if (pending) {
    const copied = await Promise.race([
      pending.then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 400)),
    ]);
    if (copied) {
      notify("Copied request ID");
      return;
    }
  }
  const area = document.createElement("textarea");
  area.value = id;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  notify(copied ? "Copied request ID" : "Couldn't copy the request ID");
}

function ChatTabMenu({
  menu,
  canCloseOthers,
  onClose,
  onRename,
  onCopyRequest,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
}: {
  menu: TabMenuState;
  canCloseOthers: boolean;
  onClose: () => void;
  onRename: () => void;
  onCopyRequest: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  const items = [
    { label: "Rename", run: onRename },
    { label: "Copy Request ID", run: onCopyRequest },
    { label: "Close", run: onCloseTab, separated: true },
    { label: "Close Others", run: onCloseOthers, disabled: !canCloseOthers },
    { label: "Close All", run: onCloseAll },
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
    const onKey = (event: { key: string }) => {
      if (event.key === "Escape") onClose();
    };
    const timer = window.setTimeout(() => {
      window.addEventListener("mousedown", onPointer);
      window.addEventListener("keydown", onKey);
      window.addEventListener("resize", onClose);
      window.addEventListener("scroll", onClose, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Chat tab actions"
      className="fixed z-[80] min-w-[180px] rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] py-1 text-[12px] text-[var(--vigil-text)] shadow-lg select-none"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={`block w-full px-3 py-1.5 text-left hover:bg-[var(--vigil-hover)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${
            item.separated ? "mt-1 border-t border-[var(--vigil-border)] pt-2" : ""
          }`}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (item.disabled) return;
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

function ChatTabBar({
  tabs,
  history,
  activeTabId,
  onActivate,
  onRestore,
  onClose,
  onCloseOthers,
  onCloseAll,
  onRename,
  onNew,
  turnsFolded,
  onToggleTurns,
}: {
  tabs: ChatTab[];
  history: ChatTab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
  onRename: (id: string, title: string) => void;
  onNew: () => void;
  turnsFolded: boolean;
  onToggleTurns: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("");
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [historyPos, setHistoryPos] = useState({ top: 0, right: 8 });
  const historyBtnRef = useRef<HTMLButtonElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const historyFilterRef = useRef<HTMLInputElement>(null);
  const filterQuery = historyFilter.trim().toLowerCase();
  const filteredHistory = filterQuery
    ? history.filter((tab) =>
        displayChatTitle(tab.title).toLowerCase().includes(filterQuery),
      )
    : history;

  function placeHistoryMenu() {
    const button = historyBtnRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const menuHeight = historyMenuRef.current?.offsetHeight ?? 160;
    const right = Math.max(8, window.innerWidth - rect.right);
    let top = rect.bottom + 4;
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuHeight - 4);
    }
    setHistoryPos({ top, right });
  }

  useLayoutEffect(() => {
    if (!menuOpen) return;
    placeHistoryMenu();
    const frame = window.requestAnimationFrame(() => placeHistoryMenu());
    return () => window.cancelAnimationFrame(frame);
  }, [menuOpen, history.length, filteredHistory.length, historyFilter]);

  useEffect(() => {
    if (!menuOpen) {
      setHistoryFilter("");
      return;
    }
    const timer = window.setTimeout(() => historyFilterRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (historyBtnRef.current?.contains(target)) return;
      if (historyMenuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (event: { key: string }) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onResize = () => setMenuOpen(false);
    const timer = window.setTimeout(() => {
      window.addEventListener("mousedown", close);
      window.addEventListener("keydown", onKey);
      window.addEventListener("resize", onResize);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  return (
    <div className="flex h-11 min-w-0 items-stretch gap-1 overflow-hidden border-b border-[var(--vigil-border)] bg-[var(--vigil-tab-inactive)] px-1.5">
      <span className="flex shrink-0 items-center gap-1">
        <PaneToggleButton
          direction="right"
          label="Collapse chat"
          onClick={() => useLayoutStore.getState().toggleChat()}
        />
        <button
          type="button"
          title={turnsFolded ? "Expand" : "Collapse"}
          aria-label={turnsFolded ? "Expand" : "Collapse"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--vigil-muted)] hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
          onClick={onToggleTurns}
        >
          {turnsFolded ? (
            <ChevronDown className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronUp className="h-4 w-4" aria-hidden />
          )}
        </button>
      </span>

      <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex min-w-[4.5rem] max-w-[10.5rem] flex-1 items-center gap-1 rounded-t px-2.5 text-[12px] ${
              tab.id === activeTabId
                ? "bg-[var(--vigil-tab-active)] text-[var(--vigil-text)]"
                : "text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            }`}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onActivate(tab.id);
              setRenamingId(null);
              setTabMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
            }}
          >
            {renamingId === tab.id ? (
              <input
                autoFocus
                defaultValue={displayChatTitle(tab.title)}
                aria-label="Rename chat"
                className="min-w-0 flex-1 select-text bg-transparent text-[12px] text-[var(--vigil-text)] outline-none"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const title = event.currentTarget.value.trim();
                    onRename(tab.id, title || "Chat");
                    setRenamingId(null);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.currentTarget.value = displayChatTitle(tab.title);
                    setRenamingId(null);
                  }
                }}
                onBlur={(event) => {
                  const title = event.currentTarget.value.trim() || "Chat";
                  if (title !== displayChatTitle(tab.title)) onRename(tab.id, title);
                  setRenamingId(null);
                }}
              />
            ) : (
              <button
                type="button"
                title={displayChatTitle(tab.title)}
                className="min-w-0 truncate text-inherit"
                onClick={() => onActivate(tab.id)}
                onDoubleClick={() => {
                  setTabMenu(null);
                  setRenamingId(tab.id);
                }}
              >
                {displayChatTitle(tab.title)}
              </button>
            )}
            <button
              type="button"
              className="opacity-60 hover:opacity-100"
              onClick={() => onClose(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="flex shrink-0 items-center px-2 text-[16px] leading-none text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
          title="New chat tab"
          aria-label="New chat tab"
          onClick={onNew}
        >
          +
        </button>
      </div>

      <div className="flex shrink-0 items-center pr-0.5">
        <button
          ref={historyBtnRef}
          type="button"
          aria-label="Chat history"
          title="Chat history"
          aria-expanded={menuOpen}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--vigil-accent)] hover:bg-[var(--vigil-hover)]"
          onClick={() => {
            if (menuOpen) {
              setMenuOpen(false);
              return;
            }
            setHistoryFilter("");
            placeHistoryMenu();
            setMenuOpen(true);
          }}
        >
          <History className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {menuOpen &&
        createPortal(
          <div
            ref={historyMenuRef}
            role="menu"
            aria-label="Closed chats"
            className="fixed z-[90] flex max-h-80 w-64 flex-col overflow-hidden rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] text-[var(--vigil-text)] shadow-lg"
            style={{ top: historyPos.top, right: historyPos.right }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[var(--vigil-border)] px-2 py-2">
              <div className="mb-1.5 px-1 text-[11px] font-medium text-[var(--vigil-muted)]">
                Closed chats
              </div>
              <input
                ref={historyFilterRef}
                type="search"
                value={historyFilter}
                placeholder="Filter closed chats"
                aria-label="Filter closed chats"
                className="h-7 w-full rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 text-[12px] text-[var(--vigil-text)] outline-none placeholder:text-[var(--vigil-muted)] focus:border-[var(--vigil-accent)]"
                onChange={(event) => setHistoryFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (historyFilter) setHistoryFilter("");
                  else setMenuOpen(false);
                }}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {history.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[var(--vigil-muted)]">
                  No closed chats yet
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[var(--vigil-muted)]">
                  No matches
                </div>
              ) : (
                filteredHistory.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="menuitem"
                    className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-[var(--vigil-hover)]"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRestore(tab.id);
                      setMenuOpen(false);
                    }}
                  >
                    {displayChatTitle(tab.title)}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}

      {tabMenu && (
        <ChatTabMenu
          menu={tabMenu}
          canCloseOthers={tabs.length > 1}
          onClose={() => setTabMenu(null)}
          onRename={() => {
            const id = tabMenu.tabId;
            setTabMenu(null);
            setRenamingId(id);
          }}
          onCopyRequest={() => {
            const id = tabMenu.tabId;
            setTabMenu(null);
            void copyRequestId(id);
          }}
          onCloseTab={() => {
            const id = tabMenu.tabId;
            setTabMenu(null);
            onClose(id);
          }}
          onCloseOthers={() => {
            const id = tabMenu.tabId;
            setTabMenu(null);
            onCloseOthers(id);
          }}
          onCloseAll={() => {
            setTabMenu(null);
            onCloseAll();
          }}
        />
      )}
    </div>
  );
}

export function ChatPanel() {
  const showAgentDiff = useEditorTabsStore((s) => s.showAgentDiff);
  const appendOutput = useTerminalStore((s) => s.appendOutput);
  const {
    tabs,
    history,
    activeTabId,
    newTab,
    setActive,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    renameTab,
    restoreFromHistory,
    setActiveDraft,
    hydrate,
  } = useTabsStore();
  const { recordEstimate, recordUsage } = useCostStore();

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const messages = activeTab?.messages ?? [];
  const tabKey = activeTab?.id ?? "";
  const { leading, turns } = groupChatTurns(messages);
  const draft = activeTab?.draft ?? "";
  const [isRunning, setRunning] = useState(false);
  const [runningTabId, setRunningTabId] = useState<string | null>(null);
  const [runningUserMessageId, setRunningUserMessageId] = useState<string | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const [queue, setQueue] = useState<QueuedTurn[]>([]);
  const queueRef = useRef<QueuedTurn[]>([]);
  const runningRef = useRef(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composerDropActive, setComposerDropActive] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [checkpointIds, setCheckpointIds] = useState<Set<string>>(new Set());
  const [folds, setFolds] = useState<Record<string, TurnFold>>({});
  const fold = folds[tabKey] ?? { mode: "all-open" as const, except: [] };
  const seenUserIds = useRef<Set<string> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** Ignore late dictation paints after Enter already started a send. */
  const ignoreDictationRef = useRef(false);
  /** After Edit, ignore leftover Stop/error writes from the aborted turn. */
  const suppressTurnWritesRef = useRef<string | null>(null);

  const reloadCheckpoints = useCallback(async () => {
    try {
      const root = (await getWorkspaceCwd()).trim();
      setCheckpointIds(new Set(root ? await listCheckpointIds(root) : []));
    } catch {
      setCheckpointIds(new Set());
    }
  }, []);

  useEffect(() => {
    void reloadCheckpoints();
  }, [reloadCheckpoints, tabKey]);

  async function onUndoUserMessage(messageId: string) {
    if (!checkpointIds.has(messageId)) {
      notify("مفيش نقطة تراجع للرسالة دي");
      return;
    }
    const accepted = window.confirm(
      "تراجع؟ هترجع الملفات لحالة قبل الرسالة دي (التعديلات اللي بعدها في الشات هترجع معاها).",
    );
    if (!accepted) return;
    try {
      const root = await getWorkspaceCwd();
      const files = await restoreCheckpoint(root, messageId);
      const editors = useEditorTabsStore.getState();
      const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
      for (const file of files) {
        const abs = `${base}/${file.path}`;
        for (const tab of [...editors.tabs]) {
          const tabPath = tab.path.replace(/\\/g, "/");
          const matches =
            tabPath === abs || tabPath === file.path || tabPath.endsWith(`/${file.path}`);
          if (!matches) continue;
          if (tab.mode === "diff" || !file.existed) editors.closeTab(tab.id);
          else if (tab.mode === "file") editors.revertContent(tab.id, file.content);
        }
      }
      window.dispatchEvent(new Event("vigil:git-changed"));
      void useExplorerStore.getState().refresh();
      notify(
        files.length > 0
          ? `تم التراجع — ${files.length} ملف`
          : "مفيش حاجة تترجع",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Inside the Tauri webview, Web Speech (the VigilHub path) aborts the
   * whole process on macOS. Live dictation runs in a separate helper instead.
   */
  const inTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  function applyDictatedText(text: string) {
    if (ignoreDictationRef.current) return;
    draftRef.current = text;
    setActiveDraft(text);
  }

  const nativeDictation = useNativeLiveDictation({
    getBaseText: () => draftRef.current,
    onText: applyDictatedText,
    onError: (msg) => setComposerError(msg),
  });
  const webDictation = useSpeechDictation({
    getBaseText: () => draftRef.current,
    onText: applyDictatedText,
    mode: "append",
    stopOnSilence: false,
  });
  const listening = inTauri
    ? nativeDictation.listening
    : webDictation.listening;

  async function stopDictationIfNeeded() {
    if (inTauri && nativeDictation.listening) {
      await nativeDictation.stop();
      return;
    }
    if (!inTauri && webDictation.listening) {
      webDictation.stop({ silent: true });
    }
  }

  useEffect(() => {
    void hydrate().then(() => backfillChatTabTitles());
  }, [hydrate]);

  useEffect(() => {
    if (!activeTabId && tabs[0]) setActive(tabs[0].id);
  }, [activeTabId, tabs, setActive]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isRunning]);

  useEffect(() => {
    seenUserIds.current = null;
  }, [tabKey]);

  useEffect(() => {
    const userIds = messages.filter((message) => message.role === "user").map((message) => message.id);
    if (!seenUserIds.current) {
      seenUserIds.current = new Set(userIds);
      return;
    }
    const fresh = userIds.filter((id) => !seenUserIds.current?.has(id));
    for (const id of userIds) seenUserIds.current.add(id);
    if (fresh.length === 0 || !tabKey) return;
    setFolds((current) => {
      const existing = current[tabKey] ?? { mode: "all-open" as const, except: [] };
      if (existing.mode !== "all-closed") return current;
      return {
        ...current,
        [tabKey]: { ...existing, except: [...new Set([...existing.except, ...fresh])] },
      };
    });
  }, [messages, tabKey]);

  function setFold(next: TurnFold) {
    if (!tabKey) return;
    setFolds((current) => ({ ...current, [tabKey]: next }));
  }

  function toggleTurn(id: string) {
    const except = new Set(fold.except);
    if (except.has(id)) except.delete(id);
    else except.add(id);
    setFold({ ...fold, except: [...except] });
  }

  function clearComposer() {
    setActiveDraft("");
    setAttachments([]);
    useComposerContextStore.getState().clearChips();
    setComposerError(null);
    if (inTauri && nativeDictation.listening) void nativeDictation.stop();
    if (!inTauri && webDictation.listening) webDictation.stop({ silent: true });
  }

  function toggleMic() {
    setComposerError(null);
    if (inTauri) nativeDictation.toggle();
    else webDictation.toggle();
  }

  function messagesOf(tabId: string): ChatMessage[] {
    const state = useTabsStore.getState();
    return state.tabs.find((t) => t.id === tabId)?.messages ?? [];
  }

  function appendToTab(
    tabId: string,
    msg: Omit<ChatMessage, "id" | "createdAt"> & { id?: string },
  ): string {
    const id = msg.id ?? crypto.randomUUID();
    useTabsStore.getState().updateTabMessages(tabId, [
      ...messagesOf(tabId),
      {
        id,
        createdAt: Date.now(),
        role: msg.role,
        content: msg.content,
        modelLabel: msg.modelLabel,
        images: msg.images,
        editedFiles: msg.editedFiles,
      },
    ]);
    return id;
  }

  function updateOnTab(
    tabId: string,
    id: string,
    patch: Partial<
      Pick<ChatMessage, "content" | "modelLabel" | "images" | "editedFiles">
    >,
  ) {
    useTabsStore.getState().updateTabMessages(
      tabId,
      messagesOf(tabId).map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  }

  function syncQueue(next: QueuedTurn[]) {
    queueRef.current = next;
    setQueue(next);
  }

  const addImageDataUrl = useCallback(async (raw: string, name = "copied-image.jpg") => {
    if (!raw.startsWith("data:image/")) return;
    setComposerError(null);
    const id = crypto.randomUUID();
    const preview = await compressImageDataUrl(raw);
    const mimeType = /^data:([^;]+);/.exec(preview)?.[1] || "image/jpeg";
    setAttachments((prev) => {
      const images = prev.filter((a) => a.kind === "image");
      if (images.length >= COMPOSER_MAX_IMAGES) {
        setComposerError(`Max ${COMPOSER_MAX_IMAGES} images per message.`);
        return prev;
      }
      return [
        ...prev,
        {
          id,
          name,
          kind: "image",
          preview,
          mimeType,
        },
      ];
    });
  }, []);

  const addImageFromFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const raw = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    await addImageDataUrl(raw, file.name || "pasted-image.png");
  }, [addImageDataUrl]);

  useEffect(() => {
    setClipImageSink((dataUrl) => {
      void addImageDataUrl(dataUrl);
    });
    return () => setClipImageSink(null);
  }, [addImageDataUrl]);

  function onFilesSelected(files: FileList | null) {
    if (!files) return;
    void (async () => {
      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/")) {
          await addImageFromFile(file);
          continue;
        }
        const kind: Attachment["kind"] = file.type.startsWith("video/")
          ? "video"
          : "file";
        setAttachments((prev) => [
          ...prev,
          { id: crypto.randomUUID(), name: file.name, kind },
        ]);
      }
    })();
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    let handledImage = false;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          handledImage = true;
          void addImageFromFile(file);
        }
      }
    }
    if (handledImage) e.preventDefault();
  }

  function removeQueued(id: string) {
    syncQueue(queueRef.current.filter((item) => item.id !== id));
  }

  function restoreQueued(item: QueuedTurn) {
    if (item.tabId !== activeTab?.id) return;
    removeQueued(item.id);
    const current = draftRef.current.trim();
    setActiveDraft(current ? `${current}\n${item.promptBase}` : item.promptBase);
    setAttachments((prev) => {
      const images = [
        ...prev.filter((a) => a.kind === "image"),
        ...item.attachments.filter((a) => a.kind === "image"),
      ].slice(0, COMPOSER_MAX_IMAGES);
      const others = [
        ...prev.filter((a) => a.kind !== "image"),
        ...item.attachments.filter((a) => a.kind !== "image"),
      ];
      return [...images, ...others];
    });
  }

  function cancelRunning() {
    abortRef.current?.abort();
  }

  function editUserMessage(message: ChatMessage) {
    if (message.role !== "user") return;
    const tabId = activeTab?.id;
    if (!tabId) return;

    // Stop a failed/in-progress turn so we can safely rewrite the prompt.
    if (runningRef.current && runningUserMessageId === message.id) {
      suppressTurnWritesRef.current = message.id;
      cancelRunning();
    }

    const msgs = messagesOf(tabId);
    const index = msgs.findIndex((item) => item.id === message.id);
    if (index < 0) return;

    // Drop this user turn and anything after it — resend will recreate them.
    useTabsStore.getState().updateTabMessages(tabId, msgs.slice(0, index));
    void useTabsStore.getState().persistTab(tabId);

    const text = message.content
      .replace(/\n\n\[Attachments:[^\]]*\]\s*$/i, "")
      .trim();
    ignoreDictationRef.current = false;
    draftRef.current = text;
    setActiveDraft(text);

    if (message.images && message.images.length > 0) {
      setAttachments(
        message.images.map((image) => ({
          id: image.id || crypto.randomUUID(),
          name: image.name || "image",
          kind: "image" as const,
          preview: image.dataUrl,
        })),
      );
    }

    window.requestAnimationFrame(() => {
      const box = composerRef.current;
      if (!box) return;
      box.focus();
      const end = box.value.length;
      box.setSelectionRange(end, end);
    });
  }

  async function runTurn(turn: QueuedTurn) {
    const tabId = turn.tabId;
    const { promptBase, otherNote, displayImages, userVisible } = turn;
    const controller = new AbortController();
    abortRef.current = controller;
    const modelChoice = turn.modelChoice || "auto";
    const userMessageId = appendToTab(tabId, {
      role: "user",
      content: `${userVisible}${otherNote}`,
      images: displayImages.length > 0 ? displayImages : undefined,
      modelLabel: modelChoice,
    });
    nameChatTabFromFirstMessage(tabId, userVisible);
    setRunningUserMessageId(userMessageId);

    let assistantId: string | null = null;
    const stream = new AgentTextStream();
    let notes = "";
    const editedFiles = new Map<string, string>(); // abs -> label

    const editedFilesList = (): ChatEditedFile[] =>
      [...editedFiles.entries()].map(([path, label]) => ({ path, label }));

    const answerBody = () =>
      [stream.text, notes].filter((part) => part.trim()).join("\n\n");

    const turnStillPresent = () =>
      messagesOf(tabId).some((item) => item.id === userMessageId);

    const publish = (usage: UsageSnapshot | null) => {
      if (
        suppressTurnWritesRef.current === userMessageId ||
        !turnStillPresent()
      ) {
        return;
      }
      const body = answerBody();
      const content = usage ? `${body}\n\n_${formatUsageLine(usage)}_` : body;
      const files = editedFilesList();
      if (!content.trim() && files.length === 0) return;
      if (!assistantId) {
        assistantId = appendToTab(tabId, {
          role: "assistant",
          content: content || " ",
          modelLabel: modelChoice,
          editedFiles: files.length > 0 ? files : undefined,
        });
      } else {
        updateOnTab(tabId, assistantId, {
          content: content || " ",
          editedFiles: files.length > 0 ? files : undefined,
        });
      }
    };

    const takeText = (chunk: string) => {
      const before = stream.text;
      stream.push(chunk);
      const delta = stream.text.startsWith(before) ? stream.text.slice(before.length) : "";
      if (delta) appendOutput(delta);
      publish(null);
    };

    const markStopped = async () => {
      if (
        suppressTurnWritesRef.current === userMessageId ||
        !turnStillPresent()
      ) {
        if (suppressTurnWritesRef.current === userMessageId) {
          suppressTurnWritesRef.current = null;
        }
        return;
      }
      const body = answerBody();
      const note = body ? `${body}\n\n_Stopped._` : "_Stopped._";
      if (assistantId) updateOnTab(tabId, assistantId, { content: note });
      else appendToTab(tabId, { role: "assistant", content: note });
      void useTabsStore.getState().persistTab(tabId);
    };

    try {
      let promptForAgent = `${promptBase || "Please analyze the attached image(s)."}${otherNote}`;
      let browserOpenedThisTurn = false;

      // Open Vigil Browser first (in-editor) — never wait on the LLM / image analysis.
      const browserIntent = detectBrowserOpenIntent(
        `${promptBase || ""}${otherNote}`,
      );
      if (browserIntent) {
        let openUrl = browserIntent.url;
        if (openUrl === "project") {
          const root = useExplorerStore.getState().root;
          openUrl =
            (await detectProjectPreviewUrl(root)) ?? "http://localhost:3000";
        }
        useEditorTabsStore.getState().openBrowser(openUrl);
        browserOpenedThisTurn = true;

        if (isPureBrowserOpenRequest(promptBase || promptForAgent)) {
          appendToTab(tabId, {
            role: "assistant",
            content: `اتفتح في Vigil Browser جوه المحرر:\n${openUrl}`,
            modelLabel: modelChoice,
          });
          void useTabsStore.getState().persistTab(tabId);
          return;
        }
        promptForAgent = `${promptForAgent}\n\n${browserIntent.forceToolNote}`;
      }

      try {
        if (displayImages.length > 0) {
          const enriched = await withAbort(
            enrichPromptWithImageAnalysis(
              promptBase || "Please analyze the attached image(s).",
              displayImages.map((i) => i.dataUrl),
              controller.signal,
            ),
            controller.signal,
          );
          promptForAgent = `${enriched.prompt}${otherNote}`;
          if (browserIntent) {
            promptForAgent = `${promptForAgent}\n\n${browserIntent.forceToolNote}`;
          }
        }
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) {
          await markStopped();
          return;
        }
        setComposerError(
          err instanceof Error
            ? `Image analysis failed: ${err.message}`
            : String(err),
        );
        return;
      }

      promptForAgent = attachReferencedChats(promptForAgent, tabId, findChatByRequestId);

      const routed = routeTask({
        prompt: promptForAgent,
        preferredProvider: modelChoice === "auto" ? "auto" : undefined,
        pinnedModelId: modelChoice === "auto" ? undefined : modelChoice,
      });

      let usage: UsageSnapshot | null = null;

      const prefs = useChatStore.getState();
      const styleParts = [
        buildReplyStyleInstruction(prefs.replyTone, prefs.replyLength),
      ];
      try {
        const workspace = (await getWorkspaceCwd()).trim();
        if (workspace) {
          const rules = formatProjectRulesForAgent(
            await readProjectRules(workspace),
          );
          if (rules) styleParts.push(rules);
        }
      } catch {
        /* No workspace rules — continue with reply style only. */
      }
      // Always remind the model it owns Vigil Browser — overrides bad project rules.
      styleParts.push(
        "Vigil Browser: call browser_open yourself to open previews. " +
          "Never tell the user to use Command Palette or Simple Browser: Show.",
      );
      for await (const event of runVigilTask(promptForAgent, {
        preferredProvider: routed.providerId,
        model: routed,
        clientName: "vigil-agent",
        signal: controller.signal,
        checkpointId: userMessageId,
        checkpointAt: Date.now(),
        replyStyle: styleParts.join("\n\n"),
      })) {
        if (controller.signal.aborted) break;
        if (event.type === "chunk" && event.text) {
          takeText(event.text);
        } else if (event.type === "agent_event") {
          const inner = event.event;
          const encoded =
            typeof inner === "string" ? inner : inner ? JSON.stringify(inner) : "";
          if (encoded) takeText(encoded);
        } else if (event.type === "tool" && event.toolName === "write_file") {
          const path = event.path ?? "untitled";
          const content = event.content ?? "";
          let workspace = "";
          try {
            workspace = (await getWorkspaceCwd()).trim();
          } catch {
            /* ignore */
          }
          const { abs, label } = resolveWorkspacePath(path, workspace || null);
          editedFiles.set(abs, label);
          showAgentDiff(abs, "", content);
          publish(null);
        } else if (
          event.type === "tool" &&
          (event.toolName === "browser_open" ||
            event.toolName === "browser_navigate")
        ) {
          const url = event.url?.trim();
          if (url) {
            useEditorTabsStore.getState().openBrowser(url);
            browserOpenedThisTurn = true;
          }
          publish(null);
        } else if (
          event.type === "tool" &&
          event.toolName === "browser_screenshot" &&
          event.imageBase64
        ) {
          const dataUrl = `data:image/png;base64,${event.imageBase64}`;
          takeText(`\n![browser screenshot](${dataUrl})\n`);
          publish(null);
        } else if (event.type === "done") {
          stream.adoptFinal(event.text);
          if (!browserOpenedThisTurn) {
            const fallback = extractPreviewUrls(stream.text).find((u) =>
              /localhost|127\.0\.0\.1/i.test(u),
            );
            if (fallback) {
              useEditorTabsStore.getState().openBrowser(fallback);
              browserOpenedThisTurn = true;
            }
          }
          if (!stream.text.trim() && !notes.trim()) notes = "Task completed.";
          const reported = event.usage;
          if (
            reported &&
            (reported.inputTokens > 0 || reported.outputTokens > 0 || reported.cost > 0)
          ) {
            usage = {
              inputTokens: reported.inputTokens,
              outputTokens: reported.outputTokens,
              cost: reported.cost,
              provider: routed.providerId,
              model: routed.modelId,
            };
            await recordUsage(usage, tabId);
          } else if (stream.usage) {
            usage = {
              ...stream.usage,
              provider: routed.providerId,
              model: routed.modelId,
            };
            await recordUsage(usage, tabId);
          } else {
            usage = await recordEstimate(
              promptForAgent,
              answerBody(),
              routed.providerId,
              routed.modelId,
              tabId,
            );
          }
          publish(usage);
        } else if (event.type === "error") {
          notes = notes ? `${notes}\n\nError: ${event.message}` : `Error: ${event.message}`;
          publish(null);
        }
      }
      if (controller.signal.aborted) {
        await markStopped();
        return;
      }
      if (!usage && answerBody()) {
        usage = await recordEstimate(
          promptForAgent,
          answerBody(),
          routed.providerId,
          routed.modelId,
          tabId,
        );
        publish(usage);
      }
      await useTabsStore.getState().persistTab(tabId);
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        await markStopped();
        return;
      }
      if (
        suppressTurnWritesRef.current === userMessageId ||
        !turnStillPresent()
      ) {
        if (suppressTurnWritesRef.current === userMessageId) {
          suppressTurnWritesRef.current = null;
        }
        return;
      }
      const failed = `Failed: ${String(err)}`;
      if (assistantId) updateOnTab(tabId, assistantId, { content: failed });
      else appendToTab(tabId, { role: "assistant", content: failed });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      void reloadCheckpoints();
      setRunningUserMessageId((current) =>
        current === userMessageId ? null : current,
      );
    }
  }

  async function drainQueue(first: QueuedTurn) {
    runningRef.current = true;
    setRunning(true);
    let turn: QueuedTurn | undefined = first;
    try {
      while (turn) {
        setRunningTabId(turn.tabId);
        await runTurn(turn);
        const next = queueRef.current[0];
        if (next) syncQueue(queueRef.current.slice(1));
        turn = next;
      }
    } finally {
      runningRef.current = false;
      setRunningTabId(null);
      setRunning(false);
    }
  }

  async function onSubmit(e?: FormEvent | { preventDefault?: () => void }) {
    e?.preventDefault?.();

    // Stop mic/dictation first so the last spoken words flush into the draft.
    ignoreDictationRef.current = true;
    await stopDictationIfNeeded();

    const chips = useComposerContextStore.getState().takeChips();
    const contextBlock = formatComposerContext(chips);
    const chipLabels = formatComposerChipLabels(chips);
    const draftText = draftRef.current.trim();
    const promptBase = [contextBlock, draftText].filter(Boolean).join("\n\n");
    if ((!promptBase && attachments.length === 0) || !activeTab) {
      ignoreDictationRef.current = false;
      if (chips.length > 0) {
        useComposerContextStore.setState({ chips });
      }
      return;
    }

    const imageAttachments = attachments.filter(
      (a) => a.kind === "image" && a.preview,
    );
    const otherAttachments = attachments.filter((a) => a.kind !== "image");
    const displayImages: ChatImageAttachment[] = imageAttachments.map((a) => ({
      id: a.id,
      name: a.name,
      dataUrl: a.preview!,
    }));
    const userVisible =
      [draftText, chipLabels].filter(Boolean).join("\n") ||
      (displayImages.length > 0 ? `(${displayImages.length} image(s))` : "");
    const otherNote =
      otherAttachments.length > 0
        ? `\n\n[Attachments: ${otherAttachments.map((a) => a.name).join(", ")}]`
        : "";

    const modelChoice = useChatStore.getState().preferredProvider || "auto";
    const turn: QueuedTurn = {
      id: crypto.randomUUID(),
      tabId: activeTab.id,
      promptBase,
      userVisible,
      otherNote,
      displayImages,
      attachments: [...attachments],
      modelChoice,
    };

    nameChatTabFromFirstMessage(activeTab.id, userVisible);
    draftRef.current = "";
    setActiveDraft("");
    setAttachments([]);
    setComposerError(null);
    window.setTimeout(() => {
      ignoreDictationRef.current = false;
    }, 400);

    if (runningRef.current) {
      syncQueue([...queueRef.current, turn]);
      return;
    }
    void drainQueue(turn);
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void onSubmit(e);
    }
  }

  // While dictating, Enter always stops the mic and sends — even if focus left the box.
  useEffect(() => {
    if (!listening) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest?.(
          "[role='dialog'], [role='menu'], [data-clip-shelf], input:not([type='hidden']), select",
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void onSubmit();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // onSubmit closes over latest attachments/activeTab via render; listening gate is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, activeTabId, attachments]);

  const contextChips = useComposerContextStore((s) => s.chips);
  const removeContextChip = useComposerContextStore((s) => s.removeChip);
  const explorerDragActive = useExplorerDragStore(
    (s) => s.dragging && s.overComposer,
  );

  // OS file drops (Finder) still use HTML5 DnD — explorer uses pointer drag.
  function onComposerDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setComposerDropActive(true);
  }

  function onComposerDragLeave(e: DragEvent) {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setComposerDropActive(false);
  }

  function onComposerDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setComposerDropActive(false);
    if (e.dataTransfer.files?.length) {
      onFilesSelected(e.dataTransfer.files);
    }
  }

  const composerHighlight = composerDropActive || explorerDragActive;

  const imageStripItems = attachments
    .filter((a) => a.kind === "image" && a.preview)
    .map((a) => ({ id: a.id, src: a.preview!, name: a.name }));

  const nonImageAttachments = attachments.filter((a) => a.kind !== "image");
  const canSend =
    draft.trim().length > 0 || imageStripItems.length > 0 || contextChips.length > 0;
  const visibleQueue = queue.filter((item) => item.tabId === activeTab?.id);

  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-l border-[var(--vigil-border)] bg-[var(--vigil-panel)]">
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      <ChatTabBar
        tabs={tabs}
        history={history}
        activeTabId={activeTabId}
        onActivate={setActive}
        onRestore={(id) => void restoreFromHistory(id)}
        onClose={(id) => void closeTab(id)}
        onCloseOthers={(id) => void closeOtherTabs(id)}
        onCloseAll={() => void closeAllTabs()}
        onRename={renameTab}
        onNew={() => newTab("Chat")}
        turnsFolded={turns.length > 0 && turns.every((turn) => !turnIsOpen(fold, turn.id))}
        onToggleTurns={() => {
          const allClosed =
            turns.length > 0 && turns.every((turn) => !turnIsOpen(fold, turn.id));
          setFold(
            allClosed
              ? { mode: "all-open", except: [] }
              : { mode: "all-closed", except: [] },
          );
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
        <div className="space-y-3">
          {messages.length === 0 && (
            <div className="rounded border border-dashed border-[var(--vigil-border)] p-3 text-xs text-[var(--vigil-muted)]">
              Ask Vigil anything. Paste images, or use the mic for Arabic / English
              voice. Tabs keep separate sessions.
            </div>
          )}
          {leading.map((message) => (
            <ChatMessageView
              key={message.id}
              message={message}
              running={false}
              onStop={cancelRunning}
              onOpenImage={setLightboxSrc}
            />
          ))}
          {turns.map((turn) =>
            turnIsOpen(fold, turn.id) ? (
              <div key={turn.id} className="space-y-3">
                <ChatMessageView
                  message={turn.user}
                  running={turn.user.id === runningUserMessageId}
                  onStop={cancelRunning}
                  onOpenImage={setLightboxSrc}
                  onCollapse={() => toggleTurn(turn.id)}
                  onEdit={() => editUserMessage(turn.user)}
                  onUndo={
                    !isRunning && checkpointIds.has(turn.user.id)
                      ? () => void onUndoUserMessage(turn.user.id)
                      : undefined
                  }
                />
                {turn.replies.map((reply) => (
                  <ChatMessageView
                    key={reply.id}
                    message={reply}
                    running={false}
                    onStop={cancelRunning}
                    onOpenImage={setLightboxSrc}
                  />
                ))}
              </div>
            ) : (
              <button
                key={turn.id}
                type="button"
                title={messageTooltip(turn.user)}
                aria-label={messageTooltip(turn.user)}
                onClick={() => toggleTurn(turn.id)}
                className="flex w-full items-center gap-2 rounded bg-[var(--vigil-accent-soft)] px-3 py-1.5 text-left text-sm text-[var(--vigil-text)] hover:brightness-95"
              >
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--vigil-muted)]" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{previewText(turn.user)}</span>
                {turn.user.modelLabel && (
                  <span className="shrink-0 text-[11px] font-medium text-[var(--vigil-accent)]">
                    {chatModelLabel(turn.user.modelLabel)}
                  </span>
                )}
              </button>
            ),
          )}
          {isRunning && runningTabId === activeTab?.id && (
            <div className="text-xs text-[var(--vigil-muted)]">Thinking…</div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        data-chat-composer
        onSubmit={(e) => void onSubmit(e)}
        className={`relative border-t border-[var(--vigil-border)] p-3 transition-colors ${
          composerHighlight
            ? "bg-[var(--vigil-accent-soft)] ring-2 ring-inset ring-[var(--vigil-accent)]"
            : ""
        }`}
        onDragEnter={onComposerDragOver}
        onDragOver={onComposerDragOver}
        onDragLeave={onComposerDragLeave}
        onDrop={onComposerDrop}
      >
        {composerHighlight && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded bg-[var(--vigil-accent-soft)]/80">
            <span className="rounded-md border border-[var(--vigil-accent)] bg-[var(--vigil-panel)] px-3 py-1.5 text-xs font-medium text-[var(--vigil-accent)]">
              Drop to mention in chat
            </span>
          </div>
        )}
        <ImageStrip
          images={imageStripItems}
          removable
          onRemove={(id) =>
            setAttachments((prev) => prev.filter((a) => a.id !== id))
          }
          onOpen={setLightboxSrc}
        />

        {contextChips.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {contextChips.map((chip) => {
              const isPath = chip.kind === "file" || chip.kind === "folder";
              return (
                <div
                  key={chip.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--vigil-accent)]/40 bg-[var(--vigil-accent-soft)] px-2 py-1 text-[11px] !text-[var(--vigil-accent)]"
                  title={
                    isPath
                      ? `${chip.path || chip.detail} — click to open`
                      : chip.text.slice(0, 400)
                  }
                >
                  <span className="shrink-0" aria-hidden>
                    {chip.kind === "folder"
                      ? "📁"
                      : chip.kind === "file"
                        ? "📄"
                        : "⌘"}
                  </span>
                  {isPath && chip.path ? (
                    <button
                      type="button"
                      className="truncate border-0 bg-transparent p-0 font-medium !text-[var(--vigil-accent)] underline"
                      onClick={() =>
                        void openAndRevealFile(chip.path!, {
                          isDir: chip.kind === "folder",
                        })
                      }
                    >
                      @{chip.detail}
                    </button>
                  ) : (
                    <span className="truncate font-medium">
                      @{chip.title} ({chip.detail})
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${chip.title} reference`}
                    className="shrink-0 !text-[var(--vigil-accent)] hover:opacity-70"
                    onClick={() => removeContextChip(chip.id)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {nonImageAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {nonImageAttachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-editor)] px-2 py-1 text-[10px]"
              >
                <span>{a.kind === "folder" ? "📁" : "📄"}</span>
                <span className="max-w-[100px] truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((p) => p.filter((x) => x.id !== a.id))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={composerRef}
          value={draft}
          dir="auto"
          style={{ unicodeBidi: "plaintext" }}
          onChange={(e) => setActiveDraft(e.target.value)}
          onPaste={onPaste}
          onKeyDown={onComposerKeyDown}
          onDragEnter={onComposerDragOver}
          onDragOver={onComposerDragOver}
          onDragLeave={onComposerDragLeave}
          onDrop={onComposerDrop}
          rows={3}
          placeholder={
            isRunning
              ? "Queue a follow-up… it runs when the current turn finishes"
              : "Ask anything… drag a file from Explorer, paste an image, or use the mic"
          }
          className="w-full resize-none rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--vigil-accent)]"
        />

        {visibleQueue.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-md border border-[var(--vigil-border)]">
            {visibleQueue.map((item, index) => (
              <div
                key={item.id}
                className={`flex items-center gap-2 px-2 py-1.5 ${
                  index === 0
                    ? "bg-[var(--vigil-accent-soft)]"
                    : "bg-[var(--vigil-hover)]"
                } ${index > 0 ? "border-t border-[var(--vigil-border)]" : ""}`}
              >
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--vigil-muted)]">
                  {index === 0 ? "Next" : "Queued"}
                </span>
                <button
                  type="button"
                  title="Edit this queued message"
                  className="min-w-0 flex-1 truncate text-left text-xs text-[var(--vigil-text)]"
                  dir="auto"
                  onClick={() => restoreQueued(item)}
                >
                  {item.userVisible}
                  {item.displayImages.length > 0 && item.promptBase
                    ? ` · ${item.displayImages.length} image${item.displayImages.length === 1 ? "" : "s"}`
                    : ""}
                </button>
                <button
                  type="button"
                  aria-label="Remove from queue"
                  title="Remove from queue"
                  className="shrink-0 px-1 text-sm text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
                  onClick={() => removeQueued(item.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {(composerError || listening) && (
          <p
            className={`mt-1 text-[11px] ${
              composerError
                ? "text-[var(--vigil-danger)]"
                : "text-[var(--vigil-muted)]"
            }`}
          >
            {composerError
              ? composerError
              : "Listening…"}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <ModelSelect />
            <ChatQuickSettingsButton />
            <button
              type="button"
              title="Attach"
              aria-label="Attach"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-600 !text-white hover:bg-sky-700"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <ClipShelfButton />
            <button
              type="button"
              title="Clear text and attachments"
              aria-label="Clear text and attachments"
              disabled={
                !draft.trim() &&
                attachments.length === 0 &&
                contextChips.length === 0
              }
              className="flex h-8 w-8 items-center justify-center rounded-md bg-rose-600 !text-white hover:bg-rose-700 disabled:opacity-40"
              onClick={clearComposer}
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <SpeechDictationMicButton
              size="md"
              vivid
              active={listening}
              onClick={() => toggleMic()}
              title={listening ? "Stop dictation" : "Start dictation"}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,*/*"
              className="hidden"
              onChange={(e) => onFilesSelected(e.target.files)}
            />
          </div>
          <button
            type={isRunning ? "button" : "submit"}
            disabled={!isRunning && !canSend}
            title={isRunning ? "Stop" : "Send"}
            aria-label={isRunning ? "Stop" : "Send"}
            onClick={
              isRunning
                ? (e) => {
                    e.preventDefault();
                    cancelRunning();
                  }
                : undefined
            }
            className={`flex h-9 w-9 items-center justify-center rounded-full !text-white disabled:opacity-40 ${
              isRunning
                ? "bg-[var(--vigil-danger)]"
                : "bg-[var(--vigil-accent)]"
            }`}
          >
            {isRunning ? (
              <Square className="h-3.5 w-3.5 fill-current" />
            ) : (
              <ArrowUp className="h-5 w-5" />
            )}
          </button>
        </div>
      </form>
    </aside>
  );
}
