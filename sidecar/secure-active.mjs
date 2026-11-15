/**
 * Vigil Secure — Phase B curated active pack (authorized targets only).
 * Safe probes only: sensitive paths, listing, reflected probe, CSRF form heuristic,
 * admin path reachability, verbose errors. No DoS, no credential stuffing, no exploit kits.
 */

import { makeSecureFinding } from "./secure-passive.mjs";
import {
  assertAuthorizedTarget,
  isLocalHostname,
} from "./secure-target.mjs";

const finding = makeSecureFinding;

const SENSITIVE_PATHS = [
  "/.env",
  "/.env.local",
  "/.env.production",
  "/.git/config",
  "/.git/HEAD",
  "/package.json",
  "/composer.json",
  "/web.config",
  "/phpinfo.php",
  "/server-status",
  "/backup.zip",
  "/dump.sql",
  "/.DS_Store",
];

const ADMIN_PATHS = [
  "/admin",
  "/admin/",
  "/administrator",
  "/wp-admin/",
  "/dashboard",
  "/manage",
];

/**
 * @param {string} baseHref
 * @param {string} path
 */
function joinUrl(baseHref, path) {
  try {
    return new URL(path, baseHref).href;
  } catch {
    return null;
  }
}

/**
 * @param {typeof fetch} fetchFn
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function safeFetch(fetchFn, url, init = {}) {
  try {
    const res = await fetchFn(url, {
      redirect: "manual",
      signal: AbortSignal.timeout?.(12_000),
      headers: {
        "User-Agent": "Vigil-Secure/1.0 (active; authorized; safe-probe)",
        ...(init.headers || {}),
      },
      ...init,
    });
    const text = await res.text().catch(() => "");
    return { ok: true, res, text: text.slice(0, 80_000) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * @param {string} html
 */
export function findUnprotectedForms(html) {
  /** @type {{ action: string, method: string }[]} */
  const hits = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = formRe.exec(html))) {
    const attrs = m[1] || "";
    const body = m[2] || "";
    const methodMatch = /method\s*=\s*["']?(get|post|put|patch|delete)/i.exec(
      attrs,
    );
    const method = (methodMatch?.[1] || "get").toLowerCase();
    if (method === "get") continue;
    const actionMatch = /action\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const action = actionMatch?.[1] || "";
    const hasToken =
      /name\s*=\s*["'][^"']*(csrf|xsrf|_token|authenticity_token|__requestverificationtoken)[^"']*["']/i.test(
        body,
      ) ||
      /name\s*=\s*["'][^"']*(csrf|xsrf|_token)[^"']*["']/i.test(attrs);
    if (!hasToken) {
      hits.push({ action, method });
    }
  }
  return hits;
}

/**
 * @param {string} html
 * @param {string} probe
 */
export function looksLikeUnescapedReflection(html, probe) {
  if (!probe || !html.includes(probe)) return false;
  // Escaped forms are OK
  if (html.includes(probe.replace(/</g, "&lt;"))) return false;
  if (html.includes(encodeURIComponent(probe))) return false;
  return true;
}

/**
 * @param {string} text
 */
export function looksLikeStackTrace(text) {
  if (!text || text.length < 40) return false;
  return (
    /Exception in thread|Traceback \(most recent call last\)|at [\w$.]+\([\w./]+:\d+\)|Stack trace:|PHP Fatal error|Django Debug|ASP\.NET|webpack:\/\/|\bNullPointerException\b/i.test(
      text,
    ) ||
    (/<pre[^>]*>[\s\S]{80,}<\/pre>/i.test(text) &&
      /error|exception|traceback/i.test(text))
  );
}

/**
 * @param {string} text
 * @param {number} status
 */
export function looksLikeDirectoryListing(text, status) {
  if (status !== 200 || !text) return false;
  return (
    /Index of \//i.test(text) ||
    /<title>Index of/i.test(text) ||
    (/Directory listing/i.test(text) && /Parent Directory/i.test(text))
  );
}

/**
 * @param {{
 *   url: string,
 *   allowHosts?: string[],
 *   previewUrl?: string | null,
 *   confirm?: boolean,
 *   fetchImpl?: typeof fetch,
 * }} opts
 */
export async function runActiveScan(opts) {
  if (!opts.confirm) {
    return {
      ok: false,
      error:
        "Active scan requires confirm=true (explicit Start). " +
        "الفحص النشط يحتاج تأكيد صريح (confirm=true).",
      findings: [],
    };
  }

  const gate = assertAuthorizedTarget(opts.url, {
    allowHosts: opts.allowHosts || [],
    previewUrl: opts.previewUrl,
  });
  if (!gate.ok) {
    return { ok: false, error: gate.error, findings: [] };
  }

  const fetchFn = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function") {
    return {
      ok: false,
      error: "fetch unavailable",
      findings: [],
    };
  }

  /** @type {ReturnType<typeof makeSecureFinding>[]} */
  const findings = [];
  const base = gate.href;

  // 1) Sensitive paths
  for (const p of SENSITIVE_PATHS) {
    const u = joinUrl(base, p);
    if (!u) continue;
    const got = await safeFetch(fetchFn, u, { method: "GET" });
    if (!got.ok || !got.res) continue;
    const status = got.res.status;
    if (status === 200 && got.text && got.text.length > 8) {
      // package.json on local vite preview is common — lower severity for local
      const sev =
        p === "/package.json" && isLocalHostname(gate.url.hostname)
          ? "info"
          : p.includes(".env") || p.includes(".git")
            ? "high"
            : "medium";
      // Avoid flagging HTML SPA shells as .env leaks
      const looksSecret =
        p.includes(".env")
          ? /=/.test(got.text) && !/<html/i.test(got.text)
          : p.includes(".git")
            ? /\[core\]|ref:/.test(got.text)
            : !/<html[\s>]/i.test(got.text.slice(0, 200)) ||
              p.endsWith(".zip") ||
              p.endsWith(".sql");
      if (looksSecret || p.includes(".git") || p.includes(".env")) {
        findings.push(
          finding({
            category: "sensitive_path",
            severity: sev,
            title: `Exposed path: ${p}`,
            detail: `HTTP ${status} with body (${got.text.length} bytes).`,
            path: p,
            evidence: got.text.slice(0, 120).replace(/\n/g, " "),
          }),
        );
      }
    }
  }

  // 2) Directory listing on /
  {
    const got = await safeFetch(fetchFn, base, { method: "GET" });
    if (got.ok && got.res && looksLikeDirectoryListing(got.text, got.res.status)) {
      findings.push(
        finding({
          category: "directory_listing",
          severity: "medium",
          detail: "Root URL appears to serve a directory index.",
          evidence: got.text.slice(0, 160).replace(/\n/g, " "),
        }),
      );
    }

    // 3) CSRF + verbose errors on home HTML
    if (got.ok && got.text && /<form\b/i.test(got.text)) {
      const forms = findUnprotectedForms(got.text);
      for (const f of forms.slice(0, 5)) {
        findings.push(
          finding({
            category: "csrf_form",
            severity: "medium",
            title: `CSRF heuristic: ${f.method.toUpperCase()} form`,
            detail: `Form action="${f.action || "(same page)"}" has no obvious CSRF token field.`,
            evidence: `${f.method} ${f.action || "/"}`,
          }),
        );
      }
    }
    if (got.ok && looksLikeStackTrace(got.text || "")) {
      findings.push(
        finding({
          category: "verbose_error",
          severity: "medium",
          detail: "Home response resembles a verbose error/stack page.",
          evidence: (got.text || "").slice(0, 160).replace(/\n/g, " "),
        }),
      );
    }
  }

  // 4) Reflected XSS probe (benign unique marker — not an exploit payload chain)
  {
    const marker = `vigilxss${Date.now().toString(36)}`;
    const probe = `<vigil-${marker}>`;
    const probeUrl = joinUrl(base, `/?q=${encodeURIComponent(probe)}&vigil_probe=${encodeURIComponent(probe)}`);
    if (probeUrl) {
      const got = await safeFetch(fetchFn, probeUrl, { method: "GET" });
      if (got.ok && looksLikeUnescapedReflection(got.text || "", probe)) {
        findings.push(
          finding({
            category: "reflected_xss",
            severity: "high",
            detail:
              "Probe string reflected in the HTML response without obvious escaping.",
            evidence: probe,
            path: "/?q=…",
          }),
        );
      }
    }
  }

  // 5) Admin-like paths
  for (const p of ADMIN_PATHS) {
    const u = joinUrl(base, p);
    if (!u) continue;
    const got = await safeFetch(fetchFn, u, { method: "GET" });
    if (!got.ok || !got.res) continue;
    const status = got.res.status;
    if (status === 200) {
      const body = got.text || "";
      const looksLogin =
        /type=["']password["']/i.test(body) ||
        /sign\s*in|log\s*in|تسجيل الدخول|password/i.test(body);
      if (!looksLogin && body.length > 40) {
        findings.push(
          finding({
            category: "open_admin",
            severity: "medium",
            title: `Admin-like path OK: ${p}`,
            detail:
              "Returned HTTP 200 without an obvious login form — verify auth is enforced.",
            path: p,
            evidence: body.slice(0, 100).replace(/\n/g, " "),
          }),
        );
      }
    }
  }

  // 6) Force a bad path that often triggers verbose 404/500 pages
  {
    const u = joinUrl(base, `/vigil-secure-missing-${Date.now()}`);
    if (u) {
      const got = await safeFetch(fetchFn, u, { method: "GET" });
      if (got.ok && looksLikeStackTrace(got.text || "")) {
        findings.push(
          finding({
            category: "verbose_error",
            severity: "low",
            detail: "Missing-path response looks like a stack/debug page.",
            path: new URL(u).pathname,
            evidence: (got.text || "").slice(0, 160).replace(/\n/g, " "),
          }),
        );
      }
    }
  }

  const severityRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort(
    (a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9),
  );

  return {
    ok: true,
    pack: "active",
    target: gate.href,
    scannedAt: Date.now(),
    local: isLocalHostname(gate.url.hostname),
    findings,
    summary: {
      total: findings.length,
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      info: findings.filter((f) => f.severity === "info").length,
    },
  };
}
