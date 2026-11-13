import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  browserTabTitle,
  normalizeBrowserUrl,
} from "../lib/browser-url";
import { getCloudIdToken } from "../lib/cloud/auth";
import {
  isVigilBridgeMessage,
  isVigilWebOrigin,
  VIGIL_BRIDGE_SOURCE,
} from "../lib/cloud/desktop-bridge";
import { getConfiguredVigilWebUrl } from "../lib/cloud/vigil-web-url";
import { detectProjectPreviewUrl } from "../lib/project-url";
import { destroyVigilEmbedWebview } from "../lib/vigil-embed-webview";
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

/**
 * Vigil Browser — in-editor iframe preview only (Cursor Simple Browser style).
 * Never uses a child Webview (those paint over IDE chrome).
 * Separate OS window is opt-in via the Window button only.
 */
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
  const [frameKey, setFrameKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [projectHint, setProjectHint] = useState<string | null>(null);
  const historyRef = useRef<string[]>(initialUrl ? [initialUrl] : []);
  const indexRef = useRef(initialUrl ? 0 : -1);
  const urlRef = useRef(url);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  urlRef.current = url;

  useEffect(() => {
    async function replyAuthHandoff(targetOrigin: string) {
      const idToken = await getCloudIdToken(true);
      const frame = iframeRef.current?.contentWindow;
      if (!frame || !idToken) return;
      frame.postMessage(
        {
          source: VIGIL_BRIDGE_SOURCE,
          type: "vigil:auth-handoff",
          idToken,
        },
        targetOrigin,
      );
    }

    function onMessage(event: MessageEvent) {
      if (!isVigilBridgeMessage(event.data)) return;
      const webBase = getConfiguredVigilWebUrl();
      if (!webBase || !isVigilWebOrigin(event.origin, webBase)) return;

      if (event.data.type === "vigil:auth-request") {
        void replyAuthHandoff(event.origin);
        return;
      }

      if (event.data.type === "vigil:request-execute") {
        const planId = event.data.planId?.trim();
        if (!planId) return;
        window.dispatchEvent(
          new CustomEvent("vigil:request-execute", { detail: { planId } }),
        );
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Kill any leftover child-webview experiment that covers the chrome.
  useEffect(() => {
    void destroyVigilEmbedWebview();
  }, []);

  function applyNavigation(next: string, pushHistory: boolean, syncStore: boolean) {
    if (!next) return;
    setDraft(next);
    setUrl(next);
    setLoading(true);
    setFrameKey((k) => k + 1);
    if (syncStore) updateBrowserUrl(tabId, next, browserTabTitle(next));
    if (pushHistory) {
      const hist = historyRef.current.slice(0, indexRef.current + 1);
      if (hist[hist.length - 1] !== next) hist.push(next);
      historyRef.current = hist;
      indexRef.current = hist.length - 1;
    }
  }

  useEffect(() => {
    const next = (initialUrl || "").trim();
    setDraft(next);
    if (!next) {
      setUrl("");
      historyRef.current = [];
      indexRef.current = -1;
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
    setLoading(true);
    setFrameKey((k) => k + 1);
  }, [tabId, initialUrl]);

  useEffect(() => {
    let cancelled = false;
    void detectProjectPreviewUrl(root).then((hint) => {
      if (!cancelled) setProjectHint(hint);
    });
    return () => {
      cancelled = true;
    };
  }, [root]);

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
    setLoading(true);
    setFrameKey((k) => k + 1);
  }

  const canBack = indexRef.current > 0;
  const canForward = indexRef.current < historyRef.current.length - 1;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--vigil-editor)]">
      <div className="relative z-20 flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-2">
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
            placeholder="http://localhost:4300"
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
            onClick={() => navigate(projectHint)}
          >
            Project
          </button>
        )}
        <button
          type="button"
          className="shrink-0 rounded border border-[var(--vigil-border)] px-2 py-1 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
          title="Optional separate window"
          onClick={() => void syncVigilPreviewWindow(url || draft)}
        >
          Window
        </button>
        <button
          type="button"
          className="shrink-0 rounded border border-[var(--vigil-border)] p-1 text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
          title="System browser (optional)"
          onClick={() => void openExternal(url || draft)}
        >
          <ExternalLink size={13} />
        </button>
      </div>

      <div className="relative z-0 min-h-0 flex-1 overflow-hidden bg-[var(--vigil-editor)]">
        {!url && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Globe size={28} className="text-[var(--vigil-muted)]" />
            <div className="text-sm text-[var(--vigil-text)]">Vigil Browser</div>
            <p className="max-w-md text-[12px] text-[var(--vigil-muted)]">
              Preview inside the editor tab — no external browser.
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
          <iframe
            ref={iframeRef}
            key={`${url}::${frameKey}`}
            title="Vigil Browser"
            src={url}
            className="block h-full w-full border-0 bg-white"
            sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => {
              setLoading(false);
              const webBase = getConfiguredVigilWebUrl();
              if (!webBase || !url.includes("/embed/auth")) return;
              try {
                const origin = new URL(url).origin;
                void getCloudIdToken(true).then((idToken) => {
                  if (!idToken || !iframeRef.current?.contentWindow) return;
                  iframeRef.current.contentWindow.postMessage(
                    {
                      source: VIGIL_BRIDGE_SOURCE,
                      type: "vigil:auth-handoff",
                      idToken,
                    },
                    origin,
                  );
                });
              } catch {
                /* ignore */
              }
            }}
            onError={() => setLoading(false)}
          />
        )}
      </div>
    </div>
  );
}
