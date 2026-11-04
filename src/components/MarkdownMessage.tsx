import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState, type ReactNode } from "react";

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

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="vigil-md text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const isBlock = Boolean(className) || String(children).includes("\n");
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
            return (
              <a
                href={href}
                className="text-[var(--vigil-accent)] underline"
                target="_blank"
                rel="noreferrer"
              >
                {children}
              </a>
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
