/**
 * Ops helpers for PR/CI (via gh) and isolated git worktrees.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";

function run(command, cwd, timeoutMs = 120_000) {
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
        code: null,
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
        output: stdout + (stderr && !stdout.endsWith(stderr) ? `\n${stderr}` : ""),
        error: code === 0 ? undefined : stderr || `exit ${code}`,
        code,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: stdout, error: String(err), code: null });
    });
  });
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export async function create_pull_request(
  { title, body = "", draft = true, base = "" } = {},
  cwd = process.cwd(),
) {
  const t = String(title || "").trim();
  if (!t) return { ok: false, output: "", error: "title is required" };
  const parts = [
    "gh pr create",
    `--title ${shQuote(t)}`,
    `--body ${shQuote(body || "")}`,
  ];
  if (draft) parts.push("--draft");
  if (base) parts.push(`--base ${shQuote(base)}`);
  const result = await run(parts.join(" "), cwd);
  if (!result.ok) {
    return {
      ok: false,
      output: result.output,
      error:
        result.error ||
        "gh pr create failed — install GitHub CLI (`gh`) and authenticate, or create the PR from Vigil SCM.",
    };
  }
  return { ok: true, output: result.output.trim() || "PR created" };
}

export async function get_ci_status(cwd = process.cwd()) {
  const checks = await run("gh pr checks", cwd);
  if (checks.ok || checks.output.trim()) {
    const text = checks.output.trim() || checks.error || "";
    const failed = /\bfail/i.test(text);
    const pending = /\bpending\b|\bin progress\b/i.test(text);
    const failedLines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /\bfail/i.test(l));
    return {
      ok: true,
      failed,
      pending,
      output: [
        `CI via gh pr checks (${failed ? "failure" : pending ? "pending" : "ok"}):`,
        text || "(no checks reported)",
        failed
          ? `\nFailing checks:\n${failedLines.map((l) => `- ${l}`).join("\n") || "- (see above)"}\n` +
            "Fix with apply_patch, then push_and_check_ci (or git push + get_ci_status)."
          : pending
            ? "\nChecks still pending — wait briefly and call get_ci_status again."
            : "\nCI looks green.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
  const runs = await run("gh run list --limit 5", cwd);
  if (runs.ok || runs.output.trim()) {
    return {
      ok: true,
      output: `Recent workflow runs:\n${runs.output.trim() || runs.error || "(none)"}`,
    };
  }
  return {
    ok: false,
    output: "",
    error:
      "Could not read CI status — install/authenticate `gh`, or open the PR checks on the host.",
  };
}

/** Push current HEAD then re-read CI checks (PR → CI → Fix loop). */
export async function push_and_check_ci(
  { remote = "origin", setUpstream = true } = {},
  cwd = process.cwd(),
) {
  const remoteName = String(remote || "origin").trim() || "origin";
  const pushCmd = setUpstream
    ? `git push -u ${shQuote(remoteName)} HEAD`
    : `git push ${shQuote(remoteName)} HEAD`;
  const push = await run(pushCmd, cwd, 180_000);
  if (!push.ok) {
    return {
      ok: false,
      output: push.output,
      error: push.error || "git push failed",
    };
  }
  // Brief pause so GitHub registers the push before checks query
  await new Promise((r) => setTimeout(r, 2500));
  const ci = await get_ci_status(cwd);
  return {
    ok: true,
    failed: !!ci.failed,
    pending: !!ci.pending,
    output: [
      "### Push",
      push.output.trim() || "pushed",
      "",
      "### CI",
      ci.ok ? ci.output : ci.error || "CI unavailable",
    ].join("\n"),
  };
}

function worktreeDestination(workspace, branch) {
  const parent = path.dirname(workspace);
  const repoName = path.basename(workspace);
  const safe =
    String(branch)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-|-$/g, "") || "worktree";
  return path.join(parent, `${repoName}.worktrees`, safe);
}

export async function prepare_worktree(
  { branch, path: customPath, createBranch = true } = {},
  cwd = process.cwd(),
) {
  const name = String(branch || "").trim();
  if (!name) return { ok: false, output: "", error: "branch is required" };
  const dest = customPath
    ? path.resolve(cwd, customPath)
    : worktreeDestination(cwd, name);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const exists = await fs
    .access(dest)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    return {
      ok: true,
      output: `Worktree already exists at ${dest}\nUse this path as workdir for subsequent tools.`,
      path: dest,
    };
  }
  const cmd = createBranch
    ? `git worktree add -b ${shQuote(name)} ${shQuote(dest)} HEAD`
    : `git worktree add ${shQuote(dest)} ${shQuote(name)}`;
  const result = await run(cmd, cwd);
  if (!result.ok) {
    return {
      ok: false,
      output: result.output,
      error: result.error || "git worktree add failed",
    };
  }
  return {
    ok: true,
    output: `Worktree ready at ${dest}\nPass workdir=${dest} to read/write/search/run_commands for isolated edits.`,
    path: dest,
  };
}

/** Ensure optional workdir stays inside workspace or a sibling *.worktrees folder. */
export function resolveToolCwd(requested, workspaceCwd) {
  const base = path.resolve(workspaceCwd);
  if (!requested || !String(requested).trim()) return base;
  const abs = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(base, requested);
  const parent = path.dirname(base);
  const worktreesRoot = path.join(parent, `${path.basename(base)}.worktrees`);
  const underBase =
    abs === base || abs.startsWith(base + path.sep);
  const underWorktrees =
    abs === worktreesRoot || abs.startsWith(worktreesRoot + path.sep);
  if (!underBase && !underWorktrees) {
    throw new Error(
      `workdir must be inside the workspace or ${path.basename(base)}.worktrees`,
    );
  }
  return abs;
}
