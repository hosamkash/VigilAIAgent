import { useEditorTabsStore } from "../../store/editorTabsStore";
import {
  isCloudEmbedHref,
  isVigilWebConfigured,
  vigilWebEmbedUrl,
} from "./vigil-web-url";

/** Open / focus the Vigil Cloud embed in its own browser tab (do not steal preview). */
export function openCloudEmbedTab(opts?: {
  focus?: boolean;
  nextPath?: string;
}): boolean {
  if (!isVigilWebConfigured()) return false;
  const url = vigilWebEmbedUrl(undefined, opts?.nextPath || "/app");
  if (!url) return false;
  const store = useEditorTabsStore.getState();
  const existing = store.tabs.find(
    (t) =>
      t.mode === "browser" &&
      isCloudEmbedHref(t.browser?.url || t.path || ""),
  );
  if (existing) {
    store.updateBrowserUrl(existing.id, url, "Vigil Cloud");
    if (opts?.focus !== false) store.setActive(existing.id);
    return true;
  }
  store.openBrowser(url, { reuse: "none", title: "Vigil Cloud" });
  return true;
}
