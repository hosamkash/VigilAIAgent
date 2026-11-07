import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  browserTabTitle,
  normalizeBrowserUrl,
} from "../lib/browser-url";
import { isTauriRuntime } from "../lib/embedded-site";
import { detectProjectPreviewUrl } from "../lib/project-url";
import {
  destroyVigilEmbedWebview,
  hideVigilEmbed,
  layoutVigilEmbed,
  readHostBounds,
  showVigilEmbed,
} from "../lib/vigil-embed-webview";
import { syncVigilPreviewWindow } from "../lib/vigil-preview-window";
import { useEditorTabsStore } from "../store/editorTabsStore";
import { useExplorerStore } from "../store/explorerStore";

async function openExternal(url: string) {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function BrowserView({
  tabId,
  initialUrl,
}: {
  tabId: string;
  initialUrl: string;
}) {
  const updateBrowserUrl = useEditorTabsStore((s) => s.updateBrowserUrl);
  const root = useExplorerStore((s) => s.root);
  const [draft, setDraft] = useState(initialUrl);
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [projectHint, setProjectHint] = useState<string | null>(null);
  const [embedOk, setEmbedOk] = useState(true);
  const hostRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<string[]>(initialUrl ? [initialUrl] : []);
  const indexRef = useRef(initialUrl ? 0 : -1);
  const urlRef = useRef(url);
  urlRef.current = url;

  async function paintEmbed(nextUrl: string) {
    if (!nextUrl) return;
    setLoading(true);
    if (!isTauriRuntime()) {
      setEmbedOk(true);
      setLoading(false);
      return;
    }
    // Host may still be laying out on first paint — retry briefly.
    let bounds = readHostBounds(hostRef.current);
    for (let i = 0; i < 8 && (!bounds || bounds.width < 40 || bounds.height < 40); i++) {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      bounds = readHostBounds(hostRef.current);
    }
    if (!bounds) {
      setEmbedOk(false);
      setLoading(false);
      return;
    }
    const ok = await showVigilEmbed(nextUrl, bounds);
    setEmbedOk(ok);
    setLoading(false);
  }

  function applyNavigation(next: string, pushHistory: boolean, syncStore: boolean) {
    if (!next) return;
    setDraft(next);
    setUrl(next);
    setLoading(true);
    if (syncStore) updateBrowserUrl(tabId, next, browserTabTitle(next));
    if (pushHistory) {
      const hist = historyRef.current.slice(0, indexRef.current + 1);
      if (hist[hist.length - 1] !== next) hist.push(next);
      historyRef.current = hist;
      indexRef.current = hist.length - 1;
    }
    void paintEmbed(next);
  }

  // Agent / openBrowser updates the store URL — navigate in-panel immediately.
  useEffect(() => {
    const next = (initialUrl || "").trim();
    setDraft(next);
    if (!next) {
      setUrl("");
      historyRef.current = [];
      indexRef.current = -1;
      void hideVigilEmbed();
      return;
    }
    if (next !== urlRef.current) {
      const hist = historyRef.current;
      if (hist[hist.length - 1] !== next) {
        historyRef.current = [...hist.slice(0, indexRef.current + 1), next];
        indexRef.current = historyRef.current.length - 1;
      }
      setUrl(next);
    }
    void paintEmbed(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, initialUrl]);

  // Keep the child webview aligned with the panel (resize / splitters).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const syncLayout = () => {
      const bounds = readHostBounds(host);
      if (bounds) void layoutVigilEmbed(bounds);
    };

    const ro = new ResizeObserver(syncLayout);
    ro.observe(host);
    window.addEventListener("resize", syncLayout);
    // Allotment / layout drag
    const id = window.setInterval(syncLayout, 500);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncLayout);
      window.clearInterval(id);
    };
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    void detectProjectPreviewUrl(root).then((hint) => {
      if (!cancelled) setProjectHint(hint);
    });
    return () => {
      cancelled = true;
    };
  }, [root]);

  // Hide/destroy embed when leaving this view.
  useEffect(() => {
    return () => {
      void hideVigilEmbed();
    };
  }, []);

  useEffect(() => {
    return () => {
      void destroyVigilEmbedWebview();
    };
  }, [tabId]);

  function navigate(raw: string, pushHistory = true) {
    const next = normalizeBrowserUrl(raw);
    if (!next) return;
    applyNavigation(next, pushHistory, true);
  }

  function goBack() {
    if (indexRef.current <= 0) return;
    indexRef.current -= 1;
    const prev = historyRef.current[indexRef.current];
    if (prev) applyNavigation(prev, false, true);
  }

  function goForward() {
    if (indexRef.current >= historyRef.current.length - 1) return;
    indexRef.current += 1;
    const next = historyRef.current[indexRef.current];
    if (next) applyNavigation(next, false, true);
  }

  function reload() {
    if (!url) return;
    void paintEmbed(url);
  }

  const canBack = indexRef.current > 0;
  const canForward = indexRef.current < historyRef.current.length - 1;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--vigil-editor)]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2 py-1.5">
        <button
          type="button"
          className="rounded p-1 text-[var(--vigil-muted)] hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)] disabled:opacity-30"
          disabled={!canBack}
          onClick={goBack}
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          className="rounded p-1 text-[var(--vigil-muted)] hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)] disabled:opacity-30"
          disabled={!canForward}
          onClick={goForward}
          title="Forward"
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          className="rounded p-1 text-[var(--vigil-muted)] hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
          onClick={reload}
          title="Reload"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>

        <form
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(draft);
          }}
        >
          <Globe size={13} className="shrink-0 text-[var(--vigil-muted)]" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Enter URL (e.g. http://localhost:3000)"
            className="min-w-0 flex-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-editor)] px-2 py-1 text-[12px] text-[var(--vigil-text)] outline-none focus:border-[var(--vigil-accent)]"
            spellCheck={false}
          />
          <button
            type="submit"
            className="rounded bg-[var(--vigil-accent)] px-2.5 py-1 text-[11px] font-medium text-white"
          >
            Go
          </button>
        </form>

        {projectHint && (
          <button
            type="button"
            className="shrink-0 rounded border border-[var(--vigil-border)] px-2 py-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            title={`Open detected project URL (${projectHint})`}
            onClick={() => navigate(projectHint)}
          >
            Project
          </button>
        )}
        <button
          type="button"
          className="shrink-0 rounded border border-[var(--vigil-border)] px-2 py-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
          title="Optional: open in a separate Vigil window"
          onClick={() => void syncVigilPreviewWindow(url || draft)}
        >
          Window
        </button>
        <button
          type="button"
          className="shrink-0 rounded border border-[var(--vigil-border)] p-1 text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
          title="Open in system browser"
          onClick={() => void openExternal(url || draft)}
        >
          <ExternalLink size={13} />
        </button>
      </div>

      {!url && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Globe size={28} className="text-[var(--vigil-muted)]" />
          <div className="text-sm text-[var(--vigil-text)]">Vigil Browser</div>
          <p className="max-w-md text-[12px] text-[var(--vigil-muted)]">
            In-editor preview (like Cursor). Ask the agent to open a URL — it loads here
            inside Vigil, not in an external window.
          </p>
          {projectHint && (
            <button
              type="button"
              className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-[12px] font-medium text-white"
              onClick={() => navigate(projectHint)}
            >
              Open {projectHint}
            </button>
          )}
        </div>
      )}

      {url && (
        <div ref={hostRef} className="relative min-h-0 flex-1 bg-[var(--vigil-editor)]">
          {/* Host for the native child webview. iframe is only a non-Tauri fallback. */}
          {!isTauriRuntime() && (
            <iframe
              title="Vigil Browser"
              src={url}
              className="h-full w-full border-0 bg-white"
              sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads"
            />
          )}
          {isTauriRuntime() && !embedOk && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-[var(--vigil-text)]">
                Could not attach the in-editor preview webview.
              </p>
              <button
                type="button"
                className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-[12px] font-medium text-white"
                onClick={() => void paintEmbed(url)}
              >
                Retry
              </button>
              <button
                type="button"
                className="text-[12px] text-[var(--vigil-accent)] underline"
                onClick={() => void syncVigilPreviewWindow(url)}
              >
                Open in separate window instead
              </button>
            </div>
          )}
          {isTauriRuntime() && embedOk && loading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-[var(--vigil-muted)]">
              Loading…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
