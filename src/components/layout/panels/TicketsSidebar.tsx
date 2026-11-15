import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import {
  KeyRound,
  LayoutDashboard,
  ListTodo,
  TicketPlus,
} from "lucide-react";
import {
  TICKET_PLATFORMS,
  type TicketPlatformId,
} from "../../../lib/ticket-platforms";
import { openTicketsHub } from "../../../lib/open-tickets-hub";
import { useSupportTicketStore } from "../../../store/supportTicketStore";
import {
  useTicketPlatformStore,
  type TicketsHubPane,
} from "../../../store/ticketPlatformStore";

function stopAnd(e: MouseEvent, fn: () => void): void {
  e.stopPropagation();
  fn();
}

export function TicketsSidebar() {
  const recent = useSupportTicketStore((s) => s.recentTickets);
  const active = useSupportTicketStore((s) => s.activeTicket);
  const refreshList = useSupportTicketStore((s) => s.refreshList);
  const createDraft = useSupportTicketStore((s) => s.createDraft);
  const openTicket = useSupportTicketStore((s) => s.openTicket);
  const archiveTicket = useSupportTicketStore((s) => s.archiveTicket);
  const platformId = useTicketPlatformStore((s) => s.platformId);
  const hubPane = useTicketPlatformStore((s) => s.hubPane);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  function openPlatform(id: TicketPlatformId, pane: TicketsHubPane = "overview") {
    openTicketsHub(id, pane);
  }

  const q = filter.trim().toLowerCase();
  const list = recent.filter((t) => {
    if (!q) return true;
    return `${t.title} ${t.type} ${t.status}`.toLowerCase().includes(q);
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-[var(--vigil-border)] px-2 py-2 pr-12">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-orange-600">
          Tickets
        </div>
        <p className="mt-0.5 text-[10px] leading-snug text-[var(--vigil-muted)]">
          المنصات على اليسار — الشغل والاتصال في الوسط
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--vigil-accent)] px-2 py-1.5 text-[11px] !text-white"
          onClick={() => void createDraft()}
        >
          <TicketPlus className="h-3.5 w-3.5" aria-hidden />
          New draft
        </button>

        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
            Platforms
          </div>
          <div className="space-y-0.5">
            {TICKET_PLATFORMS.map((p) => {
              const selected = platformId === p.id;
              const soon = p.status !== "ready";
              return (
                <div
                  key={p.id}
                  className={`flex items-start gap-1 rounded-md border px-1.5 py-1.5 ${
                    selected
                      ? "border-orange-500/40 bg-orange-500/10"
                      : "border-transparent hover:bg-[var(--vigil-hover)]"
                  }`}
                >
                  <button
                    type="button"
                    title={p.hint}
                    onClick={() => openPlatform(p.id, "overview")}
                    className="min-w-0 flex-1 px-0.5 text-start"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-medium">
                        {p.label}
                      </span>
                      <span className="shrink-0 text-[9px] uppercase text-[var(--vigil-muted)]">
                        {soon ? "soon" : "ready"}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-[var(--vigil-muted)]">
                      {p.hint}
                    </span>
                  </button>
                  <div className="flex shrink-0 flex-col gap-0.5 pt-0.5">
                    <IconAction
                      title="Open workspace"
                      labelAr="فتح"
                      active={selected && hubPane === "overview"}
                      onClick={(e) =>
                        stopAnd(e, () => openPlatform(p.id, "overview"))
                      }
                    >
                      <LayoutDashboard className="h-3 w-3" aria-hidden />
                    </IconAction>
                    <IconAction
                      title="Connect / login"
                      labelAr="اتصال"
                      active={selected && hubPane === "connect"}
                      onClick={(e) =>
                        stopAnd(e, () => openPlatform(p.id, "connect"))
                      }
                    >
                      <KeyRound className="h-3 w-3" aria-hidden />
                    </IconAction>
                    <IconAction
                      title="Drafts"
                      labelAr="مسودات"
                      active={selected && hubPane === "drafts"}
                      onClick={(e) =>
                        stopAnd(e, () => openPlatform(p.id, "drafts"))
                      }
                    >
                      <ListTodo className="h-3 w-3" aria-hidden />
                    </IconAction>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
            Recent drafts ({list.length})
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="mb-1.5 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-[11px]"
          />
          {list.length === 0 ? (
            <p className="px-1 text-[10px] text-[var(--vigil-muted)]">
              Ask chat for a ticket, or New draft.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {list.map((item) => (
                <li key={item.id}>
                  <div
                    className={`flex items-start gap-1 rounded px-1.5 py-1 ${
                      active?.id === item.id
                        ? "bg-[var(--vigil-accent-soft)]"
                        : "hover:bg-[var(--vigil-hover)]"
                    }`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-start"
                      onClick={() => void openTicket(item.id)}
                    >
                      <div className="truncate text-[11px] font-medium">
                        {item.title || "(untitled)"}
                      </div>
                      <div className="text-[10px] text-[var(--vigil-muted)]">
                        {item.status} · {item.type}
                        {item.adoWorkItemId ? ` · #${item.adoWorkItemId}` : ""}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-[var(--vigil-muted)] hover:text-[var(--vigil-danger)]"
                      onClick={() => void archiveTicket(item.id)}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function IconAction({
  title,
  labelAr,
  active,
  onClick,
  children,
}: {
  title: string;
  labelAr: string;
  active?: boolean;
  onClick: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={`${title} · ${labelAr}`}
      aria-label={`${title} · ${labelAr}`}
      onClick={onClick}
      className={`inline-flex h-5 w-5 items-center justify-center rounded ${
        active
          ? "bg-orange-500/25 text-orange-600"
          : "text-[var(--vigil-muted)] hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
      }`}
    >
      {children}
    </button>
  );
}
