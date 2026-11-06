/**
 * Cleanup helper for any leftover child webview from earlier experiments.
 * We no longer embed remote sites as child webviews (they cover HTML chrome).
 */

import { Webview } from "@tauri-apps/api/webview";

export const EXT_HOST_LABEL = "ext-host";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Ensure no orphaned ext-host webview is painting over the IDE. */
export async function destroyExtHostWebview(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const existing = await Webview.getByLabel(EXT_HOST_LABEL);
    if (existing) await existing.close();
  } catch {
    /* none */
  }
}
