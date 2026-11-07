const REQUEST_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MAX_MESSAGES = 24;
const MAX_MESSAGE = 2000;
const MAX_TRANSCRIPT = 12000;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(clean.length - max);
}

type ReferencedChat = {
  id: string;
  title: string;
  messages: { role: string; content: string; images?: unknown[] }[];
};

/** Prepend the chats named by request ids in the prompt, so a later tab can continue them. */
export function attachReferencedChats(
  prompt: string,
  currentTabId: string,
  lookup: (id: string) => ReferencedChat | undefined,
): string {
  const ids = [...new Set((prompt.match(REQUEST_ID) ?? []).map((id) => id.toLowerCase()))].filter(
    (id) => id !== currentTabId.toLowerCase(),
  );
  if (ids.length === 0) return prompt;

  const blocks = ids.map((id) => {
    const chat = lookup(id);
    if (!chat) {
      return `[Referenced request ${id}: not found in chat history.]`;
    }
    const recent = chat.messages.slice(-MAX_MESSAGES);
    const lines = recent.map((message) => {
      const who = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System";
      const images = message.images?.length ? ` [${message.images.length} image(s)]` : "";
      return `${who}${images}: ${clip(message.content, MAX_MESSAGE)}`;
    });
    const body = lines.length > 0 ? clip(lines.join("\n"), MAX_TRANSCRIPT) : "(no messages yet)";
    return `[Referenced chat "${chat.title}" request ${chat.id}]\n${body}\n[/Referenced chat]`;
  });

  return `${blocks.join("\n\n")}\n\n${prompt}`;
}
