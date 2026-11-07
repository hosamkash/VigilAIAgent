/** Open http(s) URLs from the terminal in the system browser. */

const HTTP_URL =
  /https?:\/\/[^\s"'<>()\[\]{}|\\^`]+/i;

export function extractHttpUrl(text: string): string | null {
  const match = text.trim().match(HTTP_URL);
  if (!match) return null;
  return sanitizeTerminalUrl(match[0]);
}

export function sanitizeTerminalUrl(raw: string): string | null {
  const trimmed = raw.replace(/[),.;:!?]+$/g, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function openTerminalUrl(raw: string): Promise<boolean> {
  const href = sanitizeTerminalUrl(raw);
  if (!href) return false;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
    return true;
  } catch {
    const opened = window.open(href, "_blank", "noopener,noreferrer");
    return !!opened;
  }
}
