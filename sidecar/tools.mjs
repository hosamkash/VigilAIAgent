import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export async function list_files(dirPath = ".", cwd = process.cwd()) {
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

export async function read_file(filePath, cwd = process.cwd()) {
  try {
    const abs = path.resolve(cwd, filePath);
    const content = await fs.readFile(abs, "utf8");
    return { ok: true, output: content };
  } catch (err) {
    return { ok: false, output: "", error: String(err) };
  }
}

export async function write_file(filePath, content, cwd = process.cwd()) {
  try {
    const abs = path.resolve(cwd, filePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return { ok: true, output: `Wrote ${filePath}`, path: filePath, content };
  } catch (err) {
    return { ok: false, output: "", error: String(err) };
  }
}

export async function run_command(command, cwd = process.cwd(), timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: process.env });
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
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
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

/** Build ClineCore `extraTools` from Vigil MVP tools. */
export function buildVigilExtraTools(cwd, onWrite) {
  return [
    {
      name: "list_files",
      description: "List files and directories in a relative path under the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path (default .)" },
        },
      },
      executionMode: "parallel",
      execute: async (input = {}) => {
        const result = await list_files(input.path || ".", cwd);
        if (!result.ok) throw new Error(result.error || "list_files failed");
        return result.output;
      },
    },
    {
      name: "read_file",
      description: "Read a text file from the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
        },
        required: ["path"],
      },
      executionMode: "parallel",
      execute: async (input) => {
        const result = await read_file(input.path, cwd);
        if (!result.ok) throw new Error(result.error || "read_file failed");
        return result.output;
      },
    },
    {
      name: "write_file",
      description:
        "Create or overwrite a text file in the workspace. Use this to create files the user asks for.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "Full file contents" },
        },
        required: ["path", "content"],
      },
      executionMode: "sequential",
      execute: async (input) => {
        const result = await write_file(input.path, input.content ?? "", cwd);
        if (!result.ok) throw new Error(result.error || "write_file failed");
        if (typeof onWrite === "function") {
          onWrite({ path: input.path, content: input.content ?? "" });
        }
        return result.output;
      },
    },
  ];
}
