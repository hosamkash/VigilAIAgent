import { describe, expect, it } from "vitest";
import { speakableMessageText, speechLanguageForText } from "./gemini-tts";

describe("gemini-tts helpers", () => {
  it("detects Egyptian Arabic for Arabic script", () => {
    expect(speechLanguageForText("ازيك يا صاحبي")).toBe("ar-EG");
    expect(speechLanguageForText("Hello world")).toBeNull();
  });

  it("strips markdown and cost footers before speaking", () => {
    const raw =
      "Routed as **fast** → `gemini/x`\n\n**Hello** `world`\n\n_Cost: $0.01 | Tokens: 1 in / 2 out_";
    expect(speakableMessageText(raw)).toBe("Hello world");
  });
});
