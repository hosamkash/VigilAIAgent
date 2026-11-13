/** Vigil Web base URL for desktop embed (Cloud Bridge). */

const STORAGE_KEY = "vigil.cloud.webUrl";

export function getVigilWebUrlFromEnv(): string {
  const fromEnv = String(import.meta.env.VITE_VIGIL_WEB_URL || "").trim();
  if (fromEnv) return fromEnv;
  // Continuum local default while Vigil Web (`Vigil-AI-Agent-Web`) runs on Next.
  if (import.meta.env.DEV) return "http://127.0.0.1:3000";
  return "";
}

export function getConfiguredVigilWebUrl(): string {
  try {
    const local = localStorage.getItem(STORAGE_KEY)?.trim() || "";
    if (local) return local;
  } catch {
    /* ignore */
  }
  return getVigilWebUrlFromEnv();
}

export function setConfiguredVigilWebUrl(url: string): void {
  const next = url.trim();
  try {
    if (!next) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
}

/**
 * Embed entry: auth bridge page exchanges desktop Firebase idToken for
 * vigil_session, then lands on next (default /app) with ?embed=1.
 */
export function vigilWebEmbedUrl(
  base = getConfiguredVigilWebUrl(),
  nextPath = "/app",
): string {
  const raw = base.trim();
  if (!raw) return "";
  const next = nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    u.pathname = "/embed/auth";
    u.search = "";
    u.searchParams.set("embed", "1");
    u.searchParams.set("next", next);
    return u.toString();
  } catch {
    const join = raw.includes("?") ? "&" : "?";
    return `${raw.replace(/\/$/, "")}/embed/auth${join}embed=1&next=${encodeURIComponent(next)}`;
  }
}

export function isVigilWebConfigured(): boolean {
  return !!getConfiguredVigilWebUrl();
}
