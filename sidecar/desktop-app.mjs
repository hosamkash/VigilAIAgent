/**
 * Windows desktop-app automation bridge for Vigil.
 * Spawns tools/vigil-ui-driver (FlaUI) and speaks NDJSON over stdin/stdout.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let child = null;
/** @type {Promise<any>[]} */
let pending = [];
let buffer = "";
let starting = null;

export function isWindowsDesktopHost() {
  return process.platform === "win32";
}

function windowsOnlyError() {
  return {
    ok: false,
    error:
      "Desktop app automation (WinForms / DevExpress) is Windows-only. " +
      "Run Vigil on Windows with tools/vigil-ui-driver built (see README).",
  };
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Resolve vigil-ui-driver.exe (published or debug build). */
export async function resolveUiDriverPath() {
  if (process.env.VIGIL_UI_DRIVER) return process.env.VIGIL_UI_DRIVER;
  const candidates = [
    path.join(projectRoot, "tools", "vigil-ui-driver", "publish", "vigil-ui-driver.exe"),
    path.join(
      projectRoot,
      "tools",
      "vigil-ui-driver",
      "bin",
      "Release",
      "net8.0-windows",
      "vigil-ui-driver.exe",
    ),
    path.join(
      projectRoot,
      "tools",
      "vigil-ui-driver",
      "bin",
      "Debug",
      "net8.0-windows",
      "vigil-ui-driver.exe",
    ),
    path.join(
      projectRoot,
      "tools",
      "vigil-ui-driver",
      "bin",
      "Release",
      "net8.0-windows",
      "win-x64",
      "vigil-ui-driver.exe",
    ),
  ];
  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }
  return null;
}

/**
 * Heuristic: find a built WinForms exe under the workspace.
 * Prefers bin/Debug|Release *.exe next to *.csproj / *.sln.
 */
export async function detectDesktopAppExe(cwd = process.cwd()) {
  const root = cwd;
  const skip = new Set([
    "node_modules",
    ".git",
    "obj",
    "packages",
    "tools",
    "vigil-ui-driver",
  ]);

  async function walk(dir, depth) {
    if (depth > 5) return [];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    /** @type {string[]} */
    const hits = [];
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (/^bin$/i.test(e.name)) {
          hits.push(...(await findExesInBin(full)));
        } else {
          hits.push(...(await walk(full, depth + 1)));
        }
      }
    }
    return hits;
  }

  async function findExesInBin(binDir) {
    const found = [];
    async function inner(d, depth) {
      if (depth > 4) return;
      let entries;
      try {
        entries = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) await inner(full, depth + 1);
        else if (/\.exe$/i.test(e.name) && !/\.(vshost|Test|Tests)\.exe$/i.test(e.name)) {
          // Prefer non-driver exes
          if (/vigil-ui-driver/i.test(e.name)) continue;
          found.push(full);
        }
      }
    }
    await inner(binDir, 0);
    return found;
  }

  const all = await walk(root, 0);
  if (all.length === 0) return null;

  // Prefer Release then Debug, newest path length as weak signal
  const scored = all.map((p) => {
    let score = 0;
    if (/\\Release\\/i.test(p) || /\/Release\//i.test(p)) score += 3;
    if (/\\Debug\\/i.test(p) || /\/Debug\//i.test(p)) score += 1;
    if (/net[0-9]/i.test(p)) score += 1;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score || a.p.localeCompare(b.p));
  return scored[0]?.p ?? null;
}

function handleStdout(chunk) {
  buffer += chunk.toString("utf8");
  const parts = buffer.split(/\r?\n/);
  buffer = parts.pop() ?? "";
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      msg = { ok: false, error: `Bad driver JSON: ${trimmed.slice(0, 200)}` };
    }
    const next = pending.shift();
    if (next) next.resolve(msg);
  }
}

async function ensureDriver() {
  if (!isWindowsDesktopHost()) return windowsOnlyError();
  if (child && !child.killed) return { ok: true };

  if (starting) return starting;

  starting = (async () => {
    const exe = await resolveUiDriverPath();
    if (!exe) {
      return {
        ok: false,
        error:
          "vigil-ui-driver.exe not found. On Windows run:\n" +
          "  cd tools\\vigil-ui-driver\n" +
          "  dotnet publish -c Release -r win-x64 -o publish\n" +
          "Or set VIGIL_UI_DRIVER to the exe path.",
      };
    }

    child = spawn(exe, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    pending = [];
    buffer = "";

    child.stdout.on("data", handleStdout);
    child.stderr.on("data", (c) => {
      // Surface driver stderr into the next error if useful
      const text = c.toString("utf8").trim();
      if (text) {
        /* keep quiet unless a request fails */
      }
    });
    child.on("exit", () => {
      const err = { ok: false, error: "vigil-ui-driver exited" };
      while (pending.length) pending.shift().resolve(err);
      child = null;
    });

    // First stdout line is the ready ping from the driver.
    const ready = await waitResponse(15_000);
    if (!ready?.ok) {
      try {
        child?.kill();
      } catch {
        /* */
      }
      child = null;
      return ready || { ok: false, error: "Driver did not become ready" };
    }
    return { ok: true, output: ready.output };
  })();

  try {
    return await starting;
  } finally {
    starting = null;
  }
}

function waitResponse(timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const entry = {
      resolve: (msg) => {
        clearTimeout(entry.timer);
        resolve(msg);
      },
      timer: null,
    };
    entry.timer = setTimeout(() => {
      const idx = pending.indexOf(entry);
      if (idx >= 0) pending.splice(idx, 1);
      resolve({ ok: false, error: `Driver timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    pending.push(entry);
  });
}

export async function appRequest(payload, timeoutMs = 60_000) {
  if (!isWindowsDesktopHost()) return windowsOnlyError();
  const boot = await ensureDriver();
  if (!boot.ok) return boot;
  if (!child?.stdin) return { ok: false, error: "Driver stdin unavailable" };

  const waiter = waitResponse(timeoutMs);
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return waiter;
}

export async function app_launch(input = {}, cwd = process.cwd()) {
  let exePath = input.path || input.exe;
  if (!exePath || String(exePath).trim().toLowerCase() === "project") {
    exePath = await detectDesktopAppExe(cwd);
    if (!exePath) {
      return {
        ok: false,
        error:
          "Could not find a built .exe under the workspace. Build the WinForms app, " +
          "or pass path to the .exe.",
      };
    }
  }
  const abs = path.isAbsolute(exePath) ? exePath : path.resolve(cwd, exePath);
  return appRequest({ op: "launch", path: abs, args: input.args || "" }, 90_000);
}

export async function app_attach(input = {}) {
  return appRequest({
    op: "attach",
    pid: input.pid,
    name: input.name || input.processName,
  });
}

export async function app_snapshot(input = {}) {
  return appRequest({ op: "snapshot", max: input.max ?? 100 });
}

export async function app_click(input = {}) {
  return appRequest({ op: "click", ref: input.ref });
}

export async function app_type(input = {}) {
  return appRequest({
    op: "type",
    ref: input.ref,
    text: input.text ?? "",
    clear: input.clear !== false,
    submit: input.submit === true,
  });
}

export async function app_read(input = {}) {
  return appRequest({ op: "read", ref: input.ref });
}

export async function app_wait(input = {}) {
  return appRequest(
    {
      op: "wait",
      ms: input.ms,
      nameContains: input.nameContains || input.name,
      automationId: input.automationId || input.id,
    },
    Math.max(60_000, Number(input.ms) || 5_000) + 5_000,
  );
}

export async function app_close() {
  const result = await appRequest({ op: "close" }, 15_000);
  try {
    child?.kill();
  } catch {
    /* */
  }
  child = null;
  return result;
}
