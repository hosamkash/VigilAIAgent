/**
 * Cheap one-shot Gemini completions for SCM (commit msgs, branch names, review).
 * Uses model-router fast tier — avoids full Cline agent loop.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getApiKey } from "./secure-storage";
import { routeTask, GEMINI_FAST_FALLBACKS } from "./model-router";
import { sanitizeBranchName } from "./git";

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

export async function geminiComplete(
  prompt: string,
  options: { maxTokens?: number } = {},
): Promise<{ text: string; model: string }> {
  const routed = routeTask({ prompt, forceTier: "fast" });
  const apiKey = await getApiKey("gemini");
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
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: options.maxTokens ?? 256,
          },
        }),
      });
      if (!res.ok) {
        lastErr = `Gemini ${model}: HTTP ${res.status}`;
        continue;
      }
      const data = await res.json();
      const text = extractText(data);
      if (text) return { text, model };
      lastErr = `Gemini ${model}: empty response`;
    } catch (err) {
      lastErr = String(err);
    }
  }
  throw new Error(lastErr);
}

function oneLine(text: string): string {
  return text
    .replace(/^```[\s\S]*?```/g, "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#"))
    ?.replace(/^["']|["']$/g, "")
    ?? text.trim().split("\n")[0]?.trim()
    ?? "";
}

/** Subject + optional body — clear, not a one-word stub. */
export function normalizeCommitMessage(text: string): string {
  let raw = text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```[\w]*\n?/, "").replace(/\n?```\s*$/, "");
  }
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/^["']|["']$/g, "").trimEnd());
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  if (!lines.length) return "";

  const subject = lines[0]!.trim().replace(/^#+\s*/, "").slice(0, 100);
  const bodyLines = lines
    .slice(1)
    .map((l) => l.trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1]!.length > 0));
  // Drop a leading blank after subject, then keep up to ~6 body lines.
  while (bodyLines[0] === "") bodyLines.shift();
  const body = bodyLines.slice(0, 8).join("\n").trim();
  return body ? `${subject}\n\n${body}` : subject;
}

export async function generateCommitMessage(diff: string): Promise<{
  message: string;
  model: string;
}> {
  const clipped = diff.slice(0, 14_000);
  if (!clipped.trim()) {
    return {
      message: "Initial commit: Project setup",
      model: "local",
    };
  }
  const prompt = `You write clear git commit messages for developers.
Reply with ONLY the commit message — no markdown fences, no quotes, no preamble.

Format:
1) First line: conventional commit subject
   type(scope): plain-English summary of what changed
   Types: feat, fix, docs, style, refactor, test, chore, build, ci
   Subject ≤ 72 characters, specific (not "update files" / "fixes").
2) Blank line
3) Body: 2–4 short lines explaining what changed and why (simple language).
   Prefer bullets starting with "- ".

DIFF:
${clipped}`;

  const { text, model } = await geminiComplete(prompt, { maxTokens: 320 });
  const message = normalizeCommitMessage(text);
  return {
    message: message || "chore: update project files",
    model,
  };
}

export async function suggestBranchName(description: string): Promise<{
  name: string;
  model: string;
}> {
  const desc = description.trim();
  if (!desc) {
    return { name: "feature/new-branch", model: "local" };
  }
  const prompt = `Suggest ONE git branch name for this work description.
Rules: lowercase, hyphens, optional prefix feat/ fix/ chore/ or numbered like 01-project-phase1
NO commas, NO spaces, NO quotes. Reply with only the branch name.

Description: ${desc}`;

  try {
    const { text, model } = await geminiComplete(prompt, { maxTokens: 40 });
    const name = sanitizeBranchName(oneLine(text));
    return { name, model };
  } catch {
    return { name: sanitizeBranchName(desc), model: "local" };
  }
}

export async function reviewDiffWithAi(diff: string): Promise<{
  review: string;
  model: string;
}> {
  const clipped = diff.slice(0, 14_000);
  const prompt = `You are a senior code reviewer. Review this git diff.
List concrete issues (bugs, security, missing tests) as a short bullet list.
If clean, say "No major issues found." Be concise.

DIFF:
${clipped}`;
  const { text, model } = await geminiComplete(prompt, { maxTokens: 500 });
  return { review: text, model };
}

export async function resolveConflictWithAi(input: {
  path: string;
  ours: string;
  theirs: string;
  base?: string;
}): Promise<{ merged: string; model: string }> {
  const prompt = `Merge this git conflict. Return ONLY the full resolved file content, no markdown fences.

Path: ${input.path}

BASE:
${(input.base ?? "").slice(0, 4000)}

OURS (current branch):
${input.ours.slice(0, 6000)}

THEIRS (incoming):
${input.theirs.slice(0, 6000)}`;

  const { text, model } = await geminiComplete(prompt, { maxTokens: 4096 });
  let merged = text.trim();
  if (merged.startsWith("```")) {
    merged = merged.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "");
  }
  return { merged, model };
}
