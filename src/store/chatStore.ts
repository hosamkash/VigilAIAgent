import { create } from "zustand";
import {
  DEFAULT_VOICE_BY_GENDER,
  resolveTtsVoiceId,
  type ReplyLength,
  type ReplyTone,
  type VoiceGender,
} from "../lib/chat-preferences";
import { CHAT_MODEL_OPTIONS } from "../lib/model-router";

const CHAT_MODEL_KEY = "vigil.chat.model";
const CHAT_TONE_KEY = "vigil.chat.replyTone";
const CHAT_LENGTH_KEY = "vigil.chat.replyLength";
const CHAT_VOICE_GENDER_KEY = "vigil.chat.voiceGender";
const CHAT_VOICE_ID_KEY = "vigil.chat.voiceId";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Ignore a full or blocked store. */
  }
}

function loadChatModel(): string {
  const saved = readStorage(CHAT_MODEL_KEY);
  if (saved && CHAT_MODEL_OPTIONS.some((item) => item.id === saved)) return saved;
  return "auto";
}

function saveChatModel(id: string) {
  writeStorage(CHAT_MODEL_KEY, id);
}

function loadReplyTone(): ReplyTone {
  return readStorage(CHAT_TONE_KEY) === "formal" ? "formal" : "colloquial";
}

function loadReplyLength(): ReplyLength {
  return readStorage(CHAT_LENGTH_KEY) === "detailed" ? "detailed" : "brief";
}

function loadVoiceGender(): VoiceGender {
  return readStorage(CHAT_VOICE_GENDER_KEY) === "male" ? "male" : "female";
}

function loadVoiceId(gender: VoiceGender): string {
  return resolveTtsVoiceId(gender, readStorage(CHAT_VOICE_ID_KEY) ?? DEFAULT_VOICE_BY_GENDER[gender]);
}

export type ChatRole = "user" | "assistant" | "system";

export type ChatImageAttachment = {
  id: string;
  name: string;
  dataUrl: string;
};

export type ChatEditedFile = {
  path: string;
  label: string;
  /** Optional sides for reopening the agent diff tab. */
  original?: string;
  modified?: string;
};

export type ChatCommandResult = {
  command: string;
  exitCode: number;
  excerpt?: string;
};

export type ChatPlanStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

export type ChatPlanItem = {
  id: string;
  content: string;
  status: ChatPlanStatus;
};

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  modelLabel?: string;
  /** Cursor-like image previews shown on user bubbles */
  images?: ChatImageAttachment[];
  /** Files the agent wrote this turn — open in editor + reveal in Explorer. */
  editedFiles?: ChatEditedFile[];
  /** Shell commands finished this turn (test/fix loop). */
  commandResults?: ChatCommandResult[];
  /** Agent manage_plan steps for this turn. */
  planItems?: ChatPlanItem[];
}

interface ChatState {
  messages: ChatMessage[];
  draft: string;
  isRunning: boolean;
  preferredProvider: string;
  replyTone: ReplyTone;
  replyLength: ReplyLength;
  voiceGender: VoiceGender;
  voiceId: string;
  setDraft: (draft: string) => void;
  setPreferredProvider: (provider: string) => void;
  setReplyTone: (tone: ReplyTone) => void;
  setReplyLength: (length: ReplyLength) => void;
  setVoiceGender: (gender: VoiceGender) => void;
  setVoiceId: (voiceId: string) => void;
  setRunning: (running: boolean) => void;
  appendMessage: (
    msg: Omit<ChatMessage, "id" | "createdAt"> & { id?: string },
  ) => string;
  updateMessage: (
    id: string,
    patch: Partial<
      Pick<
        ChatMessage,
        | "content"
        | "modelLabel"
        | "images"
        | "editedFiles"
        | "commandResults"
        | "planItems"
      >
    >,
  ) => void;
  clearMessages: () => void;
}

const initialVoiceGender = loadVoiceGender();

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  draft: "",
  isRunning: false,
  preferredProvider: loadChatModel(),
  replyTone: loadReplyTone(),
  replyLength: loadReplyLength(),
  voiceGender: initialVoiceGender,
  voiceId: loadVoiceId(initialVoiceGender),
  setDraft: (draft) => set({ draft }),
  setPreferredProvider: (preferredProvider) => {
    const next = CHAT_MODEL_OPTIONS.some((item) => item.id === preferredProvider)
      ? preferredProvider
      : "auto";
    saveChatModel(next);
    set({ preferredProvider: next });
  },
  setReplyTone: (replyTone) => {
    writeStorage(CHAT_TONE_KEY, replyTone);
    set({ replyTone });
  },
  setReplyLength: (replyLength) => {
    writeStorage(CHAT_LENGTH_KEY, replyLength);
    set({ replyLength });
  },
  setVoiceGender: (voiceGender) => {
    const voiceId = resolveTtsVoiceId(voiceGender, get().voiceId);
    writeStorage(CHAT_VOICE_GENDER_KEY, voiceGender);
    writeStorage(CHAT_VOICE_ID_KEY, voiceId);
    set({ voiceGender, voiceId });
  },
  setVoiceId: (requested) => {
    const voiceId = resolveTtsVoiceId(get().voiceGender, requested);
    writeStorage(CHAT_VOICE_ID_KEY, voiceId);
    set({ voiceId });
  },
  setRunning: (isRunning) => set({ isRunning }),
  appendMessage: (msg) => {
    const id = msg.id ?? crypto.randomUUID();
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          createdAt: Date.now(),
          role: msg.role,
          content: msg.content,
          modelLabel: msg.modelLabel,
          images: msg.images,
          editedFiles: msg.editedFiles,
          commandResults: msg.commandResults,
          planItems: msg.planItems,
        },
      ],
    }));
    return id;
  },
  updateMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    })),
  clearMessages: () => set({ messages: [] }),
}));
