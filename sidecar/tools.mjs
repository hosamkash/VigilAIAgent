import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  browser_navigate,
  browser_snapshot,
  browser_click,
  browser_type,
  browser_press,
  browser_screenshot,
  browser_tabs,
  browser_select_option,
  browser_wait,
  browser_close,
  detectProjectUrl,
} from "./browser.mjs";

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

export async function write_file(filePath, content, cwd = process.cwd(), remember) {
  try {
    const abs = path.resolve(cwd, filePath);
    if (typeof remember === "function") await remember(abs);
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

/** Build ClineCore `extraTools` from Vigil MVP tools (+ browser automation). */
export function buildVigilExtraTools(cwd, onWrite, remember, emit) {
  const fire = typeof emit === "function" ? emit : () => {};
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
        const result = await write_file(input.path, input.content ?? "", cwd, remember);
        if (!result.ok) throw new Error(result.error || "write_file failed");
        if (typeof onWrite === "function") {
          onWrite({ path: input.path, content: input.content ?? "" });
        }
        return result.output;
      },
    },
    {
      name: "browser_open",
      description:
        "REQUIRED when the user asks to open a browser, preview, localhost, or a link inside Vigil. " +
        "Opens Vigil Browser (the built-in IDE preview tab) immediately — you control this yourself. " +
        "Do NOT tell the user to use Command Palette, Simple Browser: Show, Cmd+Shift+P, or any manual steps. " +
        "Do NOT open the OS/system browser. Pass url 'project' to auto-detect the workspace preview URL.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "URL to show in Vigil Browser (e.g. http://localhost:4300). Use 'project' to auto-detect.",
          },
        },
        required: ["url"],
      },
      executionMode: "sequential",
      execute: async (input = {}) => {
        let url = input.url;
        if (!url || String(url).trim().toLowerCase() === "project") {
          url = await detectProjectUrl(cwd);
        }
        url = String(url).trim();
        if (
          url.startsWith("localhost") ||
          url.startsWith("127.") ||
          /^\d{1,3}(\.\d{1,3}){3}/.test(url)
        ) {
          url = url.includes("://") ? url : `http://${url}`;
        } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
          url = `https://${url}`;
        }
        fire({ type: "tool", toolName: "browser_open", url });
        return `Opened Vigil Browser at ${url}`;
      },
    },
    {
      name: "browser_navigate",
      description:
        "Launch/control the automation browser (Chrome/Edge or bundled Chromium) for click/type/screenshot testing. " +
        "Also syncs Vigil Browser preview. Prefer browser_open when the user only wants to see a page. " +
        "Returns an accessibility snapshot with refs [e1], [e2]…",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "URL to open. Pass 'project' to auto-detect the workspace preview URL.",
          },
          headless: { type: "boolean", description: "Run headless (default false / visible)" },
          cdpUrl: {
            type: "string",
            description: "Attach to an existing browser via CDP (default http://127.0.0.1:9222)",
          },
        },
        required: ["url"],
      },
      executionMode: "sequential",
      execute: async (input = {}) => {
        let url = input.url;
        if (!url || String(url).trim().toLowerCase() === "project") {
          url = await detectProjectUrl(cwd);
        }
        // Mirror into Vigil Browser so the user always sees the page in-IDE.
        fire({ type: "tool", toolName: "browser_open", url });
        const result = await browser_navigate({ ...input, url }, fire);
        return result.output;
      },
    },
    {
      name: "browser_snapshot",
      description:
        "Capture the current page accessibility tree with element refs for click/type.",
      inputSchema: { type: "object", properties: {} },
      executionMode: "parallel",
      execute: async () => {
        const result = await browser_snapshot();
        return result.output;
      },
    },
    {
      name: "browser_click",
      description: "Click an element by ref from the latest browser_snapshot (e.g. e3).",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Element ref like e1" },
        },
        required: ["ref"],
      },
      executionMode: "sequential",
      execute: async (input) => {
        const result = await browser_click(input);
        return result.output;
      },
    },
    {
      name: "browser_type",
      description: "Type text into an element by ref. Clears existing value by default.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string" },
          text: { type: "string" },
          submit: { type: "boolean", description: "Press Enter after typing" },
          clear: { type: "boolean", description: "Clear field first (default true)" },
        },
        required: ["ref", "text"],
      },
      executionMode: "sequential",
      execute: async (input) => {
        const result = await browser_type(input);
        return result.output;
      },
    },
    {
      name: "browser_press",
      description: "Press a keyboard key (Enter, Escape, Tab, ArrowDown…). Optional ref focuses first.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string" },
          ref: { type: "string" },
        },
        required: ["key"],
      },
      executionMode: "sequential",
      execute: async (input) => {
        const result = await browser_press(input);
        return result.output;
      },
    },
    {
      name: "browser_screenshot",
      description: "Take a PNG screenshot of the current page and send it to the IDE.",
      inputSchema: {
        type: "object",
        properties: {
          fullPage: { type: "boolean" },
        },
      },
      executionMode: "parallel",
      execute: async (input = {}) => {
        const result = await browser_screenshot(input, fire);
        return result.output;
      },
    },
    {
      name: "browser_tabs",
      description: "List open browser tabs and connection mode (cdp / channel / bundled).",
      inputSchema: { type: "object", properties: {} },
      executionMode: "parallel",
      execute: async () => {
        const result = await browser_tabs();
        return result.output;
      },
    },
    {
      name: "browser_select_option",
      description: "Select option(s) in a <select> by ref.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string" },
          value: { type: "string" },
          values: { type: "array", items: { type: "string" } },
        },
        required: ["ref"],
      },
      executionMode: "sequential",
      execute: async (input) => {
        const result = await browser_select_option(input);
        return result.output;
      },
    },
    {
      name: "browser_wait",
      description: "Wait a short time (ms) then re-snapshot. Max 30000.",
      inputSchema: {
        type: "object",
        properties: { ms: { type: "number" } },
      },
      executionMode: "sequential",
      execute: async (input = {}) => {
        const result = await browser_wait(input);
        return result.output;
      },
    },
    {
      name: "browser_close",
      description: "Close the Vigil-controlled browser session.",
      inputSchema: { type: "object", properties: {} },
      executionMode: "sequential",
      execute: async () => {
        const result = await browser_close();
        return result.output;
      },
    },
  ];
}
