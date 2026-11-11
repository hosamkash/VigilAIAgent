/**
 * Local parallel workers: concurrency pool + job tracking for delegate_tasks.
 */

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, concurrency, fn) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
  /** @type {R[]} */
  const results = new Array(list.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= list.length) return;
      results[idx] = await fn(list[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   prompt: string,
 *   branch?: string,
 *   workdir?: string,
 *   status: "pending" | "running" | "completed" | "failed",
 *   result?: string,
 *   error?: string,
 * }} DelegateJob
 */

/**
 * Normalize delegate task input from the model.
 * @param {unknown} input
 * @returns {Array<{ title: string, prompt: string, branch?: string }>}
 */
export function normalizeDelegateTasks(input) {
  const obj =
    input && typeof input === "object"
      ? /** @type {Record<string, unknown>} */ (input)
      : {};
  const raw = Array.isArray(obj.tasks)
    ? obj.tasks
    : Array.isArray(obj.items)
      ? obj.items
      : [];
  /** @type {Array<{ title: string, prompt: string, branch?: string }>} */
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (item);
    const prompt = String(row.prompt || row.task || row.content || "").trim();
    if (!prompt) continue;
    const title = String(row.title || row.name || prompt.slice(0, 60)).trim();
    const branch = String(row.branch || row.worktree || "").trim() || undefined;
    out.push({ title, prompt, branch });
  }
  return out.slice(0, 6); // hard cap — quality over fan-out
}

/**
 * @param {DelegateJob[]} jobs
 */
export function formatDelegateSummary(jobs) {
  if (!jobs.length) return "(no delegate jobs)";
  return jobs
    .map((job, i) => {
      const head = `${i + 1}. [${job.status}] ${job.title}`;
      if (job.status === "failed") {
        return `${head}\n   error: ${job.error || "failed"}`;
      }
      if (job.result) {
        const preview = job.result.replace(/\s+/g, " ").slice(0, 280);
        return `${head}\n   ${preview}${job.result.length > 280 ? "…" : ""}`;
      }
      return head;
    })
    .join("\n");
}
