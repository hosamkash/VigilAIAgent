/**
 * Same rules as src/lib/agent-stream.ts.
 * The sidecar runs in Node and cannot import the TypeScript module.
 */

export class AgentTextStream {
  constructor() {
    this.pending = "";
    this.answer = "";
    this.fromProtocol = false;
    this.seenUsage = null;
  }

  get text() {
    return this.answer;
  }

  get usage() {
    return this.seenUsage;
  }

  push(chunk) {
    if (!chunk) return this.answer;
    this.pending += chunk;
    this.drain();
    return this.answer;
  }

  adoptFinal(text) {
    const clean = text?.trim() ?? "";
    if (!clean) return this.answer;
    if (!this.answer) this.answer = text ?? "";
    else if (!this.overlaps(clean) && text && text.startsWith(this.answer)) this.answer = text;
    return this.answer;
  }

  drain() {
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
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.appendPlain(raw);
        continue;
      }
      this.apply(parsed, raw);
    }
  }

  apply(parsed, raw) {
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      this.appendPlain(raw);
      return;
    }
    const type = parsed.type;
    if (type === "usage") {
      this.fromProtocol = true;
      this.seenUsage = readUsage(parsed) ?? this.seenUsage;
      return;
    }
    if (type === "done") {
      this.fromProtocol = true;
      if (!this.answer && typeof parsed.text === "string") this.answer = parsed.text;
      this.seenUsage = readUsage(parsed.usage) ?? this.seenUsage;
      return;
    }
    if (type === "content_end") {
      this.fromProtocol = true;
      if (typeof parsed.text === "string" && parsed.text.length >= this.answer.length) {
        this.answer = parsed.text;
      }
      return;
    }
    if (type === "content_start" || type === "content_delta" || type === "text") {
      if (parsed.contentType && parsed.contentType !== "text") return;
      this.fromProtocol = true;
      const accumulated = typeof parsed.accumulated === "string" ? parsed.accumulated : null;
      const delta = typeof parsed.text === "string" ? parsed.text : "";
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

  appendPlain(value) {
    if (!value) return;
    if (this.fromProtocol && this.overlaps(value)) return;
    this.answer += value;
  }

  overlaps(value) {
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

function jsonObjectEnd(input) {
  if (!input.startsWith("{")) return -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
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

function readUsage(value) {
  if (!value || typeof value !== "object") return null;
  const inputTokens = numberOrNull(value.totalInputTokens ?? value.inputTokens);
  const outputTokens = numberOrNull(value.totalOutputTokens ?? value.outputTokens);
  const cost = numberOrNull(value.totalCost ?? value.cost);
  if (inputTokens == null && outputTokens == null && cost == null) return null;
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cost: cost ?? 0,
  };
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
