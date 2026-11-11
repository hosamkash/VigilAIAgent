import type { ChatPlanItem } from "../store/chatStore";

const STATUS_LABEL: Record<ChatPlanItem["status"], string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Done",
  cancelled: "Cancelled",
  failed: "Failed",
};

/** Live agent step plan for the Heavy Agent Loop. */
export function AgentPlanCard({ items }: { items: ChatPlanItem[] }) {
  if (items.length === 0) return null;
  const done = items.filter((i) => i.status === "completed").length;
  return (
    <div className="mt-2 rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold text-[var(--vigil-muted)]">
        <span>
          {items.some((i) => i.content.startsWith("Delegate:"))
            ? "Delegates"
            : "Plan"}
        </span>
        <span>
          {done}/{items.length}
        </span>
      </div>
      <ol className="space-y-1">
        {items.map((item, index) => {
          const active = item.status === "in_progress";
          const doneItem = item.status === "completed";
          const cancelled = item.status === "cancelled";
          const failed = item.status === "failed";
          return (
            <li
              key={item.id}
              className={`flex items-start gap-2 text-[12px] ${
                cancelled
                  ? "text-[var(--vigil-muted)] line-through"
                  : failed
                    ? "text-[var(--vigil-danger)]"
                    : doneItem
                      ? "text-[var(--vigil-muted)]"
                      : "text-[var(--vigil-text)]"
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] ${
                  active
                    ? "border-[var(--vigil-accent)] bg-[var(--vigil-accent-soft)] text-[var(--vigil-accent)]"
                    : doneItem
                      ? "border-emerald-500/50 text-emerald-500"
                      : failed
                        ? "border-[var(--vigil-danger)] text-[var(--vigil-danger)]"
                        : "border-[var(--vigil-border)] text-[var(--vigil-muted)]"
                }`}
                title={STATUS_LABEL[item.status]}
              >
                {doneItem ? "✓" : failed ? "!" : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={active ? "font-medium" : ""}>{item.content}</span>
                {active ? (
                  <span className="ml-1 text-[10px] text-[var(--vigil-accent)]">
                    · working
                  </span>
                ) : null}
                {failed ? (
                  <span className="ml-1 text-[10px] text-[var(--vigil-danger)]">
                    · failed
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
