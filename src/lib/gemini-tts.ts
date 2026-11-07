/**
 * Gemini text-to-speech for chat messages.
 * Arabic → Egyptian (ar-EG). Other scripts follow the written language.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getApiKeyQuiet } from "./secure-storage";

const TTS_MODELS = [
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-2.5-flash-preview-tts",
];

const ARABIC_RE = /[\u0600-\u06FF]/;
const MAX_CHARS = 4500;

let cachedGeminiKey: string | null = null;

export type GeminiSpeech = {
  blob: Blob;
  mimeType: string;
  model: string;
  languageCode: string | null;
};

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await tauriFetch(url, init);
  } catch (err) {
    if (init.signal?.aborted || isAbortError(err)) throw err;
    return fetch(url, init);
  }
}

async function resolveGeminiKey(): Promise<string> {
  if (cachedGeminiKey) return cachedGeminiKey;
  const key = await getApiKeyQuiet("gemini");
  cachedGeminiKey = key;
  return key;
}

/** Drop markdown chrome so the voice reads the answer, not the markup. */
export function speakableMessageText(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").trim();
  text = text.replace(/\n+_Cost:[^\n]*_?\s*$/i, "");
  text = text.replace(/^Routed as[^\n]*\n+/i, "");
  text = text.replace(/```[\s\S]*?```/g, (block) => {
    const inner = block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim();
    return inner ? `\n${inner}\n` : "\n";
  });
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS).trim()}…`;
  return text;
}

export function speechLanguageForText(text: string): string | null {
  return ARABIC_RE.test(text) ? "ar-EG" : null;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function parseRate(mimeType: string): number {
  const match = /rate=(\d+)/i.exec(mimeType);
  return match ? Number(match[1]) : 24000;
}

function pcmToWav(pcm: Uint8Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const channels = 1;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: "audio/wav" });
}

function extractAudio(data: unknown): { bytes: Uint8Array; mimeType: string } | null {
  const d = data as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
          inline_data?: { data?: string; mime_type?: string };
        }>;
      };
    }>;
  };
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    const b64 = inline?.data;
    if (!b64) continue;
    const mimeType =
      part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? "audio/pcm";
    return { bytes: decodeBase64(b64), mimeType };
  }
  return null;
}

function toPlayableBlob(bytes: Uint8Array, mimeType: string): Blob {
  const lower = mimeType.toLowerCase();
  if (lower.includes("wav") || lower.startsWith("audio/wav")) {
    return new Blob([bytes], { type: "audio/wav" });
  }
  if (
    lower.includes("mpeg") ||
    lower.includes("mp3") ||
    lower.includes("ogg") ||
    lower.includes("mp4") ||
    lower.includes("aac")
  ) {
    return new Blob([bytes], { type: mimeType });
  }
  return pcmToWav(bytes, parseRate(mimeType));
}

function buildPrompt(text: string, languageCode: string | null): string {
  if (languageCode === "ar-EG") {
    return (
      "Read the following text aloud in natural Egyptian Arabic (Masri) colloquial pronunciation. " +
      "Keep English words, code, and names clear when they appear.\n\n" +
      text
    );
  }
  return (
    "Read the following text aloud clearly in the language it is written in. " +
    "Keep code identifiers and names exact.\n\n" +
    text
  );
}

export type SynthesizeSpeechOptions = {
  signal?: AbortSignal;
  voiceName?: string;
};

/** Generate a playable/downloadable audio blob for a chat message. */
export async function synthesizeMessageSpeech(
  rawText: string,
  options: SynthesizeSpeechOptions | AbortSignal = {},
): Promise<GeminiSpeech> {
  const opts: SynthesizeSpeechOptions =
    options instanceof AbortSignal ? { signal: options } : options;
  const text = speakableMessageText(rawText);
  if (!text) throw new Error("Nothing to read in this message.");

  const languageCode = speechLanguageForText(text);
  const apiKey = await resolveGeminiKey();
  const prompt = buildPrompt(text, languageCode);
  const voiceName = opts.voiceName?.trim() || "Sulafat";

  let lastErr = "No Gemini TTS model available";
  for (const model of TTS_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const speechConfig: Record<string, unknown> = {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName },
      },
    };
    if (languageCode) speechConfig.languageCode = languageCode;

    try {
      const res = await httpFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: opts.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig,
          },
        }),
      });
      if (!res.ok) {
        lastErr = `Gemini TTS ${model}: HTTP ${res.status}`;
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          cachedGeminiKey = null;
        }
        continue;
      }
      const data = await res.json();
      const audio = extractAudio(data);
      if (!audio) {
        lastErr = `Gemini TTS ${model}: empty audio`;
        continue;
      }
      const blob = toPlayableBlob(audio.bytes, audio.mimeType);
      return { blob, mimeType: blob.type, model, languageCode };
    } catch (err) {
      if (opts.signal?.aborted || isAbortError(err)) throw err;
      lastErr = String(err);
    }
  }
  throw new Error(lastErr);
}

export async function prefetchGeminiTtsKey(): Promise<void> {
  await resolveGeminiKey();
}
