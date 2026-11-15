/**
 * Authorized-target gate for Vigil Secure (Phase A).
 * Hard-fail unauthorized URLs — not prompt-only.
 */

/**
 * @param {string} hostname
 */
export function isLocalHostname(hostname) {
  const h = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0.0.0.0"
  );
}

/**
 * @param {string} rawUrl
 * @returns {{ ok: true, url: URL } | { ok: false, error: string }}
 */
export function parseHttpUrl(rawUrl) {
  const text = String(rawUrl || "").trim();
  if (!text) return { ok: false, error: "URL required / الرابط مطلوب." };
  try {
    const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`;
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "Only http/https targets are allowed." };
    }
    return { ok: true, url: u };
  } catch {
    return { ok: false, error: "Invalid URL / رابط غير صالح." };
  }
}

/**
 * @param {string} hostname
 * @param {string[]} allowHosts
 */
export function hostAllowed(hostname, allowHosts = []) {
  const h = String(hostname || "")
    .trim()
    .toLowerCase();
  if (!h) return false;
  if (isLocalHostname(h)) return true;
  const list = (allowHosts || []).map((x) => String(x || "").trim().toLowerCase());
  if (list.includes(h)) return true;
  // Subdomain match: allow example.com covers app.example.com
  return list.some((entry) => entry && (h === entry || h.endsWith(`.${entry}`)));
}

/**
 * @param {string} rawUrl
 * @param {{ allowHosts?: string[], previewUrl?: string | null }} opts
 */
export function assertAuthorizedTarget(rawUrl, opts = {}) {
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed.ok) return parsed;
  const { url } = parsed;
  const hosts = [...(opts.allowHosts || [])];
  if (opts.previewUrl) {
    const preview = parseHttpUrl(opts.previewUrl);
    if (preview.ok) hosts.push(preview.url.hostname);
  }
  if (!hostAllowed(url.hostname, hosts)) {
    return {
      ok: false,
      error:
        `Target not authorized: ${url.hostname}. ` +
        `Add it to the Secure allowlist, or scan localhost / project preview only. ` +
        `الهدف غير مصرّح — أضفه للقائمة أو استخدم localhost/معاينة المشروع فقط.`,
    };
  }
  return { ok: true, url, href: url.href };
}
