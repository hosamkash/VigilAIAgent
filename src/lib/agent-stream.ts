import type { UsageSnapshot } from "./cost";

/**
 * Cline sometimes forwards the model protocol (`content_start`, `usage`, …)
 * as the chunk text. This keeps only the answer the user should read.
 */
export class AgentTextStream {
  private pending = "";
  private answer = "";
  private fromProtocol = false;
  private seenUsage: UsageSnapshot | null = null;

  get text(): string {
    return this.answer;
  }

  get usage(): UsageSnapshot | null {
    return this.seenUsage;
  }

  push(chunk: string): string {
    if (!chunk) return this.answer;
    this.pending += chunk;
    this.drain();
    return this.answer;
  }

  /** Use the final answer only when streaming never produced one. */
  adoptFinal(text: string | undefined): string {
    const clean = text?.trim() ?? "";
    if (!clean) return this.answer;
    if (!this.answer) this.answer = text ?? "";
    else if (!this.overlaps(clean) && text && text.startsWith(this.answer)) this.answer = text;
    return this.answer;
  }

  private drain() {
    while (this.pending) {
      const start = this.pending.indexOf("{");
      if (start === -1) {
        this.appendPlain(this.pending);
        this.pending = "";
        return;
      }
      if (start > 0) {
        this.appendPlain(this.pending.slice(0, start));
        this.pending = this.pending.slice(start);
      }
      const end = jsonObjectEnd(this.pending);
      if (end < 0) return;
      const raw = this.pending.slice(0, end);
      this.pending = this.pending.slice(end);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.appendPlain(raw);
        continue;
      }
      this.apply(parsed, raw);
    }
  }

  private apply(parsed: unknown, raw: string) {
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      this.appendPlain(raw);
      return;
    }
    const event = parsed as {
      type?: string;
      contentType?: string;
      text?: unknown;
      accumulated?: unknown;
      usage?: unknown;
    };
    const type = event.type;
    if (type === "usage") {
      this.fromProtocol = true;
      this.seenUsage = readUsage(parsed) ?? this.seenUsage;
      return;
    }
    if (type === "done") {
      this.fromProtocol = true;
      if (!this.answer && typeof event.text === "string") this.answer = event.text;
      this.seenUsage = readUsage(event.usage) ?? this.seenUsage;
      return;
    }
    if (type === "content_end") {
      this.fromProtocol = true;
      if (typeof event.text === "string" && event.text.length >= this.answer.length) {
        this.answer = event.text;
      }
      return;
    }
    if (type === "content_start" || type === "content_delta" || type === "text") {
      if (event.contentType && event.contentType !== "text") return;
      this.fromProtocol = true;
      const accumulated = typeof event.accumulated === "string" ? event.accumulated : null;
      const delta = typeof event.text === "string" ? event.text : "";
      if (accumulated != null) {
        if (
          !this.answer ||
          accumulated.startsWith(this.answer) ||
          this.answer.startsWith(accumulated)
        ) {
          if (accumulated.length >= this.answer.length) this.answer = accumulated;
        } else if (delta && !this.answer.endsWith(delta)) {
          this.answer += delta;
        }
        return;
      }
      if (delta) this.answer += delta;
      return;
    }
    if (typeof type === "string") {
      this.fromProtocol = true;
      return;
    }
    this.appendPlain(raw);
  }

  private appendPlain(value: string) {
    if (!value) return;
    if (this.fromProtocol && this.overlaps(value)) return;
    this.answer += value;
  }

  private overlaps(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed || !this.answer) return false;
    if (this.answer.includes(trimmed) || trimmed.includes(this.answer.trim())) return true;
    const size = Math.min(48, this.answer.length, trimmed.length);
    if (size < 24) return false;
    return (
      this.answer.slice(0, size) === trimmed.slice(0, size) ||
      this.answer.slice(-size) === trimmed.slice(-size)
    );
  }
}

function jsonObjectEnd(input: string): number {
  if (!input.startsWith("{")) return -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function readUsage(value: unknown): UsageSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const inputTokens = numberOrNull(record.totalInputTokens ?? record.inputTokens);
  const outputTokens = numberOrNull(record.totalOutputTokens ?? record.outputTokens);
  const cost = numberOrNull(record.totalCost ?? record.cost);
  if (inputTokens == null && outputTokens == null && cost == null) return null;
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cost: cost ?? 0,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
