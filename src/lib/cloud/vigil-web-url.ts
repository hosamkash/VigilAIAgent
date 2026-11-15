/** Vigil Web base URL for desktop embed (Cloud Bridge). */

const STORAGE_KEY = "vigil.cloud.webUrl";

export function getVigilWebUrlFromEnv(): string {
  const fromEnv = String(import.meta.env.VITE_VIGIL_WEB_URL || "").trim();
  if (fromEnv) return fromEnv;
  // Continuum local default while Vigil Web (`Vigil-AI-Agent-Web`) runs on Next.
  if (import.meta.env.DEV) return "http://127.0.0.1:3000";
  return "";
}

/** Leftover Settings URL from local Next — do not block production VITE_VIGIL_WEB_URL. */
export function isLoopbackHttpUrl(url: string): boolean {
  try {
    const u = new URL(url.includes("://") ? url : `http://${url}`);
    return (
      u.hostname === "127.0.0.1" ||
      u.hostname === "localhost" ||
      u.hostname === "[::1]" ||
      u.hostname === "::1"
    );
  } catch {
    return false;
  }
}

export function resolveVigilWebUrl(stored: string, envUrl: string): string {
  const local = stored.trim();
  const env = envUrl.trim();
  if (local && !(isLoopbackHttpUrl(local) && env && !isLoopbackHttpUrl(env))) {
    return local;
  }
  return env || local;
}

export function getConfiguredVigilWebUrl(): string {
  let stored = "";
  try {
    stored = localStorage.getItem(STORAGE_KEY)?.trim() || "";
  } catch {
    /* ignore */
  }
  const next = resolveVigilWebUrl(stored, getVigilWebUrlFromEnv());
  if (next && next !== stored) {
    setConfiguredVigilWebUrl(next);
  }
  return next;
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

export function isCloudEmbedHref(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes("/embed/auth") || /[?&]embed=1(?:&|$)/.test(u);
}
