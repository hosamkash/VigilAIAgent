import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Settings, X } from "lucide-react";
import {
  voicesForGender,
  type ReplyLength,
  type ReplyTone,
  type VoiceGender,
} from "../lib/chat-preferences";
import { notify } from "../lib/ide-commands";
import { CHAT_MODEL_OPTIONS } from "../lib/model-router";
import {
  PROJECT_RULES_REL,
  ensureProjectRules,
} from "../lib/project-rules";
import { readTextFile } from "../lib/workspace-fs";
import { useChatStore } from "../store/chatStore";
import { useEditorTabsStore } from "../store/editorTabsStore";
import { useExplorerStore } from "../store/explorerStore";

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-[var(--vigil-muted)]">
      <span>{label}</span>
      {children}
    </label>
  );
}

function selectClassName() {
  return "h-7 w-full rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 text-[11px] text-[var(--vigil-text)]";
}

/** Shared fields for the composer popover and the main Settings page. */
export function ChatPreferencesFields({ compact = false }: { compact?: boolean }) {
  const preferredProvider = useChatStore((s) => s.preferredProvider);
  const setPreferredProvider = useChatStore((s) => s.setPreferredProvider);
  const replyTone = useChatStore((s) => s.replyTone);
  const setReplyTone = useChatStore((s) => s.setReplyTone);
  const replyLength = useChatStore((s) => s.replyLength);
  const setReplyLength = useChatStore((s) => s.setReplyLength);
  const voiceGender = useChatStore((s) => s.voiceGender);
  const setVoiceGender = useChatStore((s) => s.setVoiceGender);
  const voiceId = useChatStore((s) => s.voiceId);
  const setVoiceId = useChatStore((s) => s.setVoiceId);
  const model =
    CHAT_MODEL_OPTIONS.some((item) => item.id === preferredProvider)
      ? preferredProvider
      : "auto";
  const voices = voicesForGender(voiceGender);

  return (
    <div className={`grid gap-3 ${compact ? "" : "max-w-lg"}`}>
      <Field label="Model">
        <select
          aria-label="Model"
          className={selectClassName()}
          value={model}
          onChange={(event) => setPreferredProvider(event.target.value)}
        >
          {CHAT_MODEL_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Voice">
          <select
            aria-label="Voice gender"
            className={selectClassName()}
            value={voiceGender}
            onChange={(event) => setVoiceGender(event.target.value as VoiceGender)}
          >
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </Field>
        <Field label="Voice style">
          <select
            aria-label="Voice style"
            className={selectClassName()}
            value={voiceId}
            onChange={(event) => setVoiceId(event.target.value)}
          >
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label} · {voice.hint}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Reply language style">
        <select
          aria-label="Reply language style"
          className={selectClassName()}
          value={replyTone}
          onChange={(event) => setReplyTone(event.target.value as ReplyTone)}
        >
          <option value="colloquial">Colloquial (Egyptian Arabic / informal)</option>
          <option value="formal">Formal (MSA / formal)</option>
        </select>
      </Field>

      <Field label="Reply length">
        <select
          aria-label="Reply length"
          className={selectClassName()}
          value={replyLength}
          onChange={(event) => setReplyLength(event.target.value as ReplyLength)}
        >
          <option value="brief">Brief</option>
          <option value="detailed">Detailed</option>
        </select>
      </Field>

      <ProjectRulesOption />
    </div>
  );
}

function ProjectRulesOption() {
  const root = useExplorerStore((s) => s.root);
  const refresh = useExplorerStore((s) => s.refresh);
  const openFile = useEditorTabsStore((s) => s.openFile);
  const [busy, setBusy] = useState(false);

  async function openRules() {
    if (!root) {
      notify("Open a project first");
      return;
    }
    setBusy(true);
    try {
      const { path, created } = await ensureProjectRules(root);
      const content = await readTextFile(path);
      openFile({ path, content });
      void refresh(root);
      notify(
        created
          ? `Created ${PROJECT_RULES_REL}`
          : `Opened ${PROJECT_RULES_REL}`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-2">
      <div className="text-[11px] font-medium text-[var(--vigil-text)]">
        Project rules
      </div>
      <p className="mt-1 text-[10px] leading-snug text-[var(--vigil-muted)]">
        Local reference for this project ({PROJECT_RULES_REL}). The agent
        reads it before each command. Stays on this machine.
      </p>
      <button
        type="button"
        disabled={busy}
        className="mt-2 h-7 w-full rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 text-[11px] !text-[var(--vigil-text)] hover:bg-[var(--vigil-hover)] disabled:opacity-50"
        onClick={() => void openRules()}
      >
        {busy ? "Opening…" : "Open project rules"}
      </button>
    </div>
  );
}

export function ChatQuickSettingsButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="shrink-0">
      <button
        type="button"
        title="Chat settings"
        aria-label="Chat settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-bg)] text-[var(--vigil-muted)] hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
        onClick={() => setOpen((value) => !value)}
      >
        <Settings className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="chat-quick-settings-title"
              className="max-h-[min(32rem,calc(100vh-2rem))] w-full max-w-md overflow-y-auto rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-4 shadow-2xl"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div
                  id="chat-quick-settings-title"
                  className="text-sm font-semibold text-[var(--vigil-text)]"
                >
                  Chat settings
                </div>
                <button
                  type="button"
                  title="Close"
                  aria-label="Close"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--vigil-muted)] hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ChatPreferencesFields />
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  className="rounded-md bg-[var(--vigil-accent)] px-3 py-1.5 text-xs !text-white"
                  onClick={() => setOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
