/**
 * One reusable Vigil Browser OS window (real webview — not iframe).
 * Local apps often set X-Frame-Options; the in-panel iframe cannot show them,
 * so we keep this window in sync with every navigation.
 */

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauriRuntime } from "./embedded-site";
import { browserTabTitle } from "./browser-url";

/** Must match Tauri capability pattern `win-*`. */
export const VIGIL_PREVIEW_LABEL = "win-vigil-preview";

let lastUrl = "";

export async function syncVigilPreviewWindow(url: string): Promise<void> {
  const target = url.trim();
  if (!target || !/^https?:\/\//i.test(target)) return;

  if (!isTauriRuntime()) {
    window.open(target, "vigil-preview", "noopener,noreferrer");
    lastUrl = target;
    return;
  }

  try {
    const existing = await WebviewWindow.getByLabel(VIGIL_PREVIEW_LABEL);
    if (existing) {
      if (lastUrl === target) {
        await existing.setFocus();
        return;
      }
      // Tauri WebviewWindow has no navigate() — recreate with the new URL.
      await existing.close();
      await new Promise((r) => setTimeout(r, 40));
    }
  } catch {
    /* create below */
  }

  lastUrl = target;
  const win = new WebviewWindow(VIGIL_PREVIEW_LABEL, {
    url: target,
    title: `Vigil Browser — ${browserTabTitle(target)}`,
    width: 1100,
    height: 800,
    focus: true,
  });
  void win.once("tauri://error", () => {
    lastUrl = "";
  });
}
