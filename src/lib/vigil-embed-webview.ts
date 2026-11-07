/**
 * In-IDE Vigil Browser surface — a Tauri child Webview clipped to the editor panel.
 * Unlike an iframe, this is a real top-level document (no X-Frame-Options issues).
 * Unlike WebviewWindow, it stays inside the main Vigil window.
 */

import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "./embedded-site";

export const VIGIL_EMBED_LABEL = "vigil-embed";

export type EmbedBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

let currentUrl = "";
let visible = false;

function validBounds(b: EmbedBounds): boolean {
  return b.width >= 40 && b.height >= 40;
}

export async function destroyVigilEmbedWebview(): Promise<void> {
  currentUrl = "";
  visible = false;
  if (!isTauriRuntime()) return;
  try {
    const existing = await Webview.getByLabel(VIGIL_EMBED_LABEL);
    if (existing) await existing.close();
  } catch {
    /* none */
  }
}

async function ensureWebview(url: string, bounds: EmbedBounds): Promise<Webview | null> {
  if (!isTauriRuntime() || !validBounds(bounds)) return null;

  try {
    const existing = await Webview.getByLabel(VIGIL_EMBED_LABEL);
    if (existing) {
      if (currentUrl === url) {
        await existing.setPosition(new LogicalPosition(bounds.x, bounds.y));
        await existing.setSize(new LogicalSize(bounds.width, bounds.height));
        if (visible) await existing.show();
        return existing;
      }
      await existing.close();
    }
  } catch {
    /* create below */
  }

  const win = getCurrentWindow();
  const webview = new Webview(win, VIGIL_EMBED_LABEL, {
    url,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    focus: false,
  });

  // Don't block the UI long — show as soon as the webview is created.
  void webview.once("tauri://error", () => {
    currentUrl = "";
    visible = false;
  });

  currentUrl = url;
  return webview;
}

export async function showVigilEmbed(
  url: string,
  bounds: EmbedBounds,
): Promise<boolean> {
  const target = url.trim();
  if (!target || !/^https?:\/\//i.test(target)) return false;
  if (!isTauriRuntime()) return false;
  if (!validBounds(bounds)) return false;

  visible = true;
  try {
    const webview = await ensureWebview(target, bounds);
    if (!webview) return false;
    await webview.setPosition(new LogicalPosition(bounds.x, bounds.y));
    await webview.setSize(new LogicalSize(bounds.width, bounds.height));
    await webview.show();
    currentUrl = target;
    return true;
  } catch {
    visible = false;
    return false;
  }
}

export async function hideVigilEmbed(): Promise<void> {
  visible = false;
  if (!isTauriRuntime()) return;
  try {
    const existing = await Webview.getByLabel(VIGIL_EMBED_LABEL);
    if (existing) await existing.hide();
  } catch {
    /* none */
  }
}

export async function layoutVigilEmbed(bounds: EmbedBounds): Promise<void> {
  if (!visible || !isTauriRuntime() || !validBounds(bounds)) return;
  try {
    const existing = await Webview.getByLabel(VIGIL_EMBED_LABEL);
    if (!existing) return;
    await existing.setPosition(new LogicalPosition(bounds.x, bounds.y));
    await existing.setSize(new LogicalSize(bounds.width, bounds.height));
  } catch {
    /* ignore */
  }
}

export function readHostBounds(el: HTMLElement | null): EmbedBounds | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}
