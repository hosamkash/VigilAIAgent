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

/** @type {{ attached: boolean, pid: number | null, title: string | null, path: string | null }} */
let session = {
  attached: false,
  pid: null,
  title: null,
  path: null,
};

export function isWindowsDesktopHost() {
  return process.platform === "win32";
}

export function getDesktopSession() {
  return { ...session };
}

function setSession(partial) {
  session = { ...session, ...partial };
}

function clearSession() {
  session = { attached: false, pid: null, title: null, path: null };
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

function profilesFile(cwd) {
  return path.join(cwd, ".vigil", "app-profiles.json");
}

/**
 * @param {string} cwd
 * @returns {Promise<Array<{ id: string, name: string, path: string, args?: string, cwd?: string }>>}
 */
export async function listAppProfiles(cwd = process.cwd()) {
  const file = profilesFile(cwd);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
    return list.filter((p) => p && typeof p.path === "string" && p.path.trim());
  } catch {
    return [];
  }
}

/**
 * @param {string} cwd
 * @param {{ id?: string, name: string, path: string, args?: string, cwd?: string }} profile
 */
export async function saveAppProfile(cwd, profile) {
  const name = String(profile?.name || "").trim();
  const exePath = String(profile?.path || "").trim();
  if (!name || !exePath) {
    return { ok: false, error: "profile requires name and path" };
  }
  const id =
    String(profile.id || "")
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .toLowerCase() ||
    name
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .slice(0, 48) ||
    `profile-${Date.now()}`;

  const dir = path.join(cwd, ".vigil");
  await fs.mkdir(dir, { recursive: true });
  const file = profilesFile(cwd);
  const existing = await listAppProfiles(cwd);
  const next = {
    id,
    name,
    path: exePath,
    args: profile.args ? String(profile.args) : "",
    cwd: profile.cwd ? String(profile.cwd) : "",
  };
  const idx = existing.findIndex((p) => p.id === id);
  if (idx >= 0) existing[idx] = next;
  else existing.push(next);
  await fs.writeFile(file, `${JSON.stringify({ profiles: existing }, null, 2)}\n`, "utf8");
  return { ok: true, output: `Saved profile ${id} (${name})`, profile: next };
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
          "vigil-ui-driver.exe not found. In Vigil on Windows: open the Run sidebar " +
          "(or Settings → Desktop apps) and click «تثبيت محرك الاختبار». " +
          "Requires .NET 8 SDK once. Manual fallback:\n" +
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
    child.stderr.on("data", () => {
      /* keep quiet unless a request fails */
    });
    child.on("exit", () => {
      const err = { ok: false, error: "vigil-ui-driver exited" };
      while (pending.length) pending.shift().resolve(err);
      child = null;
      clearSession();
    });

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

function rememberFromResult(result, fallbackPath = null) {
  if (!result?.ok) return result;
  setSession({
    attached: true,
    pid: typeof result.pid === "number" ? result.pid : session.pid,
    title: typeof result.title === "string" ? result.title : session.title,
    path:
      typeof result.path === "string"
        ? result.path
        : fallbackPath || session.path,
  });
  return result;
}

export async function app_launch(input = {}, cwd = process.cwd()) {
  let exePath = input.path || input.exe;
  let args = input.args || "";
  let workDir = input.cwd || input.workingDirectory || "";

  const profileKey = String(input.profile || input.profileId || "").trim();
  if (profileKey) {
    const profiles = await listAppProfiles(cwd);
    const hit = profiles.find(
      (p) =>
        p.id === profileKey ||
        p.name.toLowerCase() === profileKey.toLowerCase(),
    );
    if (!hit) {
      return {
        ok: false,
        error: `Unknown app profile '${profileKey}'. Use app_profiles_list.`,
      };
    }
    exePath = hit.path;
    args = hit.args || args;
    workDir = hit.cwd || workDir;
  }

  if (!exePath || String(exePath).trim().toLowerCase() === "project") {
    exePath = await detectDesktopAppExe(cwd);
    if (!exePath) {
      return {
        ok: false,
        error:
          "Could not find a built .exe under the workspace. Build the WinForms app, " +
          "or pass path / profile to the .exe.",
      };
    }
  }
  const abs = path.isAbsolute(exePath) ? exePath : path.resolve(cwd, exePath);
  const result = await appRequest(
    {
      op: "launch",
      path: abs,
      args: args || "",
      cwd: workDir || undefined,
    },
    90_000,
  );
  return rememberFromResult(result, abs);
}

export async function app_attach(input = {}) {
  const result = await appRequest({
    op: "attach",
    pid: input.pid,
    name: input.name || input.processName,
  });
  return rememberFromResult(result);
}

export async function app_snapshot(input = {}) {
  return appRequest({ op: "snapshot", max: input.max ?? 100 });
}

export async function app_search_ui(input = {}) {
  return appRequest({
    op: "search",
    query: input.query || input.q || "",
    max: input.max ?? 40,
  });
}

export async function app_screenshot(input = {}, emit) {
  const result = await appRequest({ op: "screenshot" }, 30_000);
  if (result?.ok && result.imageBase64 && typeof emit === "function") {
    emit({
      type: "tool",
      toolName: "app_screenshot",
      imageBase64: result.imageBase64,
      title: result.title,
      pid: result.pid,
    });
  }
  if (result?.ok) {
    rememberFromResult({
      ok: true,
      pid: result.pid,
      title: result.title,
    });
  }
  return result;
}

export async function app_select(input = {}) {
  return appRequest({
    op: "select",
    ref: input.ref,
    value: input.value ?? input.text ?? "",
  });
}

export async function app_keys(input = {}) {
  return appRequest({
    op: "keys",
    keys: input.keys ?? input.text ?? "",
  });
}

export async function app_list_windows() {
  return appRequest({ op: "windows" });
}

export async function app_focus_window(input = {}) {
  return appRequest({
    op: "focus_window",
    index: input.index,
    title: input.title || input.name,
  });
}

export async function app_screen_map(input = {}) {
  return appRequest(
    {
      op: "screen_map",
      maxMenus: input.maxMenus,
      maxItems: input.maxItems,
      timeoutMs: input.timeoutMs,
    },
    Math.max(90_000, Number(input.timeoutMs) || 60_000) + 10_000,
  );
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
  clearSession();
  return result;
}

export async function app_profiles_list(cwd = process.cwd()) {
  const profiles = await listAppProfiles(cwd);
  if (profiles.length === 0) {
    return {
      ok: true,
      output:
        "No saved app profiles. Use app_profiles_save, or launch with path/'project'.",
      profiles: [],
    };
  }
  const lines = profiles.map(
    (p) =>
      `- ${p.id}: ${p.name}\n  path: ${p.path}${p.args ? `\n  args: ${p.args}` : ""}${p.cwd ? `\n  cwd: ${p.cwd}` : ""}`,
  );
  return {
    ok: true,
    output: lines.join("\n"),
    profiles,
  };
}

export async function app_profiles_save(input = {}, cwd = process.cwd()) {
  return saveAppProfile(cwd, input);
}
