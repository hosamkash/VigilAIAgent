export type ReplyTone = "colloquial" | "formal";
export type ReplyLength = "brief" | "detailed";
export type VoiceGender = "female" | "male";

export type TtsVoiceOption = {
  id: string;
  label: string;
  gender: VoiceGender;
  hint: string;
};

/** Curated Gemini prebuilt voices for the quick picker. */
export const TTS_VOICE_OPTIONS: TtsVoiceOption[] = [
  { id: "Sulafat", label: "Sulafat", gender: "female", hint: "Warm" },
  { id: "Aoede", label: "Aoede", gender: "female", hint: "Breezy" },
  { id: "Leda", label: "Leda", gender: "female", hint: "Youthful" },
  { id: "Kore", label: "Kore", gender: "female", hint: "Firm" },
  { id: "Achernar", label: "Achernar", gender: "female", hint: "Soft" },
  { id: "Vindemiatrix", label: "Vindemiatrix", gender: "female", hint: "Gentle" },
  { id: "Charon", label: "Charon", gender: "male", hint: "Informative" },
  { id: "Puck", label: "Puck", gender: "male", hint: "Upbeat" },
  { id: "Fenrir", label: "Fenrir", gender: "male", hint: "Excitable" },
  { id: "Orus", label: "Orus", gender: "male", hint: "Firm" },
  { id: "Alnilam", label: "Alnilam", gender: "male", hint: "Firm" },
  { id: "Schedar", label: "Schedar", gender: "male", hint: "Even" },
];

export const DEFAULT_VOICE_BY_GENDER: Record<VoiceGender, string> = {
  female: "Sulafat",
  male: "Charon",
};

export function voicesForGender(gender: VoiceGender): TtsVoiceOption[] {
  return TTS_VOICE_OPTIONS.filter((voice) => voice.gender === gender);
}

export function resolveTtsVoiceId(gender: VoiceGender, voiceId: string): string {
  const match = voicesForGender(gender).find((voice) => voice.id === voiceId);
  return match?.id ?? DEFAULT_VOICE_BY_GENDER[gender];
}

/** Always match the user's language, then apply tone/length prefs. */
export const REPLY_LANGUAGE_RULE =
  "Language: Detect the language of the user's latest message and reply in that exact same language every time. " +
  "If they write Arabic, answer in Arabic. If they write English, answer in English. Same for any other language. " +
  "Never switch languages unless the user explicitly asks. " +
  "Keep code, paths, commands, identifiers, and API names in their original form.";

/** Extra system instructions for the agent based on quick chat prefs. */
export function buildReplyStyleInstruction(
  tone: ReplyTone,
  length: ReplyLength,
): string {
  const toneLine =
    tone === "colloquial"
      ? "Reply tone: stay in the user's language. For Arabic, use Egyptian colloquial Arabic (amiya Masri). For other languages, use a natural informal spoken style in that same language. Keep code, paths, and technical terms exact."
      : "Reply tone: stay in the user's language with clear formal wording. For Arabic, use Modern Standard Arabic (fusha). For other languages, stay formal and precise in that same language. Keep code, paths, and technical terms exact.";
  const lengthLine =
    length === "brief"
      ? "Length: keep replies short and actionable unless the user asks for more detail."
      : "Length: give thorough, detailed replies with enough explanation and context.";
  return `${REPLY_LANGUAGE_RULE}\n${toneLine}\n${lengthLine}`;
}
