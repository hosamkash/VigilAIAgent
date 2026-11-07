import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { GEMINI_FAST_FALLBACKS, routeTask } from "./model-router";
import { getApiKeyQuiet } from "./secure-storage";
import { useTabsStore } from "../store/tabsStore";

const LEADING = [
  /^(?:please|kindly)\s+/i,
  /^(?:can|could|would)\s+you\s+(?:please\s+)?/i,
  /^(?:i\s+(?:want|need)\s+(?:you\s+)?to\s+)/i,
  /^(?:help\s+me\s+(?:to\s+)?)/i,
  /^(?:من فضلك|لو سمحت|يا ريت|ياريت)\s+/,
  /^(?:عايز|عاوز|محتاج|ممكن)\s+(?:ك\s+|انك\s+|إنك\s+)?/,
];

const STOP = new Set([
  "the",
  "a",
  "an",
  "to",
  "for",
  "of",
  "and",
  "or",
  "in",
  "on",
  "at",
  "my",
  "me",
  "i",
  "you",
  "your",
  "with",
  "from",
  "into",
  "about",
  "this",
  "that",
  "just",
  "في",
  "من",
  "على",
  "عن",
  "الى",
  "إلى",
  "و",
  "او",
  "أو",
  "ده",
  "دي",
  "هذا",
  "هذه",
]);

export function displayChatTitle(title: string | undefined | null): string {
  const value = (title ?? "").trim();
  return value || "Chat";
}

export function isDefaultChatTitle(title: string | undefined | null): boolean {
  const value = (title ?? "").trim();
  return (
    value === "" ||
    value === "Chat" ||
    value === "New Chat" ||
    /^Chat \d+$/.test(value)
  );
}

/** Keeps 2 to 4 words. A one-word request stays one word. */
export function clampChatTitle(raw: string): string {
  const line = raw
    .replace(/["'`#*_]/g, "")
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0) ?? "";
  const words = line
    .replace(/[.?!,:;]+$/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  return words.join(" ").slice(0, 48);
}

function formatTitle(words: string[]): string {
  const joined = words.join(" ").trim();
  if (!joined) return "";
  if (/^[\u0600-\u06FF]/.test(joined)) return joined;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** Instant title from the first message, before a model reply arrives. */
export function localChatTitle(prompt: string): string {
  const first =
    prompt
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("[Attachments:")) ?? "";
  if (!first) return "";
  if (/^\(\d+ image/.test(first)) return "Pasted image";
  let text = first.replace(/[.?!]+$/g, "").trim();
  for (const pattern of LEADING) text = text.replace(pattern, "");
  const words = text.split(/\s+/).filter(Boolean);
  const kept = words.filter((word) => !STOP.has(word.toLowerCase()) && !STOP.has(word));
  const picked = (kept.length >= 2 ? kept : words).slice(0, 4);
  return formatTitle(picked);
}

async function quietGeminiTitle(prompt: string): Promise<string> {
  const apiKey = await getApiKeyQuiet("gemini");
  const routed = routeTask({ prompt, forceTier: "fast" });
  const models = [
    routed.modelId,
    ...GEMINI_FAST_FALLBACKS.filter((model) => model !== routed.modelId),
  ];
  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Name this chat from the user's first message.
Reply with 2 or 3 words, and never more than 4.
Use the same language as the message.
The name must describe the request.
No quotes, no punctuation, no explanation.

Message:
${prompt.slice(0, 600)}`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: 24 },
  });
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await httpFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();
      const title = clampChatTitle(text);
      if (title) return title;
    } catch {
      /* try the next model */
    }
  }
  return "";
}

function httpFetch(url: string, init: RequestInit): Promise<Response> {
  return tauriFetch(url, init).catch(() => fetch(url, init));
}

/**
 * Names a still-default tab from its first message.
 * A short local title appears immediately. A model title replaces it
 * only while the user has not renamed the tab.
 *
 * Safe to call before or right after the first user message is appended.
 */
export function nameChatTabFromFirstMessage(tabId: string, prompt: string): void {
  const tab = useTabsStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab || tab.titleCustom || !isDefaultChatTitle(tab.title)) return;
  const userMessages = tab.messages.filter((message) => message.role === "user");
  if (userMessages.length > 1) return;
  const source =
    prompt.trim() ||
    userMessages[0]?.content ||
    "";
  const local = localChatTitle(source);
  if (!local) {
    if (!(tab.title ?? "").trim()) {
      useTabsStore.getState().renameTab(tabId, "Chat", false);
    }
    return;
  }
  useTabsStore.getState().renameTab(tabId, local, false);
  void quietGeminiTitle(source)
    .then((title) => {
      if (!title || title === local) return;
      const current = useTabsStore.getState().tabs.find((item) => item.id === tabId);
      if (!current || current.titleCustom || current.title !== local) return;
      useTabsStore.getState().renameTab(tabId, title, false);
    })
    .catch(() => undefined);
}

/** Fill blank/default titles from the first user message after hydrate. */
export function backfillChatTabTitles(): void {
  const { tabs, renameTab } = useTabsStore.getState();
  for (const tab of tabs) {
    if (tab.titleCustom || !isDefaultChatTitle(tab.title)) continue;
    const first = tab.messages.find((message) => message.role === "user");
    if (!first) {
      if (!(tab.title ?? "").trim()) renameTab(tab.id, "Chat", false);
      continue;
    }
    const local = localChatTitle(first.content);
    renameTab(tab.id, local || "Chat", false);
  }
}
