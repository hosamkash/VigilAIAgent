/**
 * One-shot Gemini helper: turn a natural-language request into a shell
 * command + short description for the Run and Debug panel.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getApiKeyQuiet } from "./secure-storage";
import { GEMINI_FAST_FALLBACKS, routeTask } from "./model-router";

export type RunCommandSuggestion = {
  command: string;
  description: string;
  model: string;
};

async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await tauriFetch(url, init);
  } catch {
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

function unescapeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }
}

/** True when the text looks like a shell command, not Arabic/English prose. */
export function looksLikeShellCommand(command: string): boolean {
  const value = command.trim();
  if (!value || value.length > 800) return false;
  if (/^[\s{["']/.test(value)) return false;
  if (/\b(command|description)\b\s*:/i.test(value)) return false;
  // Pure or mostly prose without shell tokens.
  const hasShellToken =
    /(?:^|[\s;|&])(?:npm|npx|yarn|pnpm|node|bun|deno|vite|tauri|kill|pkill|lsof|fuser|curl|wget|cd|export|source|\.\/)/i.test(
      value,
    ) || /[;&|`$()<>]/.test(value);
  const arabicLetters = (value.match(/[\u0600-\u06FF]/g) ?? []).length;
  if (arabicLetters > value.length * 0.35 && !hasShellToken) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (
    words.length >= 6 &&
    !hasShellToken &&
    words.every((word) => /^[\p{L}\p{M}'’-]+$/u.test(word))
  ) {
    return false;
  }
  return hasShellToken || /^[a-zA-Z0-9_./~-]/.test(value);
}

export function parseSuggestion(raw: string): { command: string; description: string } {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const tryObject = (text: string) => {
    try {
      const parsed = JSON.parse(text) as {
        command?: unknown;
        description?: unknown;
      };
      const command = String(parsed.command ?? "").trim();
      const description = String(parsed.description ?? "").trim();
      if (command && looksLikeShellCommand(command)) {
        return { command, description };
      }
    } catch {
      /* continue */
    }
    return null;
  };

  const direct = tryObject(cleaned);
  if (direct) return direct;

  const braced = cleaned.match(/\{[\s\S]*\}/);
  if (braced) {
    const nested = tryObject(braced[0]!);
    if (nested) return nested;
  }

  const commandMatch = /"command"\s*:\s*"((?:\\.|[^"\\])*)"/i.exec(cleaned);
  const descMatch = /"description"\s*:\s*"((?:\\.|[^"\\])*)"/i.exec(cleaned);
  if (commandMatch?.[1]) {
    const command = unescapeJsonString(commandMatch[1]).trim();
    if (looksLikeShellCommand(command)) {
      return {
        command,
        description: descMatch?.[1] ? unescapeJsonString(descMatch[1]).trim() : "",
      };
    }
  }

  return { command: "", description: "" };
}

/** Build a ready-to-save Run command from what the user asked for. */
export async function suggestRunCommand(
  request: string,
  options: {
    scripts?: Array<{ name: string; command: string; scriptBody?: string }>;
    signal?: AbortSignal;
  } = {},
): Promise<RunCommandSuggestion> {
  const intent = request.trim();
  if (!intent) throw new Error("Describe the command you need first.");

  const scriptLines =
    options.scripts && options.scripts.length > 0
      ? options.scripts
          .slice(0, 40)
          .map((item) => {
            const body = item.scriptBody?.trim();
            return body && body !== item.command
              ? `- ${item.name}: run with \`${item.command}\` (script: ${body})`
              : `- ${item.name}: \`${item.command}\``;
          })
          .join("\n")
      : "(no package.json scripts found)";

  const prompt = `You write ONE macOS zsh/bash terminal shortcut for Vigil IDE.

User request (may be Arabic or English):
${intent}

Project npm scripts:
${scriptLines}

Respond with ONLY valid JSON:
{"command":"...","description":"..."}

Hard rules:
1. "command" MUST be a real shell command the user can paste in Terminal.
2. Prefer existing scripts (example: npm run dev) when they match.
3. If the user wants to free a port then start dev, use a one-liner like:
   lsof -ti:5173 | xargs kill -9 2>/dev/null; npm run dev
   Pick the port that fits the project when known; otherwise use a common Vite port or make it obvious in the command.
4. "description" is a short label in the SAME language as the user request.
5. Never put explanations, Arabic prose, or English paragraphs inside "command".
6. No markdown fences. No extra keys.`;

  const routed = routeTask({ prompt, forceTier: "fast" });
  const apiKey = await getApiKeyQuiet("gemini");
  const models = [
    routed.modelId,
    ...GEMINI_FAST_FALLBACKS.filter((model) => model !== routed.modelId),
  ];

  let lastErr = "No Gemini model available";
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const bodies = [
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 320,
          responseMimeType: "application/json",
        },
      },
      // Some fallbacks reject responseMimeType — retry without it.
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 320,
        },
      },
    ];

    for (const body of bodies) {
      try {
        const res = await httpFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: options.signal,
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          lastErr = `Gemini ${model}: HTTP ${res.status}`;
          continue;
        }
        const data = await res.json();
        const text = extractText(data);
        if (!text) {
          lastErr = `Gemini ${model}: empty response`;
          continue;
        }
        const parsed = parseSuggestion(text);
        if (!parsed.command) {
          lastErr =
            "AI returned text instead of a shell command. Try again with a shorter request.";
          continue;
        }
        return {
          command: parsed.command,
          description:
            parsed.description ||
            ( /[\u0600-\u06FF]/.test(intent) ? "أمر تشغيل" : "Run command"),
          model,
        };
      } catch (err) {
        if (
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          throw err;
        }
        lastErr = String(err);
      }
    }
  }
  throw new Error(lastErr);
}
