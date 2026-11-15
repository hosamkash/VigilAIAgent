/**
 * Vigil Secure — Phase A passive pack (authorized targets only).
 * Headers, cookies, HTTPS hints, dependency audit, secret heuristics.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { explainFinding } from "./secure-education.mjs";
import { assertAuthorizedTarget } from "./secure-target.mjs";

const execFileAsync = promisify(execFile);

/**
 * @typedef {{
 *   id: string,
 *   severity: 'critical'|'high'|'medium'|'low'|'info',
 *   category: string,
 *   title: string,
 *   detail: string,
 *   evidence?: string,
 *   path?: string,
 *   education?: ReturnType<typeof explainFinding>,
 *   educationAr?: ReturnType<typeof explainFinding>,
 * }} SecureFinding
 */

export function makeSecureFinding(partial) {
  const edu = explainFinding(partial.category, "en");
  const eduAr = explainFinding(partial.category, "ar");
  return {
    id: partial.id || `f_${partial.category}_${Math.random().toString(36).slice(2, 8)}`,
    severity: partial.severity || "medium",
    category: partial.category,
    title: partial.title || edu.title,
    detail: partial.detail || edu.what,
    evidence: partial.evidence,
    path: partial.path,
    education: edu,
    educationAr: eduAr,
  };
}

const finding = makeSecureFinding;

/**
 * @param {Headers | Record<string, string>} headers
 */
export function analyzeSecurityHeaders(headers) {
  /** @type {SecureFinding[]} */
  const findings = [];
  const get = (name) => {
    if (headers && typeof headers.get === "function") return headers.get(name);
    const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? String(headers[key]) : null;
  };

  const csp = get("content-security-policy");
  if (!csp) {
    findings.push(
      finding({
        category: "missing_csp",
        severity: "medium",
        detail: "No Content-Security-Policy response header.",
      }),
    );
  }

  const hsts = get("strict-transport-security");
  if (!hsts) {
    findings.push(
      finding({
        category: "missing_hsts",
        severity: "low",
        detail: "No Strict-Transport-Security header (relevant once HTTPS is enabled).",
      }),
    );
  }

  const xfo = get("x-frame-options");
  const frameAncestors = csp && /frame-ancestors/i.test(csp);
  if (!xfo && !frameAncestors) {
    findings.push(
      finding({
        category: "missing_xfo",
        severity: "medium",
        detail: "Neither X-Frame-Options nor CSP frame-ancestors is set.",
      }),
    );
  }

  if (!get("x-content-type-options")) {
    findings.push(
      finding({
        category: "missing_xcto",
        severity: "low",
        detail: "Missing X-Content-Type-Options: nosniff.",
      }),
    );
  }

  if (!get("referrer-policy")) {
    findings.push(
      finding({
        category: "missing_referrer",
        severity: "info",
        detail: "Missing Referrer-Policy header.",
      }),
    );
  }

  const server = get("server");
  const powered = get("x-powered-by");
  if ((server && /\d/.test(server)) || powered) {
    findings.push(
      finding({
        category: "server_banner",
        severity: "info",
        detail: "Server/tech version may be disclosed.",
        evidence: [server, powered].filter(Boolean).join(" | "),
      }),
    );
  }

  return findings;
}

/**
 * @param {string[] | string | null} setCookie
 */
export function analyzeCookies(setCookie) {
  /** @type {SecureFinding[]} */
  const findings = [];
  const list = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  for (const raw of list) {
    const line = String(raw);
    const name = line.split("=")[0]?.trim() || "cookie";
    const lower = line.toLowerCase();
    const issues = [];
    if (!/; *secure/i.test(line) && !lower.includes("secure")) issues.push("missing Secure");
    if (!/; *httponly/i.test(line)) issues.push("missing HttpOnly");
    if (!/; *samesite=/i.test(line)) issues.push("missing SameSite");
    if (issues.length) {
      findings.push(
        finding({
          category: "cookie_flags",
          severity: "medium",
          title: `Cookie flags: ${name}`,
          detail: issues.join("; "),
          evidence: line.slice(0, 200),
        }),
      );
    }
  }
  return findings;
}

/**
 * @param {string} workspaceRoot
 * @param {{ maxFiles?: number }} [opts]
 */
export async function scanSecretsHeuristic(workspaceRoot, opts = {}) {
  /** @type {SecureFinding[]} */
  const findings = [];
  const maxFiles = opts.maxFiles ?? 80;
  const skipDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    "target",
    "vendor",
    ".vigil",
  ]);
  const patterns = [
    { re: /AKIA[0-9A-Z]{16}/g, label: "AWS access key-like" },
    { re: /ghp_[A-Za-z0-9]{20,}/g, label: "GitHub PAT-like" },
    { re: /sk-[A-Za-z0-9]{20,}/g, label: "OpenAI/sk-like key" },
    { re: /AIza[0-9A-Za-z_-]{20,}/g, label: "Google API key-like" },
    {
      re: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{12,}['"]/gi,
      label: "Hardcoded secret assignment",
    },
  ];

  /** @type {string[]} */
  const files = [];
  async function walk(dir, depth = 0) {
    if (files.length >= maxFiles || depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (files.length >= maxFiles) break;
      if (ent.name.startsWith(".") && ent.name !== ".env" && ent.name !== ".env.local") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skipDirs.has(ent.name)) continue;
        await walk(full, depth + 1);
      } else if (/\.(env|ts|tsx|js|jsx|mjs|cjs|json|py|php|rb|go|yml|yaml|toml)$/i.test(ent.name) || ent.name.startsWith(".env")) {
        files.push(full);
      }
    }
  }
  await walk(workspaceRoot);

  for (const file of files) {
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    if (text.length > 200_000) continue;
    const rel = path.relative(workspaceRoot, file);
    for (const { re, label } of patterns) {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (m) {
        findings.push(
          finding({
            category: "secret_leak",
            severity: "high",
            title: `Possible secret: ${label}`,
            detail: `Pattern matched in ${rel}`,
            path: rel,
            evidence: m[0].slice(0, 24) + "…",
          }),
        );
        break;
      }
    }
  }
  return findings;
}

/**
 * @param {string} workspaceRoot
 */
export async function scanNpmAudit(workspaceRoot) {
  /** @type {SecureFinding[]} */
  const findings = [];
  try {
    await fs.access(path.join(workspaceRoot, "package.json"));
  } catch {
    return findings;
  }
  try {
    const { stdout } = await execFileAsync(
      "npm",
      ["audit", "--json", "--omit=dev"],
      {
        cwd: workspaceRoot,
        timeout: 90_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, npm_config_audit: "true" },
      },
    );
    let data;
    try {
      data = JSON.parse(stdout || "{}");
    } catch {
      return findings;
    }
    const vulns = data.vulnerabilities || {};
    let count = 0;
    for (const [name, info] of Object.entries(vulns)) {
      if (count >= 25) break;
      const sev = String(info?.severity || "moderate").toLowerCase();
      if (sev === "info") continue;
      const severity =
        sev === "critical"
          ? "critical"
          : sev === "high"
            ? "high"
            : sev === "moderate" || sev === "medium"
              ? "medium"
              : "low";
      findings.push(
        finding({
          category: "dependency_cve",
          severity,
          title: `npm: ${name} (${sev})`,
          detail: info?.via
            ? Array.isArray(info.via)
              ? info.via
                  .map((v) => (typeof v === "string" ? v : v?.title || v?.name))
                  .filter(Boolean)
                  .slice(0, 3)
                  .join("; ")
              : String(info.via)
            : `Vulnerable dependency: ${name}`,
          path: "package.json",
        }),
      );
      count += 1;
    }
  } catch (e) {
    // npm audit exits non-zero when vulns found — still parse stdout if present
    const out = e?.stdout;
    if (out) {
      try {
        const data = JSON.parse(out);
        const meta = data.metadata?.vulnerabilities;
        if (meta) {
          const total =
            (meta.critical || 0) +
            (meta.high || 0) +
            (meta.moderate || 0) +
            (meta.low || 0);
          if (total > 0) {
            findings.push(
              finding({
                category: "dependency_cve",
                severity: meta.critical || meta.high ? "high" : "medium",
                title: `npm audit: ${total} known issue(s)`,
                detail: `critical=${meta.critical || 0} high=${meta.high || 0} moderate=${meta.moderate || 0} low=${meta.low || 0}`,
                path: "package.json",
              }),
            );
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return findings;
}

/**
 * @param {{
 *   url: string,
 *   workspaceRoot: string,
 *   allowHosts?: string[],
 *   previewUrl?: string | null,
 *   fetchImpl?: typeof fetch,
 * }} opts
 */
export async function runPassiveScan(opts) {
  const gate = assertAuthorizedTarget(opts.url, {
    allowHosts: opts.allowHosts || [],
    previewUrl: opts.previewUrl,
  });
  if (!gate.ok) {
    return { ok: false, error: gate.error, findings: [] };
  }

  /** @type {SecureFinding[]} */
  const findings = [];
  const fetchFn = opts.fetchImpl || globalThis.fetch;
  let responseMeta = null;

  if (typeof fetchFn === "function") {
    try {
      const res = await fetchFn(gate.href, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout?.(20_000),
        headers: { "User-Agent": "Vigil-Secure/1.0 (passive; authorized)" },
      });
      responseMeta = {
        status: res.status,
        finalUrl: res.url || gate.href,
        headers: Object.fromEntries(res.headers.entries()),
      };
      findings.push(...analyzeSecurityHeaders(res.headers));

      const cookies =
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : res.headers.get("set-cookie")
            ? [res.headers.get("set-cookie")]
            : [];
      findings.push(...analyzeCookies(cookies));

      const final = new URL(responseMeta.finalUrl);
      if (final.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(final.hostname)) {
        findings.push(
          finding({
            category: "mixed_content",
            severity: "medium",
            detail: "Target is served over plain HTTP (prefer HTTPS for non-local hosts).",
            evidence: final.href,
          }),
        );
      }
    } catch (e) {
      findings.push(
        finding({
          id: "f_fetch_error",
          category: "server_banner",
          severity: "info",
          title: "Could not fetch target",
          detail: String(e?.message || e),
        }),
      );
    }
  }

  if (opts.workspaceRoot) {
    findings.push(...(await scanSecretsHeuristic(opts.workspaceRoot)));
    findings.push(...(await scanNpmAudit(opts.workspaceRoot)));
  }

  const severityRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort(
    (a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9),
  );

  return {
    ok: true,
    pack: "passive",
    target: gate.href,
    scannedAt: Date.now(),
    response: responseMeta,
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
