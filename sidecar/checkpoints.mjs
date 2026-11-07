/**
 * Local file snapshots taken before an agent command changes the workspace.
 * Stored under ~/.vigil-agent/checkpoints, never in the chat database.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_BYTES = 1_500_000;
const writeFile = fsp.writeFile.bind(fsp);
const rename = fsp.rename.bind(fsp);
const mkdir = fsp.mkdir.bind(fsp);
const readFile = fsp.readFile.bind(fsp);

export function normalizeWorkspaceRoot(input) {
  const slash = String(input ?? "").replace(/\\/g, "/").replace(/\/+/g, "/");
  const drive = /^[A-Za-z]:/.exec(slash);
  const body = drive ? slash.slice(2) : slash;
  const stack = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const prefix = drive ? `${drive[0].toUpperCase()}/` : "/";
  const joined = `${prefix}${stack.join("/")}`.replace(/\/+$/, "");
  return joined || (drive ? `${drive[0].toUpperCase()}/` : "/");
}

export function workspaceCheckpointKey(workspace) {
  const root = normalizeWorkspaceRoot(path.resolve(workspace));
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}

export function checkpointFolder(workspace, rootDir) {
  const base = rootDir || path.join(os.homedir(), ".vigil-agent", "checkpoints");
  return path.join(base, workspaceCheckpointKey(workspace));
}

function asPath(file) {
  if (typeof file === "string") return file;
  if (file instanceof URL) return file.pathname;
  return null;
}

export function createCheckpointWriter({ id, workspace, createdAt, rootDir }) {
  const safeId = String(id ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) throw new Error("checkpoint id required");
  const root = path.resolve(workspace);
  const dir = checkpointFolder(root, rootDir);
  const file = path.join(dir, `${safeId}.json`);
  const files = new Map();
  const gates = new Map();

  function relative(target) {
    const raw = asPath(target);
    if (!raw) return null;
    const resolved = path.resolve(root, raw);
    const rel = path.relative(root, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    const posix = rel.split(path.sep).join("/");
    if (posix === ".git" || posix.startsWith(".git/")) return null;
    return posix;
  }

  function readSnapshot(rel, buf) {
    if (buf.includes(0) || buf.length > MAX_BYTES) return null;
    return { path: rel, existed: true, content: buf.toString("utf8") };
  }

  async function capture(rel) {
    if (files.has(rel)) return;
    let snap = { path: rel, existed: false, content: "" };
    try {
      const buf = await readFile(path.join(root, rel));
      const read = readSnapshot(rel, buf);
      if (!read) return;
      snap = read;
    } catch (err) {
      if (err?.code !== "ENOENT") return;
    }
    if (files.has(rel)) return;
    files.set(rel, snap);
    await flush();
  }

  function remember(target) {
    const rel = relative(target);
    if (!rel || files.has(rel)) return Promise.resolve();
    let job = gates.get(rel);
    if (!job) {
      job = capture(rel).finally(() => gates.delete(rel));
      gates.set(rel, job);
    }
    return job;
  }

  function rememberSync(target) {
    const rel = relative(target);
    if (!rel || files.has(rel) || gates.has(rel)) return;
    let snap = { path: rel, existed: false, content: "" };
    try {
      const buf = fs.readFileSync(path.join(root, rel));
      const read = readSnapshot(rel, buf);
      if (!read) return;
      snap = read;
    } catch (err) {
      if (err?.code !== "ENOENT") return;
    }
    files.set(rel, snap);
    flushSync();
  }

  function body() {
    return JSON.stringify({
      id: safeId,
      workspace: normalizeWorkspaceRoot(root),
      createdAt: createdAt || Date.now(),
      files: [...files.values()],
    });
  }

  async function flush() {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, body(), "utf8");
    await rename(tmp, file);
  }

  function flushSync() {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body(), "utf8");
    fs.renameSync(tmp, file);
  }

  return { remember, rememberSync, file };
}

/** Capture the first write under the workspace, including tools that bypass write_file. */
export function installWriteCapture(remember, rememberSync) {
  const origP = fsp.writeFile;
  const orig = fs.writeFile;
  const origSync = fs.writeFileSync;
  const origUnlink = fsp.unlink;

  fsp.writeFile = async function patchedWrite(file, ...args) {
    await remember(file);
    return origP.call(fsp, file, ...args);
  };
  fsp.unlink = async function patchedUnlink(file, ...args) {
    await remember(file);
    return origUnlink.call(fsp, file, ...args);
  };
  fs.writeFile = function patchedWrite(file, ...args) {
    const cb = args.at(-1);
    if (typeof cb === "function") {
      const rest = args.slice(0, -1);
      remember(file).then(
        () => orig.call(fs, file, ...rest, cb),
        (err) => cb(err),
      );
      return;
    }
    return remember(file).then(() => orig.call(fs, file, ...args));
  };
  fs.writeFileSync = function patchedWriteSync(file, ...args) {
    rememberSync(file);
    return origSync.call(fs, file, ...args);
  };

  return function release() {
    fsp.writeFile = origP;
    fsp.unlink = origUnlink;
    fs.writeFile = orig;
    fs.writeFileSync = origSync;
  };
}
