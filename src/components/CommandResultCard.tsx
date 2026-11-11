import type { ChatCommandResult } from "../store/chatStore";

/** Compact shell result card for the agent test→fix loop. */
export function CommandResultCard({
  results,
}: {
  results: ChatCommandResult[];
}) {
  if (results.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {results.map((result, index) => {
        const ok = result.exitCode === 0;
        return (
          <div
            key={`${result.command}-${index}`}
            className={`rounded border px-2 py-1.5 ${
              ok
                ? "border-[var(--vigil-border)] bg-[var(--vigil-bg)]"
                : "border-rose-500/40 bg-rose-500/10"
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
              <span
                className={`font-semibold ${
                  ok ? "text-[var(--vigil-muted)]" : "text-rose-400"
                }`}
              >
                Command finished · exit {result.exitCode}
              </span>
              <code className="min-w-0 truncate font-mono text-[10px] text-[var(--vigil-text)]">
                {result.command}
              </code>
            </div>
            {result.excerpt ? (
              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--vigil-muted)]">
                {result.excerpt}
              </pre>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
