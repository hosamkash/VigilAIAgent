/**
 * Gemini multimodal helpers for chat composer:
 * - vision: analyze attached images in context of user text
 * - audio: speech-to-text (Arabic Egyptian / English, no language picker)
 *
 * Uses getApiKeyQuiet so voice/image helpers never trigger Touch ID.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getApiKeyQuiet } from "./secure-storage";
import { routeTask, GEMINI_FAST_FALLBACKS } from "./model-router";

export type GeminiInlineMedia = {
  mimeType: string;
  /** Raw base64 without data: prefix */
  data: string;
};

const MAX_IMAGES = 4;
const MAX_IMAGE_EDGE = 1600;
const MAX_DATA_URL_CHARS = 1_800_000;

/** In-memory Gemini key for this app session (avoids repeated Keychain hits). */
let cachedGeminiKey: string | null = null;

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

function extractText(data: unknown): string {
  const d = data as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("").trim();
}

function parseDataUrl(dataUrl: string): GeminiInlineMedia | null {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  return { mimeType: m[1]!, data: m[2]! };
}

async function resolveGeminiKey(): Promise<string> {
  if (cachedGeminiKey) return cachedGeminiKey;
  const key = await getApiKeyQuiet("gemini");
  cachedGeminiKey = key;
  return key;
}

/** Resize/compress a data URL for Gemini payload limits. */
export async function compressImageDataUrl(
  dataUrl: string,
  maxEdge = MAX_IMAGE_EDGE,
): Promise<string> {
  if (dataUrl.length <= MAX_DATA_URL_CHARS / 2) return dataUrl;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= 0 || height <= 0) {
        resolve(dataUrl);
        return;
      }
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      let quality = 0.85;
      let out = canvas.toDataURL("image/jpeg", quality);
      while (out.length > MAX_DATA_URL_CHARS && quality > 0.45) {
        quality -= 0.1;
        out = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(out);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function geminiGenerate(
  parts: unknown[],
  maxTokens: number,
  signal?: AbortSignal,
): Promise<{
  text: string;
  model: string;
}> {
  const routed = routeTask({ prompt: "multimodal", forceTier: "fast" });
  const apiKey = await resolveGeminiKey();
  const models = [
    routed.modelId,
    ...GEMINI_FAST_FALLBACKS.filter((m) => m !== routed.modelId),
  ];

  let lastErr = "No Gemini model available";
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await httpFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: maxTokens,
          },
        }),
      });
      if (!res.ok) {
        lastErr = `Gemini ${model}: HTTP ${res.status}`;
        // Bad key — clear cache so next call re-reads
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          cachedGeminiKey = null;
        }
        continue;
      }
      const data = await res.json();
      const text = extractText(data);
      if (text) return { text, model };
      lastErr = `Gemini ${model}: empty response`;
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      lastErr = String(err);
    }
  }
  throw new Error(lastErr);
}

/**
 * Analyze images in the context of the user text, then build an enriched
 * text prompt for the sidecar (which accepts text only).
 */
export async function enrichPromptWithImageAnalysis(
  userText: string,
  imageDataUrls: string[],
  signal?: AbortSignal,
): Promise<{ prompt: string; model?: string }> {
  const urls = imageDataUrls.slice(0, MAX_IMAGES);
  if (urls.length === 0) return { prompt: userText };

  const compressed = await Promise.all(urls.map((u) => compressImageDataUrl(u)));
  const media = compressed
    .map(parseDataUrl)
    .filter((m): m is GeminiInlineMedia => Boolean(m));

  if (media.length === 0) return { prompt: userText };

  const parts: unknown[] = [
    {
      text:
        "Analyze the attached image(s) in the context of the user's request. " +
        "Describe what is visible that matters for fulfilling the request " +
        "(UI text, errors, code, layout, etc.). Reply in the same language as the user when clear; " +
        "otherwise English. Be concrete and concise.\n\n" +
        `User request:\n${userText}`,
    },
    ...media.map((m) => ({
      inline_data: { mime_type: m.mimeType, data: m.data },
    })),
  ];

  const { text, model } = await geminiGenerate(parts, 1024, signal);
  return {
    model,
    prompt: `${userText}\n\n[Attached image analysis]\n${text}`,
  };
}

/** Transcribe audio (webm/ogg/wav/mp3) via Gemini. Arabic Egyptian or English. */
export async function transcribeAudioWithGemini(
  blob: Blob,
): Promise<{ text: string; model: string }> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const data = btoa(binary);
  const mimeType = blob.type || "audio/webm";

  const parts = [
    {
      text:
        "Transcribe this audio exactly. The speaker may use Arabic (including Egyptian dialect) or English, or both. " +
        "Return ONLY the transcript text with no quotes, labels, or commentary.",
    },
    { inline_data: { mime_type: mimeType, data } },
  ];

  return geminiGenerate(parts, 1024);
}

/** Warm the quiet Gemini key cache (call when starting mic). */
export async function prefetchGeminiKeyQuiet(): Promise<void> {
  await resolveGeminiKey();
}

export const COMPOSER_MAX_IMAGES = MAX_IMAGES;
