/**
 * Run Vigil Web `scripts/env-vercel.mjs` (status / push) from the desktop sidecar.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function resolveVigilWebRepo(cwd, projectRoot) {
  const candidates = [
    process.env.VIGIL_WEB_REPO,
    path.resolve(cwd || "", "Vigil-AI-Agent-Web"),
    path.resolve(cwd || "", "..", "Vigil-AI-Agent-Web"),
    path.resolve(projectRoot, "..", "Vigil-AI-Agent-Web"),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "scripts", "env-vercel.mjs"))) {
      return dir;
    }
  }
  return null;
}

function runScript(webRoot, cmd) {
  return new Promise((resolve) => {
    const script = path.join(webRoot, "scripts", "env-vercel.mjs");
    const child = spawn(process.execPath, [script, cmd], {
      cwd: webRoot,
      env: process.env,
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      out += d.toString();
    });
    child.on("error", (err) => resolve({ code: 1, out: String(err) }));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

function parseStatusOut(out, webRoot) {
  const line = String(out || "")
    .trim()
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .pop();
  if (!line) {
    return {
      ok: false,
      foundRepo: true,
      webRoot,
      pushed: false,
      error: String(out || "status failed").slice(-2000),
    };
  }
  try {
    return JSON.parse(line);
  } catch {
    return {
      ok: false,
      foundRepo: true,
      webRoot,
      pushed: false,
      error: line.slice(0, 500),
    };
  }
}

export async function vercelWebEnvOp(action, cwd, projectRoot) {
  const webRoot = resolveVigilWebRepo(cwd, projectRoot);
  if (!webRoot) {
    return {
      ok: false,
      foundRepo: false,
      pushed: false,
      error:
        "مش لاقي مجلد Vigil-AI-Agent-Web جنب الديسكتوب. عيّن VIGIL_WEB_REPO.",
    };
  }
  if (action === "push") {
    const result = await runScript(webRoot, "push");
    const status = parseStatusOut(
      (await runScript(webRoot, "status")).out,
      webRoot,
    );
    const ok = result.code === 0 && status.pushed === true;
    return {
      ...status,
      ok,
      foundRepo: true,
      webRoot,
      log: String(result.out || "").slice(-8000),
      error: ok
        ? status.warning || null
        : String(result.out || "push failed").slice(-2000),
    };
  }
  const result = await runScript(webRoot, "status");
  return {
    ...parseStatusOut(result.out, webRoot),
    foundRepo: true,
    webRoot,
  };
}
