import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ExtensionTabMeta } from "../store/editorTabsStore";
import { useExtensionsStore } from "../store/extensionsStore";
import { findExtension, vsMarketplaceUrl } from "../lib/extensions-catalog";
import {
  fetchOpenVsxDetails,
  type OpenVsxDetails,
} from "../lib/extension-details";
import {
  destroyExtHostWebview,
  isTauriRuntime,
} from "../lib/embedded-site";

/**
 * Extension details rendered as normal HTML (never covers Install chrome).
 * Official marketplace pages block iframes; we load Open VSX API + README.
 * "Open website" opens a separate Tauri window with the real site.
 */
export function ExtensionDetailView({ meta }: { meta: ExtensionTabMeta }) {
  const isInstalled = useExtensionsStore((s) =>
    s.isInstalled(meta.extensionId),
  );
  const installingId = useExtensionsStore((s) => s.installingId);
  const install = useExtensionsStore((s) => s.install);
  const uninstall = useExtensionsStore((s) => s.uninstall);

  const catalog = findExtension(meta.extensionId);
  const busy = installingId === meta.extensionId;
  const marketplaceItem = catalog?.marketplaceItemName;
  const marketplace =
    marketplaceItem && vsMarketplaceUrl(marketplaceItem);

  const [details, setDetails] = useState<OpenVsxDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void destroyExtHostWebview();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setError(null);

    if (!marketplaceItem) return;

    setLoading(true);
    void fetchOpenVsxDetails(marketplaceItem)
      .then((d) => {
        if (!cancelled) setDetails(d);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [marketplaceItem]);

  async function openExternal(url: string) {
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async function openSiteWindow(url: string) {
    if (!isTauriRuntime()) {
      await openExternal(url);
      return;
    }
    const label = `ext-site-${meta.extensionId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40)}`;
    try {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.setFocus();
        return;
      }
    } catch {
      /* create new */
    }
    const win = new WebviewWindow(label, {
      url,
      title: meta.name,
      width: 960,
      height: 720,
      focus: true,
    });
    void win.once("tauri://error", () => {
      void openExternal(url);
    });
  }

  const title = details?.displayName || meta.name;
  const description = details?.description || catalog?.description || "";
  const officialUrl = details?.detailUrl || meta.detailUrl;
  const canOpenSite = /^https?:\/\//.test(officialUrl);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--vigil-editor)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--vigil-border)] bg-[var(--vigil-editor)] px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {details?.iconUrl ? (
            <img
              src={details.iconUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded"
            />
          ) : (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-sm font-bold text-white"
              style={{ background: "var(--vigil-accent)" }}
            >
              {(title[0] ?? "E").toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{title}</div>
            <div className="truncate text-[11px] text-[var(--vigil-muted)]">
              {meta.publisher}
              {details?.version ? ` · v${details.version}` : ""}
              {meta.builtin ? " · built-in" : ""}
            </div>
          </div>
        </div>

        {meta.builtin ? (
          <span className="rounded bg-[var(--vigil-accent-soft)] px-2 py-1 text-[11px] text-[var(--vigil-accent)]">
            Built-in
          </span>
        ) : busy ? (
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1.5 rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-[11px] font-medium text-white opacity-80"
          >
            <span className="ext-spinner" aria-hidden />
            {isInstalled ? "Uninstalling…" : "Installing…"}
          </button>
        ) : isInstalled ? (
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-[11px] font-medium hover:bg-[var(--vigil-hover)]"
            onClick={() => {
              const ext = findExtension(meta.extensionId);
              if (ext) void uninstall(ext);
            }}
          >
            Uninstall
          </button>
        ) : (
          <button
            type="button"
            className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-[11px] font-medium text-white"
            onClick={() => {
              const ext = findExtension(meta.extensionId);
              if (ext) void install(ext);
            }}
          >
            Install
          </button>
        )}

        {canOpenSite && (
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] px-2 py-1.5 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            onClick={() => void openSiteWindow(officialUrl)}
          >
            Open website
          </button>
        )}
        {marketplace && (
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] px-2 py-1.5 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-text)]"
            onClick={() => void openSiteWindow(marketplace)}
          >
            Marketplace
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-[var(--vigil-muted)]">
            <span
              className="ext-spinner"
              style={{
                borderColor: "rgba(0,120,212,0.25)",
                borderTopColor: "var(--vigil-accent)",
              }}
              aria-hidden
            />
            Loading extension details…
          </div>
        )}

        {error && (
          <div className="mb-3 rounded border border-[var(--vigil-danger)]/30 bg-[var(--vigil-danger)]/10 px-3 py-2 text-xs text-[var(--vigil-danger)]">
            {error}
          </div>
        )}

        {!loading && (
          <>
            {description && (
              <p className="mb-3 text-sm text-[var(--vigil-text)]">
                {description}
              </p>
            )}

            {(details?.downloadCount != null ||
              details?.license ||
              details?.publishedBy) && (
              <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-[var(--vigil-muted)]">
                {details.downloadCount != null && (
                  <span className="rounded border border-[var(--vigil-border)] px-2 py-0.5">
                    {details.downloadCount.toLocaleString()} downloads
                  </span>
                )}
                {details.license && (
                  <span className="rounded border border-[var(--vigil-border)] px-2 py-0.5">
                    {details.license}
                  </span>
                )}
                {details.publishedBy && (
                  <span className="rounded border border-[var(--vigil-border)] px-2 py-0.5">
                    by {details.publishedBy}
                  </span>
                )}
              </div>
            )}

            {details?.readmeMarkdown ? (
              <article className="ext-readme max-w-none text-[var(--vigil-text)]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {details.readmeMarkdown}
                </ReactMarkdown>
              </article>
            ) : (
              !marketplaceItem && (
                <div className="rounded border border-[var(--vigil-border)] p-3 text-sm text-[var(--vigil-muted)]">
                  <p>{description || "Built-in Vigil feature."}</p>
                  {canOpenSite && (
                    <button
                      type="button"
                      className="mt-2 text-[var(--vigil-accent)] underline"
                      onClick={() => void openSiteWindow(officialUrl)}
                    >
                      Open docs
                    </button>
                  )}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
