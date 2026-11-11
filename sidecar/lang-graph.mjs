/**
 * LSP-lite language graph over the deep local code index + ripgrep.
 * Provides go-to-definition / find-references without a full language server.
 */

import { spawn } from "node:child_process";
import {
  ensureCodeIndex,
  searchCodeIndex,
  importNeighbors,
} from "./code-index.mjs";

/**
 * @param {string} pattern
 * @param {string} cwd
 * @param {number} max
 */
function rgLines(pattern, cwd, max = 80) {
  return new Promise((resolve) => {
    const child = spawn(
      "rg",
      [
        "-n",
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
        "-g",
        "!*.min.js",
        pattern,
        ".",
      ],
      { cwd, env: process.env },
    );
    let stdout = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.on("close", () => {
      resolve(
        stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, max),
      );
    });
    child.on("error", () => resolve([]));
  });
}

/**
 * Rank definition candidates from the local index.
 * @param {object} index
 * @param {string} symbol
 */
export function pickDefinitions(index, symbol) {
  const name = String(symbol || "").trim();
  if (!name) return [];
  const lower = name.toLowerCase();
  const chunks = Array.isArray(index?.chunks) ? index.chunks : [];
  const defs = chunks
    .filter((c) => {
      if (c.kind === "window" || c.kind === "file") return false;
      return c.title === name || c.title.toLowerCase() === lower;
    })
    .map((c) => {
      let score = 10;
      if (c.title === name) score += 5;
      if (c.kind === "class" || c.kind === "function") score += 3;
      if (c.kind === "interface" || c.kind === "type") score += 2;
      if (c.kind === "method") score += 1;
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return defs;
}

/**
 * @param {string} symbol
 * @param {string} cwd
 */
export async function find_definition(symbol, cwd = process.cwd()) {
  const name = String(symbol || "").trim();
  if (!name) {
    return { ok: false, output: "", error: "find_definition requires symbol" };
  }
  const index = await ensureCodeIndex(cwd);
  let defs = pickDefinitions(index, name);
  if (defs.length === 0) {
    const ranked = searchCodeIndex(index, name, 8);
    defs = (ranked.hits || []).filter(
      (h) =>
        h.kind !== "window" &&
        h.kind !== "file" &&
        h.title.toLowerCase() === name.toLowerCase(),
    );
  }
  if (defs.length === 0) {
    return {
      ok: true,
      output: `No definition found for "${name}" in local index. Try search_codebase.`,
      count: 0,
    };
  }

  const neighbors = importNeighbors(
    index,
    defs.slice(0, 3).map((d) => d.path),
  );
  const lines = [
    `Definition(s) for "${name}" (${defs.length})`,
    "",
    ...defs.slice(0, 12).map((d) => {
      const preview = String(d.text || "")
        .split("\n")
        .slice(2, 8)
        .join("\n")
        .slice(0, 350);
      return [
        `### ${d.title} (${d.kind}) · ${d.path}:${d.startLine}`,
        "```",
        preview,
        "```",
        "",
      ].join("\n");
    }),
  ];
  if (neighbors.size) {
    lines.push("### Nearby via imports");
    lines.push(
      [...neighbors]
        .slice(0, 16)
        .map((p) => `- ${p}`)
        .join("\n"),
    );
  }
  return { ok: true, output: lines.join("\n"), count: defs.length };
}

/**
 * @param {string} symbol
 * @param {string} cwd
 */
export async function find_references(symbol, cwd = process.cwd()) {
  const name = String(symbol || "").trim();
  if (!name) {
    return { ok: false, output: "", error: "find_references requires symbol" };
  }
  const index = await ensureCodeIndex(cwd);
  const defs = pickDefinitions(index, name);
  const defPaths = new Set(defs.map((d) => d.path));

  // Word-boundary-ish ripgrep for call / type sites
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hits = await rgLines(`\\b${escaped}\\b`, cwd, 100);

  /** @type {Map<string, number>} */
  const byFile = new Map();
  /** @type {string[]} */
  const usageLines = [];
  for (const line of hits) {
    const file = line.split(":")[0] || "";
    byFile.set(file, (byFile.get(file) || 0) + 1);
    // Skip pure definition lines when we already know defs
    const isDef =
      defPaths.has(file) &&
      /\b(function|class|interface|type|const|enum|fn|struct|def)\s+/.test(line);
    if (!isDef) usageLines.push(line);
  }

  // Files that import a definition path (graph)
  const importers = [];
  for (const def of defs.slice(0, 5)) {
    const stem = def.path.replace(/\.[^.]+$/, "");
    for (const [from, to] of index.edges || []) {
      if (
        to === stem ||
        to === def.path ||
        def.path.startsWith(to) ||
        to.startsWith(stem)
      ) {
        importers.push(from);
      }
    }
  }

  const lines = [
    `References for "${name}"`,
    defs.length
      ? `Definitions: ${defs
          .slice(0, 6)
          .map((d) => `${d.path}:${d.startLine}`)
          .join(", ")}`
      : "Definitions: (none in index)",
    `Content hits: ${hits.length} · usage lines shown: ${Math.min(usageLines.length, 40)}`,
    "",
    "### Usage",
    usageLines.length
      ? usageLines.slice(0, 40).join("\n")
      : hits.slice(0, 40).join("\n") || "(none)",
    "",
    "### Files by hit count",
    [...byFile.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([f, n]) => `- ${f} (${n})`)
      .join("\n") || "(none)",
  ];
  if (importers.length) {
    lines.push("", "### Importers (graph)");
    lines.push(
      [...new Set(importers)]
        .slice(0, 20)
        .map((p) => `- ${p}`)
        .join("\n"),
    );
  }
  return {
    ok: true,
    output: lines.join("\n"),
    count: hits.length,
  };
}
