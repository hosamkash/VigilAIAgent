import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState, type ReactNode, type MouseEvent } from "react";
import { openAndRevealFile } from "../lib/open-workspace-file";
import { useEditorTabsStore } from "../store/editorTabsStore";
import { useExplorerStore } from "../store/explorerStore";

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? "").replace(/\n$/, "");
  const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative my-2 overflow-hidden rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--vigil-border-soft)] px-2 py-1 text-[10px] text-[var(--vigil-muted)]">
        <span>{lang || "code"}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded px-1.5 py-0.5 hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-2 font-mono text-[12px] leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function looksLikeWorkspacePath(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes("://") || t.includes(" ")) return false;
  if (!/[./\\]/.test(t)) return false;
  return /\.[A-Za-z0-9]{1,12}$/.test(t) || t.startsWith("src/") || t.startsWith("./");
}

function resolveClickPath(raw: string): string {
  const path = raw.trim().replace(/^`+|`+$/g, "");
  const root = useExplorerStore.getState().root?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return path;
  const norm = path.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[A-Za-z]:\//.test(norm)) return path;
  return `${root}/${norm.replace(/^\.\//, "")}`;
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="vigil-md text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url}
        components={{
          code({ className, children, ...props }) {
            const isBlock = Boolean(className) || String(children).includes("\n");
            const text = String(children ?? "").replace(/\n$/, "");
            if (!isBlock && looksLikeWorkspacePath(text)) {
              return (
                <button
                  type="button"
                  title={`Open ${text}`}
                  className="cursor-pointer rounded border-0 bg-[var(--vigil-hover)] px-1 py-0.5 font-mono text-[12px] text-[var(--vigil-accent)] underline"
                  onClick={(event: MouseEvent) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void openAndRevealFile(resolveClickPath(text));
                  }}
                >
                  {text}
                </button>
              );
            }
            if (!isBlock) {
              return (
                <code
                  className="rounded bg-[var(--vigil-hover)] px-1 py-0.5 font-mono text-[12px]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          a({ href, children }) {
            // Never open the system browser for chat file links.
            const label = String(children ?? href ?? "");
            if (href?.startsWith("vigil-file:") || looksLikeWorkspacePath(label)) {
              const path = href?.startsWith("vigil-file:")
                ? decodeURIComponent(
                    href.replace(/^vigil-file:\/\//, "").replace(/^vigil-file:/, ""),
                  )
                : resolveClickPath(label);
              return (
                <button
                  type="button"
                  title={`Open ${path}`}
                  className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[12px] text-[var(--vigil-accent)] underline"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void openAndRevealFile(path);
                  }}
                >
                  {children}
                </button>
              );
            }
            const web = href && /^https?:\/\//i.test(href) ? href : null;
            return (
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-[var(--vigil-accent)] underline"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (web) useEditorTabsStore.getState().openBrowser(web);
                }}
                title={web ? `Open in Vigil Browser: ${web}` : href}
              >
                {children}
              </button>
            );
          },
          ul({ children }) {
            return <ul className="my-1 list-disc pl-5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="my-1 list-decimal pl-5">{children}</ol>;
          },
          p({ children }) {
            return <p className="mb-2 last:mb-0">{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
