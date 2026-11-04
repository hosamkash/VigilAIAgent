/**
 * Vigil MVP tools — Ripgrep for search; Node fs for file ops.
 * Used by the Node sidecar and unit tests. Sensitive paths trigger git checkpoints.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface ToolResult {
  ok: boolean;
  output: string;
  error?: string;
}

const SENSITIVE_PREFIXES = ["src-tauri", "src/lib"];

export function isSensitivePath(filePath: string, cwd = process.cwd()): boolean {
  const rel = path.relative(cwd, path.resolve(cwd, filePath)).replace(/\\/g, "/");
  return SENSITIVE_PREFIXES.some(
    (prefix) => rel === prefix || rel.startsWith(`${prefix}/`),
  );
}

export async function list_files(
  dirPath = ".",
  cwd = process.cwd(),
): Promise<ToolResult> {
  try {
    const abs = path.resolve(cwd, dirPath);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const lines = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `${e.isDirectory() ? "dir " : "file"} ${e.name}`);
    return { ok: true, output: lines.join("\n") || "(empty)" };
  } catch (err) {
    return { ok: false, output: "", error: String(err) };
  }
}

export async function read_file(
  filePath: string,
  cwd = process.cwd(),
): Promise<ToolResult> {
  try {
    const abs = path.resolve(cwd, filePath);
    const content = await fs.readFile(abs, "utf8");
    return { ok: true, output: content };
  } catch (err) {
    return { ok: false, output: "", error: String(err) };
  }
}

export async function write_file(
  filePath: string,
  content: string,
  cwd = process.cwd(),
): Promise<ToolResult> {
  try {
    const abs = path.resolve(cwd, filePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return { ok: true, output: `Wrote ${filePath}` };
  } catch (err) {
    return { ok: false, output: "", error: String(err) };
  }
}

export async function run_command(
  command: string,
  cwd = process.cwd(),
  timeoutMs = 60_000,
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        ok: false,
        output: stdout,
        error: `Timed out after ${timeoutMs}ms\n${stderr}`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        output: stdout,
        error: code === 0 ? undefined : stderr || `exit ${code}`,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: stdout, error: String(err) });
    });
  });
}

/** Ripgrep-only search for MVP (no FTS5). */
export async function search_files(
  pattern: string,
  cwd = process.cwd(),
  glob?: string,
): Promise<ToolResult> {
  const args = ["--line-number", "--color", "never", "-n", pattern];
  if (glob) args.push("--glob", glob);
  args.push(".");

  return new Promise((resolve) => {
    const child = spawn("rg", args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("close", (code) => {
      // rg exits 1 when no matches
      if (code === 0 || code === 1) {
        resolve({ ok: true, output: stdout || "(no matches)" });
        return;
      }
      resolve({
        ok: false,
        output: stdout,
        error: stderr || `rg exit ${code}`,
      });
    });
    child.on("error", (err) => {
      resolve({
        ok: false,
        output: "",
        error: `ripgrep unavailable: ${String(err)}`,
      });
    });
  });
}

/**
 * Git checkpoint before self-modification of src-tauri or src/lib.
 * Prefers isomorphic-git when available; falls back to `git` CLI.
 */
export async function createGitCheckpoint(
  message: string,
  cwd = process.cwd(),
): Promise<ToolResult> {
  try {
    const git = await import("isomorphic-git");
    const http = await import("isomorphic-git/http/node");
    void http;
    const fsNode = await import("node:fs");
    const status = await git.statusMatrix({ fs: fsNode, dir: cwd });
    const files = status
      .filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1))
      .map(([filepath]) => filepath);

    if (files.length === 0) {
      return { ok: true, output: "No changes to checkpoint" };
    }

    for (const filepath of files) {
      await git.add({ fs: fsNode, dir: cwd, filepath });
    }
    const sha = await git.commit({
      fs: fsNode,
      dir: cwd,
      message,
      author: { name: "Vigil AI Agent", email: "vigil@local" },
    });
    return { ok: true, output: `Checkpoint ${sha.slice(0, 8)}: ${message}` };
  } catch {
    return run_command(
      `git add -A && git commit -m ${JSON.stringify(message)} --allow-empty-message || true`,
      cwd,
    );
  }
}

export async function write_file_safe(
  filePath: string,
  content: string,
  cwd = process.cwd(),
): Promise<ToolResult> {
  if (isSensitivePath(filePath, cwd)) {
    const checkpoint = await createGitCheckpoint(
      `vigil-checkpoint: before editing ${filePath}`,
      cwd,
    );
    if (!checkpoint.ok && checkpoint.error) {
      return {
        ok: false,
        output: "",
        error: `Checkpoint failed: ${checkpoint.error}`,
      };
    }
  }
  return write_file(filePath, content, cwd);
}
