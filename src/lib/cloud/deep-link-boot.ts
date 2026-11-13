/**
 * Boot Continuum deep-link listener (vigil://continue?…).
 */

import { listen } from "@tauri-apps/api/event";
import { parseVigilDeepLink } from "./deep-link";

async function applyDeepLink(raw: string): Promise<void> {
  const parsed = parseVigilDeepLink(raw);
  if (!parsed) return;
  const { usePlanStore } = await import("../../store/planStore");
  await usePlanStore.getState().openPlan(parsed.planId);
  if (parsed.execute) {
    window.dispatchEvent(
      new CustomEvent("vigil:request-execute", {
        detail: { planId: parsed.planId },
      }),
    );
  }
}

/** Call once from App mount. Safe no-op outside Tauri. */
export async function bootVigilDeepLinks(): Promise<() => void> {
  const unsubs: Array<() => void> = [];

  try {
    const un = await listen<string>("vigil://deep-link", (ev) => {
      void applyDeepLink(String(ev.payload || ""));
    });
    unsubs.push(un);
  } catch {
    /* not in Tauri / event unavailable */
  }

  try {
    const deepLink = await import("@tauri-apps/plugin-deep-link");
    const current = await deepLink.getCurrent().catch(() => null);
    if (Array.isArray(current)) {
      for (const url of current) void applyDeepLink(String(url));
    }
    const un = await deepLink.onOpenUrl((urls) => {
      for (const url of urls) void applyDeepLink(String(url));
    });
    unsubs.push(un);
  } catch {
    /* plugin missing / browser preview */
  }

  return () => {
    for (const u of unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
  };
}
