/** Normalize and classify URLs for Vigil Browser. */

export function normalizeBrowserUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    trimmed.startsWith("localhost") ||
    trimmed.startsWith("127.") ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(trimmed)
  ) {
    return trimmed.includes("://") ? trimmed : `http://${trimmed}`;
  }
  // Require `://` so `localhost:3000` is not treated as a custom scheme.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function browserTabTitle(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname || "Vigil Browser";
  } catch {
    return "Vigil Browser";
  }
}

export function isLocalPreviewUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}
