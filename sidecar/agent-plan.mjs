/**
 * In-turn agent plan / todos for Heavy Agent Loop.
 * Kept in-memory per manage_plan tool instance (one task run).
 */

/** @typedef {"pending" | "in_progress" | "completed" | "cancelled"} PlanStatus */

/**
 * @typedef {{ id: string, content: string, status: PlanStatus }} PlanItem
 */

/** @param {unknown} status */
export function normalizePlanStatus(status) {
  const s = String(status || "pending").toLowerCase();
  if (s === "in_progress" || s === "in-progress" || s === "doing") {
    return "in_progress";
  }
  if (s === "completed" || s === "done" || s === "complete") return "completed";
  if (s === "cancelled" || s === "canceled" || s === "skipped") {
    return "cancelled";
  }
  return "pending";
}

/**
 * @param {PlanItem[]} current
 * @param {unknown} input
 * @returns {PlanItem[]}
 */
export function applyPlanUpdate(current, input) {
  const obj = input && typeof input === "object" ? /** @type {Record<string, unknown>} */ (input) : {};
  const merge = obj.merge !== false;
  const rawItems = Array.isArray(obj.items)
    ? obj.items
    : Array.isArray(obj.todos)
      ? obj.todos
      : [];

  /** @type {PlanItem[]} */
  const incoming = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (item);
    const content = String(row.content || row.title || row.text || "").trim();
    if (!content) continue;
    incoming.push({
      id: String(row.id || crypto.randomUUID()),
      content,
      status: normalizePlanStatus(row.status),
    });
  }

  if (!merge || incoming.length === 0 && obj.replace === true) {
    return incoming;
  }
  if (incoming.length === 0) return current;

  const byId = new Map(current.map((item) => [item.id, { ...item }]));
  for (const item of incoming) {
    const prev = byId.get(item.id);
    if (prev) {
      byId.set(item.id, {
        ...prev,
        content: item.content || prev.content,
        status: item.status || prev.status,
      });
    } else {
      // Match by content when id is fresh
      const same = [...byId.values()].find(
        (p) => p.content === item.content && p.status !== "completed",
      );
      if (same && !rawItems.some((r) => r && typeof r === "object" && "id" in /** @type {object} */ (r))) {
        byId.set(same.id, { ...same, status: item.status });
      } else {
        byId.set(item.id, item);
      }
    }
  }
  return [...byId.values()];
}

/** @param {PlanItem[]} items */
export function formatPlanSummary(items) {
  if (items.length === 0) return "(empty plan)";
  return items
    .map((item, i) => `${i + 1}. [${item.status}] ${item.content}`)
    .join("\n");
}
