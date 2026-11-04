import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChatStore, type ChatMessage } from "../store/chatStore";
import { useSettingsStore } from "../store/settingsStore";
import { useEditorTabsStore } from "../store/editorTabsStore";
import { useTabsStore } from "../store/tabsStore";
import { useCostStore, formatUsd } from "../store/costStore";
import { useTerminalStore } from "../store/terminalStore";
import { routeTask } from "../lib/model-router";
import { runVigilTask } from "../lib/cline-engine";
import { formatUsageLine, type UsageSnapshot } from "../lib/cost";
import { MarkdownMessage } from "./MarkdownMessage";

type Attachment = {
  id: string;
  name: string;
  kind: "file" | "image" | "video" | "folder";
  preview?: string;
  path?: string;
};

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognition;
    SpeechRecognition?: new () => SpeechRecognition;
  }
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  results: { [index: number]: { [index: number]: { transcript: string } } };
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
    persistActive,
    updateActiveMessages,
    setActiveDraft,
    hydrate,
  } = useTabsStore();
  const { sessionTotal, recordEstimate } = useCostStore();

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const messages = activeTab?.messages ?? [];
  const draft = activeTab?.draft ?? "";
  const [isRunning, setRunning] = useState(false);
  const [listening, setListening] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!activeTabId && tabs[0]) setActive(tabs[0].id);
  }, [activeTabId, tabs, setActive]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isRunning]);

  function currentMessages(): ChatMessage[] {
    const state = useTabsStore.getState();
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return tab?.messages ?? [];
  }

  function setMessages(next: ChatMessage[]) {
    updateActiveMessages(next);
  }

  function appendMessage(
    msg: Omit<ChatMessage, "id" | "createdAt"> & { id?: string },
  ): string {
    const id = msg.id ?? crypto.randomUUID();
    const next = [
      ...currentMessages(),
      {
        id,
        createdAt: Date.now(),
        role: msg.role,
        content: msg.content,
        modelLabel: msg.modelLabel,
      },
    ];
    setMessages(next);
    return id;
  }

  function updateMessage(
    id: string,
    patch: Partial<Pick<ChatMessage, "content" | "modelLabel">>,
  ) {
    setMessages(
      currentMessages().map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const promptBase = draft.trim();
    if (!promptBase || isRunning || !activeTab) return;

    const attachNote =
      attachments.length > 0
        ? `\n\n[Attachments: ${attachments.map((a) => a.name).join(", ")}]`
        : "";
    const prompt = `${promptBase}${attachNote}`;
    const routed = routeTask({ prompt, preferredProvider });
    setActiveDraft("");
    setAttachments([]);
    appendMessage({ role: "user", content: prompt });
    setRunning(true);

    const assistantId = appendMessage({
      role: "assistant",
      content: `Routed as **${routed.tier}** → \`${routed.clineProviderId}/${routed.modelId}\`\n\n`,
      modelLabel: routed.modelId,
    });

    let streamed = "";
    let usage: UsageSnapshot | null = null;

    try {
      for await (const event of runVigilTask(prompt, {
        preferredProvider,
        model: routed,
        clientName: "vigil-agent",
      })) {
        if (event.type === "chunk" && event.text) {
          streamed += event.text;
          updateMessage(assistantId, {
            content: `Routed as **${routed.tier}** → \`${routed.clineProviderId}/${routed.modelId}\`\n\n${streamed}`,
          });
          appendOutput(event.text);
        } else if (event.type === "tool" && event.toolName === "write_file") {
          const path = event.path ?? "untitled";
          const content = event.content ?? "";
          showAgentDiff(path, "", content);
          streamed += `\n\n✓ Wrote \`${path}\``;
          updateMessage(assistantId, {
            content: `Routed as **${routed.tier}** → \`${routed.clineProviderId}/${routed.modelId}\`\n\n${streamed}`,
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
              prompt,
              streamed,
              routed.providerId,
              routed.modelId,
              activeTab.id,
            ));
          updateMessage(assistantId, {
            content: `Routed as **${routed.tier}** → \`${routed.clineProviderId}/${routed.modelId}\`\n\n${streamed}\n\n_${formatUsageLine(usage)}_`,
          });
        } else if (event.type === "error") {
          streamed += `\n\nError: ${event.message}`;
          updateMessage(assistantId, {
            content: `Routed as **${routed.tier}** → \`${routed.clineProviderId}/${routed.modelId}\`\n\n${streamed}`,
          });
        }
      }
      if (!usage && streamed) {
        usage = await recordEstimate(
          prompt,
          streamed,
          routed.providerId,
          routed.modelId,
          activeTab.id,
        );
        updateMessage(assistantId, {
          content: `Routed as **${routed.tier}** → \`${routed.clineProviderId}/${routed.modelId}\`\n\n${streamed}\n\n_${formatUsageLine(usage)}_`,
        });
      }
      await persistActive();
    } catch (err) {
      updateMessage(assistantId, {
        content: `Routed as **${routed.tier}** → \`${routed.clineProviderId}/${routed.modelId}\`\n\nFailed: ${String(err)}`,
      });
    } finally {
      setRunning(false);
    }
  }

  function startVoice() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      window.alert("Speech recognition not supported in this webview.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    setListening(true);
    rec.onresult = (ev) => {
      const text = ev.results[0]?.[0]?.transcript ?? "";
      setActiveDraft(draft ? `${draft} ${text}` : text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  }

  function onFilesSelected(files: FileList | null) {
    if (!files) return;
    const next: Attachment[] = [];
    Array.from(files).forEach((file) => {
      const kind: Attachment["kind"] = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : "file";
      const id = crypto.randomUUID();
      const item: Attachment = { id, name: file.name, kind };
      if (kind === "image") {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === id ? { ...a, preview: String(reader.result) } : a,
            ),
          );
        };
        reader.readAsDataURL(file);
      }
      next.push(item);
    });
    setAttachments((prev) => [...prev, ...next]);
  }

  return (
    <aside className="flex h-full w-full min-w-[280px] flex-col border-l border-[var(--vigil-border)] bg-[var(--vigil-panel)]">
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
            <button type="button" className="truncate" onClick={() => setActive(tab.id)} onDoubleClick={() => {
              const title = window.prompt("Rename chat", tab.title);
              if (title) renameTab(tab.id, title);
            }}>
              {tab.title}
            </button>
            <button type="button" className="opacity-60 hover:opacity-100" onClick={() => void closeTab(tab.id)}>×</button>
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
            Ask Vigil anything. Tabs keep separate Cline sessions. Costs show under replies.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded px-3 py-2 text-sm leading-relaxed ${
              m.role === "user"
                ? "ml-6 bg-[var(--vigil-accent-soft)]"
                : "mr-2 bg-[var(--vigil-editor)] border border-[var(--vigil-border)]"
            }`}
          >
            <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--vigil-muted)]">
              {m.role}
              {m.modelLabel ? ` · ${m.modelLabel}` : ""}
            </div>
            {m.role === "assistant" ? (
              <MarkdownMessage content={m.content} />
            ) : (
              <div className="whitespace-pre-wrap">{m.content}</div>
            )}
          </div>
        ))}
        {isRunning && <div className="text-xs text-[var(--vigil-muted)]">Thinking…</div>}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-[var(--vigil-border)] p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFilesSelected(e.dataTransfer.files);
        }}
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-editor)] px-2 py-1 text-[10px]"
              >
                {a.preview ? (
                  <img src={a.preview} alt="" className="h-6 w-6 rounded object-cover" />
                ) : (
                  <span>{a.kind === "folder" ? "📁" : "📄"}</span>
                )}
                <span className="max-w-[100px] truncate">{a.name}</span>
                <button type="button" onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))}>×</button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => setActiveDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSubmit(e);
            }
          }}
          rows={3}
          placeholder="What can I do for you? Drop files here…"
          className="w-full resize-none rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--vigil-accent)]"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
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
              title="Voice"
              className={`rounded border border-[var(--vigil-border)] px-2 py-1 text-xs ${listening ? "bg-[var(--vigil-danger)] text-white" : ""}`}
              onClick={startVoice}
            >
              🎤
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => onFilesSelected(e.target.files)}
            />
          </div>
          <button
            type="submit"
            disabled={isRunning || !draft.trim()}
            className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
