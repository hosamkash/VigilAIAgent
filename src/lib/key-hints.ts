import type { ApiKeyProvider } from "./secure-storage";

const KEY = "vigil.keyHints";

function mask(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 4) return "••••";
  const suffix = trimmed.slice(-4);
  if (trimmed.startsWith("sk-ant")) return `sk-ant-…${suffix}`;
  if (trimmed.startsWith("sk-")) return `sk-…${suffix}`;
  if (trimmed.startsWith("AIza")) return `AIza…${suffix}`;
  return `…${suffix}`;
}

export function rememberKeyHint(provider: ApiKeyProvider, apiKey: string): void {
  try {
    const raw = localStorage.getItem(KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[provider] = mask(apiKey);
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function getStoredKeyHint(provider: ApiKeyProvider): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[provider] ?? null;
  } catch {
    return null;
  }
}

export function clearKeyHint(provider: ApiKeyProvider): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, string>;
    delete map[provider];
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
