/**
 * Cursor-like inline edit (Cmd-K): rewrite a selection via a fast one-shot LLM.
 */

import { geminiComplete } from "./git-ai";

export type InlineEditRequest = {
  path: string;
  language: string;
  instruction: string;
  selection: string;
  startLine: number;
  endLine: number;
  /** Optional surrounding lines for better edits. */
  before?: string;
  after?: string;
};

/** Strip markdown fences the model sometimes wraps around code. */
export function extractEditedCode(raw: string, original: string): string {
  let text = String(raw || "").trim();
  if (!text) return original;
  const fenced = text.match(/^```(?:[\w.+-]*)?\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1]!.trimEnd();
  else if (text.startsWith("```")) {
    text = text
      .replace(/^```[\w.+-]*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trimEnd();
  }
  // Preserve trailing newline style of the original selection when useful.
  if (original.endsWith("\n") && !text.endsWith("\n")) text += "\n";
  return text;
}

export function buildInlineEditPrompt(req: InlineEditRequest): string {
  const lang = req.language || "text";
  const loc = `${req.path}:${req.startLine}-${req.endLine}`;
  const before = (req.before || "").trimEnd();
  const after = (req.after || "").trimStart();
  return `You are Vigil inline edit. Rewrite ONLY the selected code per the instruction.
Return ONLY the replacement code for the selection — no markdown fences, no explanation, no surrounding context.

File: ${loc}
Language: ${lang}
Instruction: ${req.instruction.trim()}

${before ? `Code before selection:\n\`\`\`${lang}\n${before.slice(-800)}\n\`\`\`\n` : ""}
Selected code to replace:
\`\`\`${lang}
${req.selection}
\`\`\`
${after ? `Code after selection:\n\`\`\`${lang}\n${after.slice(0, 800)}\n\`\`\`\n` : ""}
Replacement code:`;
}

export async function runInlineEdit(
  req: InlineEditRequest,
): Promise<{ code: string; model: string }> {
  const instruction = req.instruction.trim();
  if (!instruction) throw new Error("Enter an edit instruction");
  if (!req.selection.trim()) throw new Error("Select code to edit first");

  const { text, model } = await geminiComplete(buildInlineEditPrompt(req), {
    maxTokens: Math.min(8_192, Math.max(512, req.selection.length * 2)),
  });
  return {
    code: extractEditedCode(text, req.selection),
    model,
  };
}
