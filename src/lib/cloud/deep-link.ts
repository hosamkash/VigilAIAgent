/**
 * Cloud Bridge deep links: vigil://continue?planId=…&execute=1
 */

export type VigilDeepLink = {
  planId: string;
  execute: boolean;
};

export function buildVigilContinueUrl(
  planId: string,
  opts?: { execute?: boolean },
): string {
  const id = planId.trim();
  if (!id) return "";
  const u = new URL("vigil://continue");
  u.searchParams.set("planId", id);
  if (opts?.execute) u.searchParams.set("execute", "1");
  return u.toString();
}

export function parseVigilDeepLink(raw: string): VigilDeepLink | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== "vigil:") return null;
    const host = (u.hostname || u.host || "").toLowerCase();
    let planId = u.searchParams.get("planId")?.trim() || "";
    if (!planId && (host === "plan" || host === "plans")) {
      planId = u.pathname.replace(/^\/+/, "").trim();
    }
    if (!planId && host === "continue") {
      planId = u.searchParams.get("planId")?.trim() || "";
    }
    if (!planId) return null;
    const executeRaw = (u.searchParams.get("execute") || "").toLowerCase();
    const execute =
      executeRaw === "1" ||
      executeRaw === "true" ||
      executeRaw === "yes";
    return { planId, execute };
  } catch {
    return null;
  }
}
