import { describe, expect, it } from "vitest";
import { AgentTextStream } from "./agent-stream";

const ANSWER =
  "أنا Vigil، مساعد برمجي ذكي أعمل معك مباشرة داخل بيئة عملك.\n\nوظيفتي باختصار: أكتب الكود وأعدّل الملفات.";

describe("AgentTextStream", () => {
  it("keeps the answer and the real usage from a raw protocol stream", () => {
    const raw = [
      '{"type":"iteration_start","iteration":1}',
      JSON.stringify({
        type: "content_start",
        contentType: "text",
        text: ANSWER.slice(0, 12),
        accumulated: ANSWER.slice(0, 12),
      }),
      JSON.stringify({
        type: "content_start",
        contentType: "text",
        text: ANSWER.slice(12),
        accumulated: ANSWER,
      }),
      '{"type":"usage","inputTokens":1601,"outputTokens":194,"cost":0.00279825,"totalInputTokens":1601,"totalOutputTokens":194,"totalCost":0.00279825}',
      JSON.stringify({ type: "content_end", contentType: "text", text: ANSWER }),
      JSON.stringify({
        type: "done",
        reason: "completed",
        text: ANSWER.replace("باختصار:", "باختصار:**"),
      }),
      ANSWER,
    ].join("");

    const stream = new AgentTextStream();
    stream.push(raw.slice(0, 40));
    stream.push(raw.slice(40));
    stream.adoptFinal(ANSWER.replace("باختصار:", "باختصار:**"));

    expect(stream.text).toBe(ANSWER);
    expect(stream.text).not.toContain("iteration_start");
    expect(stream.usage).toEqual({
      inputTokens: 1601,
      outputTokens: 194,
      cost: 0.00279825,
    });
  });

  it("passes a normal prose chunk through unchanged", () => {
    const stream = new AgentTextStream();
    expect(stream.push("Hello")).toBe("Hello");
    expect(stream.push(" there")).toBe("Hello there");
    expect(stream.usage).toBeNull();
  });
});
