/**
 * Vigil browser automation — Cursor / Claude-for-Chrome style.
 *
 * Priority:
 *  1. Attach to an existing Chrome/Edge/Chromium via CDP (cdpUrl or port 9222)
 *  2. Launch the user's installed Chrome / Edge / Chromium (headed)
 *  3. Launch Playwright's bundled Chromium (so a browser always exists)
 */

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** @type {import('playwright').Browser | null} */
let browser = null;
/** @type {import('playwright').BrowserContext | null} */
let context = null;
/** @type {import('playwright').Page | null} */
let page = null;
/** @type {Map<string, import('playwright').Locator>} */
let refMap = new Map();
let launchedChild = null;
let mode = "none"; // cdp | channel | bundled
/** Default true — never pop a visible OS/Chromium window unless explicitly requested. */
let preferHeadless = true;

const DEFAULT_CDP = "http://127.0.0.1:9222";

function chromeCandidates() {
  const platform = process.platform;
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA || "";
    const pf = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    return [
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
  }
  return [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser",
  ];
}

async function tryConnectCdp(cdpUrl = DEFAULT_CDP) {
  try {
    const b = await chromium.connectOverCDP(cdpUrl, { timeout: 2500 });
    const ctx = b.contexts()[0] || (await b.newContext());
    const p = ctx.pages()[0] || (await ctx.newPage());
    browser = b;
    context = ctx;
    page = p;
    mode = "cdp";
    return true;
  } catch {
    return false;
  }
}

function launchSystemChrome(cdpPort = 9222) {
  const bin = chromeCandidates().find((c) => {
    if (c.includes("/") || c.includes("\\")) return existsSync(c);
    return true;
  });
  if (!bin) return null;
  const profile = path.join(os.tmpdir(), `vigil-browser-${cdpPort}`);
  const child = spawn(
    bin,
    [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  launchedChild = child;
  return child;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function ensurePage(opts = {}) {
  if (page && !page.isClosed()) return page;

  const headless =
    typeof opts.headless === "boolean" ? opts.headless : preferHeadless;
  preferHeadless = headless;

  const cdpUrl = opts.cdpUrl || process.env.VIGIL_BROWSER_CDP || DEFAULT_CDP;
  // Attach to an already-running debug browser only — never spawn a visible Chrome here.
  if (await tryConnectCdp(cdpUrl)) return page;

  // Visible system Chrome only when the user explicitly asked for headed automation.
  if (!headless && opts.preferSystem === true) {
    try {
      launchSystemChrome(9222);
      for (let i = 0; i < 20; i++) {
        await sleep(250);
        if (await tryConnectCdp(cdpUrl)) return page;
      }
    } catch {
      /* fall through to bundled */
    }
  }

  const channel = opts.channel;
  const launchOpts = {
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  };
  if (channel) launchOpts.channel = channel;

  try {
    browser = await chromium.launch(launchOpts);
    mode = channel ? "channel" : "bundled";
  } catch (err) {
    if (channel) {
      browser = await chromium.launch({
        headless,
        args: launchOpts.args,
      });
      mode = "bundled";
    } else {
      throw new Error(
        `Could not launch a browser (${String(err)}). ` +
          "Install Chrome, or run: npx playwright install chromium",
      );
    }
  }

  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  return page;
}

function normalizeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (
    trimmed.startsWith("localhost") ||
    trimmed.startsWith("127.") ||
    /^\d{1,3}(\.\d{1,3}){3}/.test(trimmed)
  ) {
    return trimmed.includes("://") ? trimmed : `http://${trimmed}`;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function buildSnapshot() {
  const p = await ensurePage();
  refMap = new Map();
  let counter = 0;

  const nodes = await p.evaluate(() => {
    const interesting = [
      "a",
      "button",
      "input",
      "textarea",
      "select",
      "summary",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='menuitem']",
      "[contenteditable='true']",
    ];
    const els = Array.from(document.querySelectorAll(interesting.join(",")));
    const out = [];
    const seen = new Set();
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue;
      if (seen.has(el)) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      seen.add(el);
      if (!el.dataset.vigilRef) {
        // temporary attribute for locator; cleared after evaluate via remapping
      }
      const role =
        el.getAttribute("role") ||
        el.tagName.toLowerCase().replace(/^input$/, el.getAttribute("type") || "input");
      const name =
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("name") ||
        el.getAttribute("title") ||
        (el.innerText || "").trim().slice(0, 80) ||
        el.getAttribute("href") ||
        "";
      out.push({
        tag: el.tagName.toLowerCase(),
        role,
        name: String(name).replace(/\s+/g, " ").trim(),
        type: el.getAttribute("type") || "",
        href: el.getAttribute("href") || "",
        value:
          el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
            ? String(el.value || "").slice(0, 120)
            : "",
      });
      if (out.length >= 80) break;
    }
    return {
      title: document.title,
      url: location.href,
      nodes: out,
    };
  });

  const lines = [`- Page: ${nodes.title || "(untitled)"}`, `- URL: ${nodes.url}`];
  for (const node of nodes.nodes) {
    counter += 1;
    const ref = `e${counter}`;
    let locator;
    if (node.href && node.tag === "a") {
      locator = p.locator(`a[href="${cssEscape(node.href)}"]`).first();
    } else if (node.name) {
      locator = p.getByText(node.name, { exact: false }).first();
    } else {
      locator = p.locator(node.tag).nth(counter - 1);
    }
    // Prefer role+name when possible
    try {
      if (node.name && ["button", "link", "textbox", "checkbox", "radio"].includes(node.role)) {
        locator = p.getByRole(node.role, { name: node.name }).first();
      } else if (node.tag === "button" && node.name) {
        locator = p.getByRole("button", { name: node.name }).first();
      } else if (node.tag === "a" && node.name) {
        locator = p.getByRole("link", { name: node.name }).first();
      } else if ((node.tag === "input" || node.tag === "textarea") && node.name) {
        locator = p.getByLabel(node.name).first();
      }
    } catch {
      /* keep fallback locator */
    }
    refMap.set(ref, locator);
    const bits = [`[${ref}]`, node.role || node.tag];
    if (node.name) bits.push(`"${node.name.slice(0, 60)}"`);
    if (node.type) bits.push(`type=${node.type}`);
    if (node.value) bits.push(`value="${node.value.slice(0, 40)}"`);
    lines.push(`  - ${bits.join(" ")}`);
  }
  return lines.join("\n");
}

function cssEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function browser_navigate(input = {}, emit) {
  const url = normalizeUrl(input.url);
  if (!url) throw new Error("url is required");
  const p = await ensurePage({
    cdpUrl: input.cdpUrl,
    channel: input.channel,
    // Default headless — do not open a visible Chromium/Chrome window.
    headless: input.headless !== false,
    preferSystem: input.preferSystem === true,
  });
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const title = await p.title().catch(() => "");
  if (typeof emit === "function") {
    emit({ type: "tool", toolName: "browser_navigate", url: p.url(), title });
  }
  const snap = await buildSnapshot();
  return {
    ok: true,
    output: `Opened ${p.url()}${title ? ` — ${title}` : ""}\nmode=${mode}\n\n${snap}`,
    url: p.url(),
    title,
    mode,
  };
}

export async function browser_snapshot() {
  await ensurePage();
  const snap = await buildSnapshot();
  return { ok: true, output: snap, url: page.url() };
}

export async function browser_click(input = {}) {
  await ensurePage();
  const ref = String(input.ref || "").trim();
  if (!ref) throw new Error("ref is required (from browser_snapshot)");
  const locator = refMap.get(ref);
  if (!locator) {
    throw new Error(`Unknown ref "${ref}". Call browser_snapshot first.`);
  }
  await locator.click({ timeout: 15_000 });
  await sleep(300);
  const snap = await buildSnapshot();
  return { ok: true, output: `Clicked ${ref}\n\n${snap}`, url: page.url() };
}

export async function browser_type(input = {}) {
  await ensurePage();
  const ref = String(input.ref || "").trim();
  const text = input.text ?? "";
  if (!ref) throw new Error("ref is required");
  const locator = refMap.get(ref);
  if (!locator) {
    throw new Error(`Unknown ref "${ref}". Call browser_snapshot first.`);
  }
  if (input.clear !== false) {
    await locator.fill(String(text), { timeout: 15_000 });
  } else {
    await locator.type(String(text), { timeout: 15_000 });
  }
  if (input.submit) await locator.press("Enter");
  await sleep(200);
  const snap = await buildSnapshot();
  return { ok: true, output: `Typed into ${ref}\n\n${snap}`, url: page.url() };
}

export async function browser_press(input = {}) {
  await ensurePage();
  const key = String(input.key || "").trim();
  if (!key) throw new Error("key is required (e.g. Enter, Escape, Tab)");
  if (input.ref) {
    const locator = refMap.get(String(input.ref).trim());
    if (!locator) throw new Error(`Unknown ref "${input.ref}"`);
    await locator.press(key);
  } else {
    await page.keyboard.press(key);
  }
  await sleep(200);
  const snap = await buildSnapshot();
  return { ok: true, output: `Pressed ${key}\n\n${snap}`, url: page.url() };
}

export async function browser_screenshot(input = {}, emit) {
  const p = await ensurePage();
  const fullPage = input.fullPage === true;
  const buffer = await p.screenshot({
    type: "png",
    fullPage,
  });
  const b64 = buffer.toString("base64");
  if (typeof emit === "function") {
    emit({
      type: "tool",
      toolName: "browser_screenshot",
      url: p.url(),
      imageBase64: b64,
    });
  }
  return {
    ok: true,
    output: `Screenshot captured (${buffer.length} bytes) of ${p.url()}. Image was sent to the IDE.`,
    url: p.url(),
    imageBase64: b64,
  };
}

export async function browser_tabs() {
  await ensurePage();
  const pages = context?.pages() || (page ? [page] : []);
  const lines = pages.map((pg, i) => {
    const active = pg === page ? " *" : "";
    return `${i}${active}  ${pg.url()}`;
  });
  return {
    ok: true,
    output: `mode=${mode}\n${lines.join("\n") || "(no tabs)"}`,
    mode,
  };
}

export async function browser_select_option(input = {}) {
  await ensurePage();
  const ref = String(input.ref || "").trim();
  const values = input.values ?? (input.value != null ? [input.value] : []);
  if (!ref) throw new Error("ref is required");
  const locator = refMap.get(ref);
  if (!locator) throw new Error(`Unknown ref "${ref}"`);
  await locator.selectOption(values.map(String));
  const snap = await buildSnapshot();
  return { ok: true, output: `Selected option on ${ref}\n\n${snap}` };
}

export async function browser_wait(input = {}) {
  const ms = Math.min(30_000, Math.max(0, Number(input.ms) || 1000));
  await sleep(ms);
  if (page && !page.isClosed()) {
    const snap = await buildSnapshot();
    return { ok: true, output: `Waited ${ms}ms\n\n${snap}` };
  }
  return { ok: true, output: `Waited ${ms}ms` };
}

export async function browser_close() {
  try {
    if (context && mode !== "cdp") await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  } finally {
    browser = null;
    context = null;
    page = null;
    refMap = new Map();
    mode = "none";
    launchedChild = null;
  }
  return { ok: true, output: "Browser closed." };
}

export function browserStatus() {
  return {
    open: !!(page && !page.isClosed()),
    url: page && !page.isClosed() ? page.url() : null,
    mode,
  };
}

/** Detect a local project URL from package.json / common configs (Node side). */
export async function detectProjectUrl(cwd) {
  const { promises: fs } = await import("node:fs");
  const root = cwd || process.cwd();
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    const scripts = Object.values(pkg.scripts || {}).join("\n");
    const m =
      /--port[=\s]+(\d{2,5})/i.exec(scripts) ||
      /localhost:(\d{2,5})/i.exec(scripts);
    if (m) return `http://localhost:${m[1]}`;
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const names = Object.keys(deps).join(" ");
    if (/\bvite\b/i.test(names) || /\bvite\b/i.test(scripts)) return "http://localhost:5173";
    if (/\bnext\b/i.test(names)) return "http://localhost:3000";
    if (/\btauri\b/i.test(names)) return "http://localhost:1420";
  } catch {
    /* ignore */
  }
  return "http://localhost:3000";
}
