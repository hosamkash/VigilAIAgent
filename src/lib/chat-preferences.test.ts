import { describe, expect, it } from "vitest";
import {
  buildReplyStyleInstruction,
  resolveTtsVoiceId,
  voicesForGender,
} from "./chat-preferences";

describe("chat preferences", () => {
  it("filters voices by gender", () => {
    expect(voicesForGender("female").every((v) => v.gender === "female")).toBe(true);
    expect(voicesForGender("male").every((v) => v.gender === "male")).toBe(true);
  });

  it("falls back to the default voice for a gender", () => {
    expect(resolveTtsVoiceId("female", "missing")).toBe("Sulafat");
    expect(resolveTtsVoiceId("male", "Charon")).toBe("Charon");
  });

  it("builds colloquial brief instructions", () => {
    const text = buildReplyStyleInstruction("colloquial", "brief");
    expect(text).toContain("same language");
    expect(text).toContain("Egyptian colloquial");
    expect(text).toContain("short");
  });

  it("builds formal detailed instructions", () => {
    const text = buildReplyStyleInstruction("formal", "detailed");
    expect(text).toContain("same language");
    expect(text).toContain("Modern Standard Arabic");
    expect(text).toContain("thorough");
  });
});
