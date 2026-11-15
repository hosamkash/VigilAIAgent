/**
 * Cloud Bridge deep links:
 * - vigil://continue?planId=…&execute=1
 * - vigil://chat?chatId=…
 */

export type VigilDeepLink = {
  kind: "plan" | "chat" | "open";
  planId?: string;
  chatId?: string;
  path?: string;
  execute: boolean;
};

export function buildVigilOpenFolderUrl(folderPath: string): string {
  const p = folderPath.trim();
  if (!p) return "";
  const u = new URL("vigil://open");
  u.searchParams.set("path", p);
  return u.toString();
}

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

export function buildVigilChatUrl(chatId: string): string {
  const id = chatId.trim();
  if (!id) return "";
  const u = new URL("vigil://chat");
  u.searchParams.set("chatId", id);
  return u.toString();
}

export function parseVigilDeepLink(raw: string): VigilDeepLink | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== "vigil:") return null;
    const host = (u.hostname || u.host || "").toLowerCase();

    if (host === "open") {
      const path =
        u.searchParams.get("path")?.trim() ||
        u.searchParams.get("folder")?.trim() ||
        u.searchParams.get("dir")?.trim() ||
        "";
      if (!path) return null;
      return { kind: "open", path, execute: false };
    }

    // vigil://chat?chatId=…  or vigil://chats/<id>
    if (host === "chat" || host === "chats") {
      let chatId = u.searchParams.get("chatId")?.trim() || "";
      if (!chatId) chatId = u.pathname.replace(/^\/+/, "").trim();
      if (!chatId) return null;
      return { kind: "chat", chatId, execute: false };
    }

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
    return { kind: "plan", planId, execute };
  } catch {
    return null;
  }
}
