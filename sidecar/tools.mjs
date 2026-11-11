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
import {
  app_launch,
  app_attach,
  app_snapshot,
  app_click,
  app_type,
  app_read,
  app_wait,
  app_close,
} from "./desktop-app.mjs";
import {
  applyPlanUpdate,
  formatPlanSummary,
} from "./agent-plan.mjs";
import { formatProjectScriptTips } from "./project-scripts.mjs";
import {
  create_pull_request,
  get_ci_status,
  push_and_check_ci,
  prepare_worktree,
  resolveToolCwd,
} from "./ops.mjs";
import {
  ensureCodeIndex,
  buildCodeIndex,
  searchCodeIndex,
  formatIndexHits,
  formatProjectMap,
  upsertIndexedFile,
  getCodeIndexStatus,
} from "./code-index.mjs";
import { find_definition, find_references } from "./lang-graph.mjs";
import {
  mapPool,
  normalizeDelegateTasks,
  formatDelegateSummary,
} from "./parallel-agents.mjs";
import { runFocusedSubagent } from "./subagent.mjs";

function unwrapApp(result) {
  if (!result?.ok) throw new Error(result?.error || "desktop app tool failed");
  return result.output || "ok";
}

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
    let original = "";
    try {
      original = await fs.readFile(abs, "utf8");
    } catch {
      original = "";
    }
    if (typeof remember === "function") await remember(abs);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    try {
      const rel = path.relative(path.resolve(cwd), abs).split(path.sep).join("/");
      if (rel && !rel.startsWith("..")) {
        await upsertIndexedFile(cwd, rel, String(content ?? ""));
      }
    } catch {
      /* index is best-effort */
    }
    return {
      ok: true,
      output: `Wrote ${filePath}`,
      path: filePath,
      content,
      original,
    };
  } catch (err) {
    return { ok: false, output: "", error: String(err) };
  }
}

/** @type {import('node:child_process').ChildProcess | null} */
let activeCommandChild = null;

/** Kill the in-flight run_commands process (Stop / client disconnect). */
export function cancelActiveCommand(signal = "SIGTERM") {
  const child = activeCommandChild;
  if (!child || child.killed) return false;
  try {
    child.kill(signal);
    return true;
  } catch {
    return false;
  }
}

export async function run_command(
  command,
  cwd = process.cwd(),
  timeoutMs = 180_000,
  onChunk,
) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: process.env });
    activeCommandChild = child;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const clearActive = () => {
      if (activeCommandChild === child) activeCommandChild = null;
    };
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearActive();
      resolve(payload);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        ok: false,
        output: stdout,
        error: `Timed out after ${timeoutMs}ms\n${stderr}`,
        code: null,
      });
    }, timeoutMs);
    child.stdout.on("data", (c) => {
      const text = c.toString();
      stdout += text;
      if (typeof onChunk === "function") onChunk(text, "stdout");
    });
    child.stderr.on("data", (c) => {
      const text = c.toString();
      stderr += text;
      if (typeof onChunk === "function") onChunk(text, "stderr");
    });
    child.on("close", (code) => {
      finish({
        ok: code === 0,
        output: stdout + (stderr && !stdout.endsWith(stderr) ? `\n${stderr}` : ""),
        error: code === 0 ? undefined : stderr || `exit ${code}`,
        code,
      });
    });
    child.on("error", (err) => {
      finish({ ok: false, output: stdout, error: String(err), code: null });
    });
  });
}

function scoreSearchHit(line, pattern) {
  const q = String(pattern || "").toLowerCase();
  const lower = line.toLowerCase();
  let score = 0;
  // Prefer source over noise directories
  if (/(^|\/)(node_modules|dist|build|\.git|coverage)\//.test(line)) score -= 40;
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java)(:|$)/.test(line)) score += 8;
  if (q && lower.includes(q)) score += 20;
  // Prefer exact identifier-ish hits in the match column
  const parts = line.split(":");
  const matchText = parts.slice(2).join(":");
  if (q && new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(matchText)) {
    score += 25;
  }
  // Prefer shorter paths (usually closer to the symbol)
  score -= Math.min(12, (parts[0] || "").split("/").length);
  return score;
}

/** Filename + content + local BM25 index search for "where does X live" questions. */
export async function search_codebase(
  query,
  cwd = process.cwd(),
  maxResults = 40,
) {
  const q = String(query || "").trim();
  if (!q) {
    return { ok: false, output: "", error: "search_codebase requires query" };
  }

  // 0) Deep local index (BM25 + vectors + import graph) — sync/build if needed.
  let indexSection = "";
  let indexHits = 0;
  try {
    const index = await ensureCodeIndex(cwd);
    const ranked = searchCodeIndex(index, q, Math.min(14, maxResults));
    indexHits = ranked.hits?.length || 0;
    indexSection = formatIndexHits(q, ranked);
    // Broad / explorative queries get a compact project map for orientation.
    const broad =
      q.split(/\s+/).length <= 2 ||
      /\b(overview|architecture|structure|where|project|codebase)\b/i.test(q);
    if (broad) {
      indexSection += `\n\n${formatProjectMap(index, 36)}`;
    }
  } catch (err) {
    indexSection = `### Local index\n(unavailable: ${err instanceof Error ? err.message : String(err)})`;
  }

  // 1) Path matches via rg --files + filter (fast, respects ignores when available).
  const fileHits = await new Promise((resolve) => {
    const child = spawn(
      "rg",
      [
        "--files",
        "--color",
        "never",
        "--glob",
        "!node_modules/**",
        "--glob",
        "!dist/**",
        "--glob",
        "!build/**",
        "--glob",
        "!.git/**",
      ],
      { cwd, env: process.env },
    );
    let stdout = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.on("close", () => {
      const needle = q.toLowerCase();
      const ranked = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((file) => {
          const lower = file.toLowerCase();
          const base = lower.split("/").pop() || lower;
          let score = 0;
          if (base === needle || base === `${needle}.ts` || base === `${needle}.tsx`) {
            score = 100;
          } else if (base.startsWith(needle)) score = 80;
          else if (base.includes(needle)) score = 50;
          else if (lower.includes(needle)) score = 25;
          return { file, score };
        })
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
        .slice(0, 20);
      resolve(ranked);
    });
    child.on("error", () => resolve([]));
  });

  // 2) Content matches (symbol / call sites).
  const content = await search_files(q, cwd, "", Math.min(maxResults, 40));
  const parts = [
    `Codebase search for "${q}" (cwd=${cwd})`,
    "",
    indexSection,
    "",
    "### Path matches",
    fileHits.length
      ? fileHits.map((h) => `- ${h.file}`).join("\n")
      : "(none)",
    "",
    "### Content matches",
    content.ok ? content.output : `(content search failed: ${content.error || "unknown"})`,
  ];
  return {
    ok: true,
    output: parts.join("\n"),
    pathHits: fileHits.length,
    indexHits,
  };
}

/** Force-rebuild the on-disk local code index. */
export async function reindex_codebase(cwd = process.cwd()) {
  try {
    const index = await buildCodeIndex(cwd);
    return {
      ok: true,
      output: `Rebuilt local code index: ${index.fileCount} files, ${index.chunkCount} chunks`,
      fileCount: index.fileCount,
      chunkCount: index.chunkCount,
      builtAt: index.builtAt,
    };
  } catch (err) {
    return {
      ok: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Fan-out search/defs/refs in parallel (no nested LLM). */
export async function parallel_investigate(input = {}, cwd = process.cwd()) {
  const query = String(input.query || "").trim();
  const symbols = (Array.isArray(input.symbols) ? input.symbols : [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 6);
  if (!query && symbols.length === 0) {
    return {
      ok: false,
      output: "",
      error: "parallel_investigate requires query and/or symbols",
    };
  }
  /** @type {Promise<{ label: string, body: string }>[]} */
  const jobs = [];
  if (query) {
    jobs.push(
      search_codebase(query, cwd, 24).then((r) => ({
        label: `search_codebase:${query}`,
        body: r.ok ? r.output : r.error || "search failed",
      })),
    );
  }
  for (const symbol of symbols) {
    jobs.push(
      find_definition(symbol, cwd).then((r) => ({
        label: `definition:${symbol}`,
        body: r.ok ? r.output : r.error || "definition failed",
      })),
    );
    jobs.push(
      find_references(symbol, cwd).then((r) => ({
        label: `references:${symbol}`,
        body: r.ok ? r.output : r.error || "references failed",
      })),
    );
  }
  const parts = await Promise.all(jobs);
  return {
    ok: true,
    output: [
      `Parallel investigate (${parts.length} probes)`,
      "",
      ...parts.flatMap((p) => [`## ${p.label}`, p.body, ""]),
    ].join("\n"),
    count: parts.length,
  };
}

export {
  ensureCodeIndex,
  upsertIndexedFile,
  getCodeIndexStatus,
  buildCodeIndex,
  find_definition,
  find_references,
  push_and_check_ci,
};

/** Rank ripgrep hits by relevance and return a compact agent-friendly summary. */
export function formatSearchResults(stdout, pattern, maxResults = 40) {
  const lines = String(stdout || "")
    .split("\n")
    .filter(Boolean);
  if (lines.length === 0) {
    return {
      output: "(no matches)",
      count: 0,
    };
  }
  const ranked = lines
    .map((line) => ({ line, score: scoreSearchHit(line, pattern) }))
    .sort((a, b) => b.score - a.score || a.line.localeCompare(b.line));
  const top = ranked.slice(0, maxResults);
  const byFile = new Map();
  for (const { line } of top) {
    const file = line.split(":")[0] || line;
    byFile.set(file, (byFile.get(file) || 0) + 1);
  }
  const summary = [
    `Found ${lines.length} hit(s); showing top ${top.length} by relevance.`,
    `Files: ${[...byFile.keys()].slice(0, 12).join(", ")}${byFile.size > 12 ? ` (+${byFile.size - 12} more)` : ""}`,
    "",
    ...top.map((h) => h.line),
  ].join("\n");
  return { output: summary, count: lines.length };
}

export async function search_files(
  pattern,
  cwd = process.cwd(),
  glob = "",
  maxResults = 40,
) {
  const args = [
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    "--smart-case",
    "-m",
    "30",
  ];
  if (glob) args.push("--glob", String(glob));
  // Keep common noise out of agent search unless explicitly globbed in.
  if (!glob) {
    args.push(
      "--glob",
      "!node_modules/**",
      "--glob",
      "!dist/**",
      "--glob",
      "!build/**",
      "--glob",
      "!.git/**",
    );
  }
  args.push(String(pattern || ""), ".");
  return new Promise((resolve) => {
    const child = spawn("rg", args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("close", (code) => {
      // rg exits 1 when no matches.
      if (code === 0 || code === 1) {
        const formatted = formatSearchResults(stdout, pattern, maxResults);
        resolve({
          ok: true,
          output: formatted.output,
          count: formatted.count,
        });
        return;
      }
      resolve({
        ok: false,
        output: "",
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
 * Build ClineCore `extraTools` from Vigil tools (+ browser / delegates).
 * @param {string} cwd
 * @param {(w: object) => void} [onWrite]
 * @param {(abs: string) => Promise<void> | void} [remember]
 * @param {(evt: object) => void} [emit]
 * @param {{
 *   allowDelegate?: boolean,
 *   workerMode?: boolean,
 *   subagent?: {
 *     loadClineCore: () => Promise<any>,
 *     providerId: string,
 *     modelId: string,
 *     apiKey: string,
 *     autoRun?: boolean,
 *   },
 * }} [options]
 */
export function buildVigilExtraTools(cwd, onWrite, remember, emit, options = {}) {
  const fire = typeof emit === "function" ? emit : () => {};
  const allowDelegate = options.allowDelegate !== false && !options.workerMode;
  const workerMode = !!options.workerMode;
  /** @type {import('./agent-plan.mjs').PlanItem[]} */
  let planItems = [];
  const toolCwd = (input = {}) => resolveToolCwd(input.workdir || input.cwd, cwd);

  /** Leaf tools for nested workers (no browser/desktop/delegates). */
  const buildWorkerTools = (workerCwd, workerEmit) =>
    buildVigilExtraTools(workerCwd, onWrite, remember, workerEmit, {
      allowDelegate: false,
      workerMode: true,
      subagent: undefined,
    });

  /** @type {any[]} */
  const tools = [
    {
      name: "detect_project_scripts",
      description:
        "Read package.json (or report none) and return preferred test/lint commands for this workspace. " +
        "Call this once before running tests if unsure which script to use.",
      inputSchema: {
        type: "object",
        properties: {
          workdir: {
            type: "string",
            description: "Optional worktree/workspace path override",
          },
        },
      },
      executionMode: "parallel",
      execute: async (input = {}) => formatProjectScriptTips(toolCwd(input)),
    },
    {
      name: "prepare_worktree",
      description:
        "Create an isolated git worktree for parallel/safe experiments. Returns a path — pass it as workdir to later tools.",
      inputSchema: {
        type: "object",
        properties: {
          branch: {
            type: "string",
            description: "Branch name for the worktree",
          },
          path: {
            type: "string",
            description: "Optional absolute/relative worktree path",
          },
          createBranch: {
            type: "boolean",
            description: "Create a new branch from HEAD (default true)",
          },
        },
        required: ["branch"],
      },
      executionMode: "sequential",
      execute: async (input = {}) => {
        const result = await prepare_worktree(input, cwd);
        if (!result.ok) throw new Error(result.error || "prepare_worktree failed");
        fire({
          type: "tool",
          toolName: "prepare_worktree",
          path: result.path,
          hook: "end",
        });
        return result.output;
      },
    },
    {
      name: "create_pull_request",
      description:
        "Create a draft pull request with GitHub CLI (`gh`). Requires gh auth. Prefer after pushing the branch.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          base: { type: "string", description: "Base branch (default host default)" },
          draft: { type: "boolean", description: "Create as draft (default true)" },
          workdir: { type: "string" },
        },
        required: ["title"],
      },
      executionMode: "sequential",
      execute: async (input = {}) => {
        const result = await create_pull_request(input, toolCwd(input));
        if (!result.ok) throw new Error(result.error || "create_pull_request failed");
        fire({
          type: "tool",
          toolName: "create_pull_request",
          url: result.output,
          hook: "end",
        });
        return result.output;
      },
    },
    {
      name: "get_ci_status",
      description:
        "Read CI / PR checks for the current branch via `gh pr checks` (or recent workflow runs). Use after push/PR to fix failures.",
      inputSchema: {
        type: "object",
        properties: {
          workdir: { type: "string" },
        },
      },
      executionMode: "parallel",
      execute: async (input = {}) => {
        const result = await get_ci_status(toolCwd(input));
        if (!result.ok) throw new Error(result.error || "get_ci_status failed");
        fire({
          type: "tool",
          toolName: "get_ci_status",
          chunk: result.output,
          hook: "end",
        });
        return result.output;
      },
    },
    {
      name: "push_and_check_ci",
      description:
        "Push HEAD to origin (set upstream) then read PR/CI checks. Use in the PR→CI→Fix loop after commits.",
      inputSchema: {
        type: "object",
        properties: {
          remote: { type: "string", description: "Git remote (default origin)" },
          setUpstream: { type: "boolean", description: "git push -u (default true)" },
          workdir: { type: "string" },
        },
      },
      executionMode: "sequential",
      execute: async (input = {}) => {
        const result = await push_and_check_ci(input, toolCwd(input));
        if (!result.ok) throw new Error(result.error || "push_and_check_ci failed");
        fire({
          type: "tool",
          toolName: "push_and_check_ci",
          chunk: result.output,
          hook: "end",
        });
        return result.output;
      },
    },
    {
      name: "manage_plan",
      description:
        "Create or update the visible step plan for this turn. Use for multi-step work: " +
        "set items with status pending/in_progress/completed/cancelled, keep one in_progress, " +
        "and update as you finish each step so the user can follow progress.",
      inputSchema: {
        type: "object",
        properties: {
          merge: {
            type: "boolean",
            description: "Merge into the current plan (default true). false replaces all items.",
          },
          items: {
            type: "array",
            description: "Plan steps",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                status: {
                  type: "string",
                  description: "pending | in_progress | completed | cancelled",
                },
              },
              required: ["content"],
            },
          },
        },
        required: ["items"],
      },
      executionMode: "parallel",
      execute: async (input = {}) => {
        const merge = input.merge !== false;
        planItems = applyPlanUpdate(merge ? planItems : [], {
          ...input,
          merge,
          replace: !merge,
        });
        fire({
          type: "tool",
          toolName: "manage_plan",
          hook: "update",
          planItems: planItems.map((item) => ({ ...item })),
        });
        return `Plan updated (${planItems.length} steps):\n${formatPlanSummary(planItems)}`;
      },
    },
    {
      name: "list_files",
      description: "List files and directories in a relative path under the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path (default .)" },
          workdir: { type: "string", description: "Optional worktree path override" },
        },
      },
      executionMode: "parallel",
      execute: async (input = {}) => {
        const result = await list_files(input.path || ".", toolCwd(input));
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
          workdir: { type: "string", description: "Optional worktree path override" },
        },
        required: ["path"],
      },
      executionMode: "parallel",
      execute: async (input) => {
        const result = await read_file(input.path, toolCwd(input));
        if (!result.ok) throw new Error(result.error || "read_file failed");
        return result.output;
      },
    },
    {
      name: "write_file",
      description:
        "Create or overwrite a text file. Prefer this for NEW files; for edits to existing files prefer apply_patch.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "Full file contents" },
          workdir: { type: "string", description: "Optional worktree path override" },
        },
        required: ["path", "content"],
      },
      executionMode: "sequential",
      execute: async (input) => {
        const activeCwd = toolCwd(input);
        const result = await write_file(
          input.path,
          input.content ?? "",
          activeCwd,
          remember,
        );
        if (!result.ok) throw new Error(result.error || "write_file failed");
        if (typeof onWrite === "function") {
          onWrite({
            path: input.path,
            content: input.content ?? "",
            original: result.original ?? "",
          });
        }
        return result.output;
      },
    },
    {
      name: "search_files",
      description:
        "Search the workspace (cwd) with ripgrep. Results are ranked by relevance and summarized. Use to find symbols, call sites, and text when the user asks where something lives or is called — before editing.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex or literal search pattern" },
          glob: {
            type: "string",
            description: "Optional glob filter, e.g. '*.ts' or 'src/**'",
          },
          workdir: { type: "string", description: "Optional worktree path override" },
        },
        required: ["pattern"],
      },
      executionMode: "parallel",
      execute: async (input = {}) => {
        const result = await search_files(
          input.pattern || "",
          toolCwd(input),
          input.glob || "",
        );
        if (!result.ok) throw new Error(result.error || "search_files failed");
        return result.output;
      },
    },
    {
      name: "search_codebase",
      description:
        "Higher-level workspace search: local BM25 chunk/symbol index + ranked file paths + content hits. Prefer this when the user asks where something lives, is defined, or is used across the project.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Symbol, filename stem, or topic to locate",
          },
          workdir: { type: "string", description: "Optional worktree path override" },
        },
        required: ["query"],
      },
      executionMode: "parallel",
      execute: async (input = {}) => {
        const result = await search_codebase(input.query || "", toolCwd(input));
        if (!result.ok) throw new Error(result.error || "search_codebase failed");
        return result.output;
      },
    },
    {
      name: "reindex_codebase",
      description:
        "Force-rebuild the deep local code index (AST chunks + BM25 + embeddings + import graph under .vigil/). Use after large refactors or if search_codebase hits look stale.",
      inputSchema: {
        type: "object",
        properties: {
          workdir: { type: "string", description: "Optional worktree path override" },
        },
      },
      executionMode: "sequential",
      execute: async (input = {}) => {
        const result = await reindex_codebase(toolCwd(input));
        if (!result.ok) throw new Error(result.error || "reindex_codebase failed");
        fire({
          type: "status",
          status: `code_index=${result.fileCount || 0}f/${result.chunkCount || 0}c`,
        });
        fire({
          type: "tool",
          toolName: "reindex_codebase",
          hook: "end",
          chunk: result.output,
        });
        return result.output;
      },
    },
    {
      name: "find_definition",
      description:
        "Go-to-definition via the local language graph/index. Prefer this when you need the declaration site of a known symbol (function/class/type).",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Symbol name to resolve" },
          workdir: { type: "string", description: "Optional worktree path override" },
        },
        required: ["symbol"],
      },
      executionMode: "parallel",
      execute: async (input = {}) => {
        const result = await find_definition(input.symbol || "", toolCwd(input));
        if (!result.ok) throw new Error(result.error || "find_definition failed");
        return result.output;
      },
    },
    {
      name: "find_references",
      description:
        "Find references/usages of a symbol across the workspace (index definitions + ripgrep usages + import-graph importers).",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Symbol name to find usages of" },
          workdir: { type: "string", description: "Optional worktree path override" },
        },
        required: ["symbol"],
      },
      executionMode: "parallel",
      execute: async (input = {}) => {
        const result = await find_references(input.symbol || "", toolCwd(input));
        if (!result.ok) throw new Error(result.error || "find_references failed");
        return result.output;
      },
    },
    {
      name: "parallel_investigate",
      description:
        "Fan-out deep investigation in parallel: optional topic search_codebase plus find_definition/find_references for each symbol. Prefer this to explore a large repo quickly before editing.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Topic / area to search (optional if symbols provided)",
          },
          symbols: {
            type: "array",
            items: { type: "string" },
            description: "Symbol names to resolve definitions + references for",
          },
          workdir: { type: "string" },
        },
      },
      executionMode: "parallel",
      execute: async (input = {}) => {
        const result = await parallel_investigate(input, toolCwd(input));
        if (!result.ok) throw new Error(result.error || "parallel_investigate failed");
        return result.output;
      },
    },
    {
      name: "delegate_tasks",
      description:
        "Run up to 6 focused subagents in parallel (concurrency 2). Optionally create a git worktree per task via branch. " +
        "Use for independent investigations or isolated edits on large features. Returns merged summaries.",
      inputSchema: {
        type: "object",
        properties: {
          concurrency: {
            type: "number",
            description: "Max parallel workers (default 2, max 3)",
          },
          isolate: {
            type: "boolean",
            description: "Create a worktree per task when branch is set (default true)",
          },
          tasks: {
            type: "array",
            description: "Independent tasks",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                prompt: { type: "string" },
                branch: {
                  type: "string",
                  description: "Optional worktree branch name for isolation",
                },
              },
              required: ["prompt"],
            },
          },
        },
        required: ["tasks"],
      },
      executionMode: "sequential",
      execute: async (input = {}) => {
        if (!allowDelegate) {
          throw new Error("delegate_tasks is not available inside a subagent");
        }
        const sub = options.subagent;
        if (!sub?.apiKey || !sub.loadClineCore) {
          throw new Error("delegate_tasks unavailable (missing subagent runtime)");
        }
        const specs = normalizeDelegateTasks(input);
        if (specs.length === 0) {
          throw new Error("delegate_tasks requires at least one task with a prompt");
        }
        const isolate = input.isolate !== false;
        const concurrency = Math.max(
          1,
          Math.min(3, Number(input.concurrency) || 2),
        );
        /** @type {import('./parallel-agents.mjs').DelegateJob[]} */
        const jobs = specs.map((spec) => ({
          id: crypto.randomUUID(),
          title: spec.title,
          prompt: spec.prompt,
          branch: spec.branch,
          status: /** @type {const} */ ("pending"),
        }));
        fire({
          type: "tool",
          toolName: "delegate_tasks",
          hook: "start",
          delegateJobs: jobs.map((j) => ({ ...j })),
        });

        await mapPool(jobs, concurrency, async (job) => {
          job.status = "running";
          fire({
            type: "tool",
            toolName: "delegate_tasks",
            hook: "update",
            delegateJobs: jobs.map((j) => ({ ...j })),
          });
          let workdir = cwd;
          if (isolate && job.branch) {
            const wt = await prepare_worktree(
              { branch: job.branch, createBranch: true },
              cwd,
            );
            if (!wt.ok) {
              job.status = "failed";
              job.error = wt.error || "worktree failed";
              return;
            }
            workdir = wt.path || cwd;
            job.workdir = workdir;
          }
          const result = await runFocusedSubagent({
            loadClineCore: sub.loadClineCore,
            buildWorkerTools,
            providerId: sub.providerId,
            modelId: sub.modelId,
            apiKey: sub.apiKey,
            cwd: workdir,
            prompt: job.prompt,
            title: job.title,
            autoRun: sub.autoRun !== false,
            emit: fire,
          });
          if (result.ok) {
            job.status = "completed";
            job.result = result.text;
          } else {
            job.status = "failed";
            job.error = result.error || "subagent failed";
            job.result = result.text || "";
          }
          fire({
            type: "tool",
            toolName: "delegate_tasks",
            hook: "update",
            delegateJobs: jobs.map((j) => ({ ...j })),
          });
        });

        fire({
          type: "tool",
          toolName: "delegate_tasks",
          hook: "end",
          delegateJobs: jobs.map((j) => ({ ...j })),
        });
        const failed = jobs.filter((j) => j.status === "failed").length;
        const done = jobs.filter((j) => j.status === "completed").length;
        return [
          `Delegates finished: ${done} ok, ${failed} failed (concurrency=${concurrency})`,
          formatDelegateSummary(jobs),
        ].join("\n\n");
      },
    },
    {
      name: "run_commands",
      description:
        "Run a shell command in the workspace (tests, builds, lint, git). " +
        "After meaningful code edits in a JS/TS project, prefer `npm test` / `npm run lint` " +
        "(or the scripts in package.json). If the command fails, fix the code and re-run until green " +
        "or you hit a real blocker. Auto-run Off means the user must approve each non-allowlisted command.",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to run in the project root",
          },
          commands: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of commands joined with &&",
          },
          workdir: { type: "string", description: "Optional worktree path override" },
        },
      },
      executionMode: "sequential",
      execute: async (input = {}) => {
        const command = String(
          input.command ||
            (Array.isArray(input.commands) ? input.commands.join(" && ") : "") ||
            "",
        ).trim();
        if (!command) throw new Error("run_commands requires command");
        const activeCwd = toolCwd(input);
        fire({
          type: "tool",
          toolName: "run_commands",
          command,
          hook: "start",
        });
        const result = await run_command(
          command,
          activeCwd,
          180_000,
          (chunk, stream) => {
            fire({
              type: "tool",
              toolName: "run_commands",
              command,
              chunk,
              stream,
              hook: "output",
            });
          },
        );
        const exitCode = result.code ?? (result.ok ? 0 : 1);
        const excerpt = (result.ok ? result.output : result.error || result.output || "")
          .split("\n")
          .slice(-12)
          .join("\n")
          .slice(0, 1200);
        fire({
          type: "tool",
          toolName: "run_commands",
          command,
          hook: "end",
          exitCode,
          chunk: excerpt,
        });
        if (!result.ok) {
          return (
            `Command finished · exit ${exitCode}\n` +
            `${result.error || ""}\n${result.output || ""}\n` +
            "Fix the failure, then re-run the same command (or the project's test/lint script)."
          ).trim();
        }
        return result.output || `Command finished · exit ${exitCode}`;
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
        "For opening a page the user should SEE: use browser_open instead (in-editor only). " +
        "This tool runs headless automation only (no visible OS browser window) and also " +
        "updates the in-editor Vigil Browser tab. Use for click/type/screenshot workflows. " +
        "Never open Chrome/Chromium visibly unless headless=false is explicitly requested.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "URL to open. Pass 'project' to auto-detect the workspace preview URL.",
          },
          headless: {
            type: "boolean",
            description: "Default true. Set false only if the user asks for a visible automation browser.",
          },
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
        // Always mirror into the in-editor tab. Automation stays headless by default.
        fire({ type: "tool", toolName: "browser_open", url });
        const result = await browser_navigate(
          { ...input, url, headless: input.headless !== false },
          fire,
        );
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
    {
      name: "app_launch",
      description:
        "Windows only. Launch a WinForms / DevExpress desktop .exe for UI testing. " +
        "Pass path to the exe, or 'project' to auto-detect under bin/Debug|Release. " +
        "Then use app_snapshot → app_click / app_type / app_read.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to .exe, or 'project' to auto-detect",
          },
          args: { type: "string", description: "Optional process arguments" },
        },
        required: ["path"],
      },
      executionMode: "sequential",
      execute: async (input = {}) => unwrapApp(await app_launch(input, cwd)),
    },
    {
      name: "app_attach",
      description:
        "Windows only. Attach to an already-running desktop app by pid or process/window name.",
      inputSchema: {
        type: "object",
        properties: {
          pid: { type: "number" },
          name: { type: "string", description: "Process or window title substring" },
        },
      },
      executionMode: "sequential",
      execute: async (input = {}) => unwrapApp(await app_attach(input)),
    },
    {
      name: "app_snapshot",
      description:
        "Windows only. Capture the desktop app UI tree with element refs [e1], [e2]… " +
        "(buttons, edits, combos, menu items — including many DevExpress controls).",
      inputSchema: {
        type: "object",
        properties: { max: { type: "number", description: "Max elements (default 100)" } },
      },
      executionMode: "parallel",
      execute: async (input = {}) => unwrapApp(await app_snapshot(input)),
    },
    {
      name: "app_click",
      description: "Windows only. Click a desktop UI element by ref from app_snapshot.",
      inputSchema: {
        type: "object",
        properties: { ref: { type: "string" } },
        required: ["ref"],
      },
      executionMode: "sequential",
      execute: async (input) => unwrapApp(await app_click(input)),
    },
    {
      name: "app_type",
      description:
        "Windows only. Type into a desktop field by ref. Clears existing value by default.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string" },
          text: { type: "string" },
          clear: { type: "boolean" },
          submit: { type: "boolean", description: "Press Enter after typing" },
        },
        required: ["ref", "text"],
      },
      executionMode: "sequential",
      execute: async (input) => unwrapApp(await app_type(input)),
    },
    {
      name: "app_read",
      description: "Windows only. Read name/value/automationId of an element by ref.",
      inputSchema: {
        type: "object",
        properties: { ref: { type: "string" } },
        required: ["ref"],
      },
      executionMode: "parallel",
      execute: async (input) => unwrapApp(await app_read(input)),
    },
    {
      name: "app_wait",
      description:
        "Windows only. Wait until an element name/AutomationId appears (or just sleep ms).",
      inputSchema: {
        type: "object",
        properties: {
          ms: { type: "number" },
          nameContains: { type: "string" },
          name: { type: "string" },
          automationId: { type: "string" },
          id: { type: "string" },
        },
      },
      executionMode: "sequential",
      execute: async (input = {}) => unwrapApp(await app_wait(input)),
    },
    {
      name: "app_close",
      description: "Windows only. Close the attached/launched desktop app and stop the UI driver.",
      inputSchema: { type: "object", properties: {} },
      executionMode: "sequential",
      execute: async () => unwrapApp(await app_close()),
    },
  ];

  if (workerMode) {
    const blocked = new Set([
      "delegate_tasks",
      "browser_open",
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_press",
      "browser_screenshot",
      "browser_tabs",
      "browser_select_option",
      "browser_wait",
      "browser_close",
      "app_launch",
      "app_attach",
      "app_snapshot",
      "app_click",
      "app_type",
      "app_read",
      "app_wait",
      "app_close",
      "create_pull_request",
    ]);
    return tools.filter((t) => !blocked.has(t.name));
  }
  if (!allowDelegate) {
    return tools.filter((t) => t.name !== "delegate_tasks");
  }
  return tools;
}
