import {
  isVigilWebOrigin,
  VIGIL_BRIDGE_SOURCE,
  type VigilBridgeMessage,
} from "./desktop-bridge";
import { getConfiguredVigilWebUrl } from "./vigil-web-url";

function vigilWebTargetOrigin(): string | null {
  const webBase = getConfiguredVigilWebUrl();
  if (!webBase) return null;
  try {
    return new URL(
      webBase.includes("://") ? webBase : `https://${webBase}`,
    ).origin;
  } catch {
    return null;
  }
}

/** postMessage to Vigil Web iframes (Cloud Bridge). */
export function postToVigilWebIframes(
  payload: VigilBridgeMessage,
): void {
  if (typeof window === "undefined") return;
  const webBase = getConfiguredVigilWebUrl();
  const targetOrigin = vigilWebTargetOrigin();
  if (!webBase || !targetOrigin) return;

  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    try {
      const src = frame.getAttribute("src") || "";
      if (
        !src ||
        !isVigilWebOrigin(new URL(src, window.location.href).origin, webBase)
      ) {
        continue;
      }
      frame.contentWindow?.postMessage(payload, targetOrigin);
    } catch {
      /* cross-origin src parse / detached */
    }
  }
}

/** Notify Vigil Web iframes of plan execution status (Cloud Bridge). */
export function postPlanExecutionStatus(
  planId: string,
  status: string,
  progress?: { done?: number; total?: number },
): void {
  if (!planId) return;
  postToVigilWebIframes({
    source: VIGIL_BRIDGE_SOURCE,
    type: "vigil:execution-status",
    planId,
    status,
    ...(typeof progress?.done === "number" ? { done: progress.done } : {}),
    ...(typeof progress?.total === "number" ? { total: progress.total } : {}),
  });
}

/** Notify embed that a plan draft/approve changed (Cloud Bridge). */
export function postPlanUpdated(planId: string, status?: string): void {
  if (!planId) return;
  postToVigilWebIframes({
    source: VIGIL_BRIDGE_SOURCE,
    type: "vigil:plan-updated",
    planId,
    ...(status ? { status } : {}),
  });
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
