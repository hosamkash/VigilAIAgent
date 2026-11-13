import {
  isVigilWebOrigin,
  VIGIL_BRIDGE_SOURCE,
} from "./desktop-bridge";
import { getConfiguredVigilWebUrl } from "./vigil-web-url";

/** Notify Vigil Web iframes of plan execution status (Cloud Bridge). */
export function postPlanExecutionStatus(
  planId: string,
  status: string,
): void {
  if (typeof window === "undefined") return;
  const webBase = getConfiguredVigilWebUrl();
  if (!webBase || !planId) return;
  let targetOrigin: string;
  try {
    targetOrigin = new URL(
      webBase.includes("://") ? webBase : `https://${webBase}`,
    ).origin;
  } catch {
    return;
  }

  const payload = {
    source: VIGIL_BRIDGE_SOURCE,
    type: "vigil:execution-status" as const,
    planId,
    status,
  };

  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    try {
      const src = frame.getAttribute("src") || "";
      if (!src || !isVigilWebOrigin(new URL(src, window.location.href).origin, webBase)) {
        continue;
      }
      frame.contentWindow?.postMessage(payload, targetOrigin);
    } catch {
      /* cross-origin src parse / detached */
    }
  }
}

/**
 * Also ensure Firestore plan.status is fresh for phone/web pollers.
 * Local persistActive already pushes; this is a best-effort nudge.
 */
export async function mirrorExecutionStatusToCloud(
  planId: string,
  status: string,
): Promise<void> {
  try {
    const { useCloudAuthStore } = await import("../../store/cloudAuthStore");
    const { usePlanStore } = await import("../../store/planStore");
    const uid = useCloudAuthStore.getState().user?.uid;
    const plan = usePlanStore.getState().activePlan;
    if (!uid || !plan || plan.id !== planId) return;
    const { pushPlanToCloud } = await import("./plans-sync");
    await pushPlanToCloud({ ...plan, status: status as typeof plan.status }, uid);
  } catch {
    /* offline */
  }
}
