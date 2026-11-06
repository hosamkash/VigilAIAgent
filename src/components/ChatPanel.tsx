import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  useChatStore,
  type ChatImageAttachment,
  type ChatMessage,
} from "../store/chatStore";
import { useSettingsStore } from "../store/settingsStore";
import { useEditorTabsStore } from "../store/editorTabsStore";
import { useTabsStore } from "../store/tabsStore";
import { useCostStore, formatUsd } from "../store/costStore";
import { useTerminalStore } from "../store/terminalStore";
import { routeTask } from "../lib/model-router";
import { runVigilTask, withAbort } from "../lib/cline-engine";
import { formatUsageLine, type UsageSnapshot } from "../lib/cost";
import {
  COMPOSER_MAX_IMAGES,
  compressImageDataUrl,
  enrichPromptWithImageAnalysis,
} from "../lib/gemini-multimodal";
import { useNativeLiveDictation } from "../lib/hooks/useNativeLiveDictation";
import { useSpeechDictation } from "../lib/hooks/useSpeechDictation";
import { SpeechDictationMicButton } from "./SpeechDictationMicButton";
import { MarkdownMessage } from "./MarkdownMessage";
import { ArrowUp, Square, Trash2 } from "lucide-react";

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

export function ChatPanel() {
  const preferredProvider = useChatStore((s) => s.preferredProvider);
  const setPreferredProvider = useChatStore((s) => s.setPreferredProvider);
  const openSettingsGate = useSettingsStore((s) => s.openSettingsGate);
  const showAgentDiff = useEditorTabsStore((s) => s.showAgentDiff);
  const appendOutput = useTerminalStore((s) => s.appendOutput);
  const {
    tabs,
    activeTabId,
    newTab,
    setActive,
    closeTab,
    renameTab,
    setActiveDraft,
    hydrate,
  } = useTabsStore();
  const { sessionTotal, recordEstimate } = useCostStore();

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const messages = activeTab?.messages ?? [];
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /**
   * Inside the Tauri webview, Web Speech (the VigilHub path) aborts the
   * whole process on macOS. Live dictation runs in a separate helper instead.
   */
  const inTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const nativeDictation = useNativeLiveDictation({
    getBaseText: () => draftRef.current,
    onText: (text) => setActiveDraft(text),
    onError: (msg) => setComposerError(msg),
  });
  const webDictation = useSpeechDictation({
    getBaseText: () => draftRef.current,
    onText: (text) => setActiveDraft(text),
    mode: "append",
    stopOnSilence: false,
  });
  const listening = inTauri
    ? nativeDictation.listening
    : webDictation.listening;

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!activeTabId && tabs[0]) setActive(tabs[0].id);
  }, [activeTabId, tabs, setActive]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isRunning]);

  function clearComposer() {
    setActiveDraft("");
    setAttachments([]);
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
      },
    ]);
    return id;
  }

  function updateOnTab(
    tabId: string,
    id: string,
    patch: Partial<Pick<ChatMessage, "content" | "modelLabel" | "images">>,
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

  const addImageFromFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setComposerError(null);
    const id = crypto.randomUUID();
    const raw = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const preview = await compressImageDataUrl(raw);
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
          name: file.name || "pasted-image.png",
          kind: "image",
          preview,
          mimeType: file.type || "image/png",
        },
      ];
    });
  }, []);

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

  async function runTurn(turn: QueuedTurn) {
    const tabId = turn.tabId;
    const { promptBase, otherNote, displayImages, userVisible } = turn;
    const controller = new AbortController();
    abortRef.current = controller;
    const userMessageId = appendToTab(tabId, {
      role: "user",
      content: `${userVisible}${otherNote}`,
      images: displayImages.length > 0 ? displayImages : undefined,
    });
    setRunningUserMessageId(userMessageId);

    let assistantId: string | null = null;
    let routeLine = "";
    let streamed = "";

    const markStopped = async () => {
      const note = streamed ? `${streamed}\n\n_Stopped._` : "_Stopped._";
      if (assistantId) {
        updateOnTab(tabId, assistantId, {
          content: `${routeLine}${note}`,
        });
      } else {
        appendToTab(tabId, { role: "assistant", content: note });
      }
      void useTabsStore.getState().persistTab(tabId);
    };

    try {
      let promptForAgent = `${promptBase || "Please analyze the attached image(s)."}${otherNote}`;
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

      const provider = useChatStore.getState().preferredProvider;
      const routed = routeTask({
        prompt: promptForAgent,
        preferredProvider: provider,
      });
      routeLine = `Routed as **${routed.tier}** → \`${routed.clineProviderId}/${routed.modelId}\`\n\n`;

      assistantId = appendToTab(tabId, {
        role: "assistant",
        content: routeLine,
        modelLabel: routed.modelId,
      });

      let usage: UsageSnapshot | null = null;

      for await (const event of runVigilTask(promptForAgent, {
        preferredProvider: provider,
        model: routed,
        clientName: "vigil-agent",
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break;
        if (event.type === "chunk" && event.text) {
          streamed += event.text;
          updateOnTab(tabId, assistantId, {
            content: `${routeLine}${streamed}`,
          });
          appendOutput(event.text);
        } else if (event.type === "tool" && event.toolName === "write_file") {
          const path = event.path ?? "untitled";
          const content = event.content ?? "";
          showAgentDiff(path, "", content);
          streamed += `\n\n✓ Wrote \`${path}\``;
          updateOnTab(tabId, assistantId, {
            content: `${routeLine}${streamed}`,
          });
        } else if (event.type === "done") {
          if (event.text && !streamed.includes(event.text)) {
            streamed = streamed ? `${streamed}\n\n${event.text}` : event.text;
          }
          if (!streamed.trim()) streamed = "Task completed.";
          const maybeUsage = (event as { usage?: UsageSnapshot }).usage;
          usage =
            maybeUsage ??
            (await recordEstimate(
              promptForAgent,
              streamed,
              routed.providerId,
              routed.modelId,
              tabId,
            ));
          updateOnTab(tabId, assistantId, {
            content: `${routeLine}${streamed}\n\n_${formatUsageLine(usage)}_`,
          });
        } else if (event.type === "error") {
          streamed += `\n\nError: ${event.message}`;
          updateOnTab(tabId, assistantId, {
            content: `${routeLine}${streamed}`,
          });
        }
      }
      if (controller.signal.aborted) {
        await markStopped();
        return;
      }
      if (!usage && streamed) {
        usage = await recordEstimate(
          promptForAgent,
          streamed,
          routed.providerId,
          routed.modelId,
          tabId,
        );
        updateOnTab(tabId, assistantId, {
          content: `${routeLine}${streamed}\n\n_${formatUsageLine(usage)}_`,
        });
      }
      await useTabsStore.getState().persistTab(tabId);
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        await markStopped();
        return;
      }
      const failed = `Failed: ${String(err)}`;
      if (assistantId) {
        updateOnTab(tabId, assistantId, {
          content: `${routeLine}${failed}`,
        });
      } else {
        appendToTab(tabId, { role: "assistant", content: failed });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const promptBase = draft.trim();
    if ((!promptBase && attachments.length === 0) || !activeTab) return;
    if (inTauri && nativeDictation.listening) void nativeDictation.stop();
    if (!inTauri && webDictation.listening) webDictation.stop({ silent: true });

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
      promptBase ||
      (displayImages.length > 0 ? `(${displayImages.length} image(s))` : "");
    const otherNote =
      otherAttachments.length > 0
        ? `\n\n[Attachments: ${otherAttachments.map((a) => a.name).join(", ")}]`
        : "";

    const turn: QueuedTurn = {
      id: crypto.randomUUID(),
      tabId: activeTab.id,
      promptBase,
      userVisible,
      otherNote,
      displayImages,
      attachments: [...attachments],
    };

    setActiveDraft("");
    setAttachments([]);
    setComposerError(null);

    if (runningRef.current) {
      syncQueue([...queueRef.current, turn]);
      return;
    }
    void drainQueue(turn);
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSubmit(e);
    }
  }

  const imageStripItems = attachments
    .filter((a) => a.kind === "image" && a.preview)
    .map((a) => ({ id: a.id, src: a.preview!, name: a.name }));

  const nonImageAttachments = attachments.filter((a) => a.kind !== "image");
  const canSend = draft.trim().length > 0 || imageStripItems.length > 0;
  const visibleQueue = queue.filter((item) => item.tabId === activeTab?.id);

  return (
    <aside className="flex h-full w-full min-w-[280px] flex-col border-l border-[var(--vigil-border)] bg-[var(--vigil-panel)]">
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      <div className="flex h-9 items-center gap-1 overflow-x-auto border-b border-[var(--vigil-border)] bg-[var(--vigil-tab-inactive)] px-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex max-w-[140px] items-center gap-1 rounded-t px-2 py-1 text-[11px] ${
              tab.id === activeTabId
                ? "bg-[var(--vigil-tab-active)] text-[var(--vigil-text)]"
                : "text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            }`}
          >
            <button
              type="button"
              className="truncate"
              onClick={() => setActive(tab.id)}
              onDoubleClick={() => {
                const title = window.prompt("Rename chat", tab.title);
                if (title) renameTab(tab.id, title);
              }}
            >
              {tab.title}
            </button>
            <button
              type="button"
              className="opacity-60 hover:opacity-100"
              onClick={() => void closeTab(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="px-2 text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
          title="New chat tab"
          onClick={() => newTab(`Chat ${tabs.length + 1}`)}
        >
          +
        </button>
        <div className="ml-auto flex items-center gap-2 pr-2 text-[10px] text-[var(--vigil-muted)]">
          <span>Session {formatUsd(sessionTotal.cost)}</span>
          <select
            className="rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-1 py-0.5"
            value={preferredProvider}
            onChange={(e) =>
              setPreferredProvider(e.target.value as typeof preferredProvider)
            }
          >
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <button
            type="button"
            onClick={() => openSettingsGate()}
            className="hover:text-[var(--vigil-text)]"
            title="Unlock Settings"
          >
            Settings
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="rounded border border-dashed border-[var(--vigil-border)] p-3 text-xs text-[var(--vigil-muted)]">
            Ask Vigil anything. Paste images, or use the mic for Arabic / English
            voice. Tabs keep separate sessions.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded px-3 py-2 text-sm leading-relaxed ${
              m.role === "user"
                ? "ml-6 bg-[var(--vigil-accent-soft)]"
                : "mr-2 border border-[var(--vigil-border)] bg-[var(--vigil-editor)]"
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-[var(--vigil-muted)]">
              <span>
                {m.role}
                {m.modelLabel ? ` · ${m.modelLabel}` : ""}
              </span>
              {m.role === "user" && m.id === runningUserMessageId && (
                <button
                  type="button"
                  title="Stop this command"
                  aria-label="Stop this command"
                  className="inline-flex items-center gap-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-1.5 py-0.5 normal-case tracking-normal text-[var(--vigil-danger)] hover:bg-[var(--vigil-hover)]"
                  onClick={cancelRunning}
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  Stop
                </button>
              )}
            </div>
            {m.role === "user" && m.images && m.images.length > 0 && (
              <ImageStrip
                images={m.images.map((img) => ({
                  id: img.id,
                  src: img.dataUrl,
                  name: img.name,
                }))}
                onOpen={setLightboxSrc}
              />
            )}
            {m.role === "assistant" ? (
              <MarkdownMessage content={m.content} />
            ) : (
              <div
                className="whitespace-pre-wrap"
                dir="auto"
                style={{ unicodeBidi: "plaintext" }}
              >
                {m.content}
              </div>
            )}
          </div>
        ))}
        {isRunning && runningTabId === activeTab?.id && (
          <div className="text-xs text-[var(--vigil-muted)]">Thinking…</div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="border-t border-[var(--vigil-border)] p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFilesSelected(e.dataTransfer.files);
        }}
      >
        <ImageStrip
          images={imageStripItems}
          removable
          onRemove={(id) =>
            setAttachments((prev) => prev.filter((a) => a.id !== id))
          }
          onOpen={setLightboxSrc}
        />

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
          value={draft}
          dir="auto"
          style={{ unicodeBidi: "plaintext" }}
          onChange={(e) => setActiveDraft(e.target.value)}
          onPaste={onPaste}
          onKeyDown={onComposerKeyDown}
          rows={3}
          placeholder={
            isRunning
              ? "Queue a follow-up… it runs when the current turn finishes"
              : "Ask anything… paste an image, or use the mic"
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

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              title="Attach"
              className="rounded border border-[var(--vigil-border)] px-2 py-1 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              📎
            </button>
            <button
              type="button"
              title="Clear text and attachments"
              aria-label="Clear text and attachments"
              disabled={!draft.trim() && attachments.length === 0}
              className="rounded border border-[var(--vigil-border)] p-1 text-[var(--vigil-muted)] hover:text-[var(--vigil-danger)] disabled:opacity-40"
              onClick={clearComposer}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <SpeechDictationMicButton
              size="sm"
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
            className={`flex h-8 w-8 items-center justify-center rounded-full text-white disabled:opacity-40 ${
              isRunning
                ? "bg-[var(--vigil-danger)]"
                : "bg-[var(--vigil-accent)]"
            }`}
          >
            {isRunning ? (
              <Square className="h-3 w-3 fill-current" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>
    </aside>
  );
}
