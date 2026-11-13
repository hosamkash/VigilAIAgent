/** postMessage contract with Vigil Web embed (must match Vigil-AI-Agent-Web). */

export const VIGIL_BRIDGE_SOURCE = "vigil-desktop-bridge" as const;

export type VigilBridgeMessage =
  | { source: typeof VIGIL_BRIDGE_SOURCE; type: "vigil:auth-request" }
  | {
      source: typeof VIGIL_BRIDGE_SOURCE;
      type: "vigil:auth-handoff";
      idToken: string;
    }
  | {
      source: typeof VIGIL_BRIDGE_SOURCE;
      type: "vigil:session-ready";
      uid?: string;
    }
  | {
      source: typeof VIGIL_BRIDGE_SOURCE;
      type: "vigil:request-execute";
      planId: string;
    }
  | {
      source: typeof VIGIL_BRIDGE_SOURCE;
      type: "vigil:execution-status";
      planId: string;
      status: string;
    };

export function isVigilBridgeMessage(data: unknown): data is VigilBridgeMessage {
  if (!data || typeof data !== "object") return false;
  const m = data as Record<string, unknown>;
  return m.source === VIGIL_BRIDGE_SOURCE && typeof m.type === "string";
}

export function isVigilWebOrigin(origin: string, webBase: string): boolean {
  try {
    const a = new URL(origin);
    const b = new URL(webBase.includes("://") ? webBase : `https://${webBase}`);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}
