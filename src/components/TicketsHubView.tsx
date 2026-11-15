import { useEffect, useState } from "react";
import {
  KeyRound,
  ListTodo,
  LayoutDashboard,
  TicketPlus,
} from "lucide-react";
import { TicketConnectCard } from "./TicketConnectCard";
import {
  ticketPlatformById,
  type TicketPlatformId,
} from "../lib/ticket-platforms";
import { hasAdoPat, loadAdoSettings } from "../lib/ado-settings";
import { hasTicketPat } from "../lib/ticket-vault";
import {
  useTicketPlatformStore,
  type TicketsHubPane,
} from "../store/ticketPlatformStore";
import { useSupportTicketStore } from "../store/supportTicketStore";
import { useEditorTabsStore } from "../store/editorTabsStore";

const PANES: { id: TicketsHubPane; label: string; labelAr: string; Icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", labelAr: "نظرة عامة", Icon: LayoutDashboard },
  { id: "connect", label: "Connect", labelAr: "اتصال", Icon: KeyRound },
  { id: "drafts", label: "Drafts", labelAr: "مسودات", Icon: ListTodo },
];

/** Full-page Tickets workspace for one publish platform. */
export function TicketsHubView({
  platformId,
  pane,
  tabId,
}: {
  platformId: TicketPlatformId;
  pane: TicketsHubPane;
  tabId: string;
}) {
  const platform = ticketPlatformById(platformId);
  const setPlatformId = useTicketPlatformStore((s) => s.setPlatformId);
  const setHubPane = useTicketPlatformStore((s) => s.setHubPane);
  const updateTicketsHubPane = useEditorTabsStore((s) => s.updateTicketsHubPane);
  const recent = useSupportTicketStore((s) => s.recentTickets);
  const active = useSupportTicketStore((s) => s.activeTicket);
  const refreshList = useSupportTicketStore((s) => s.refreshList);
  const createDraft = useSupportTicketStore((s) => s.createDraft);
  const openTicket = useSupportTicketStore((s) => s.openTicket);
  const archiveTicket = useSupportTicketStore((s) => s.archiveTicket);
  const [filter, setFilter] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    setPlatformId(platformId);
    setHubPane(pane);
  }, [platformId, pane, setPlatformId, setHubPane]);

  useEffect(() => {
    void refreshList();
  }, [refreshList, pane]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (platformId === "azure-devops") {
          const [settings, pat] = await Promise.all([
            loadAdoSettings(),
            hasAdoPat(),
          ]);
          if (!cancelled) {
            setConnected(
              Boolean(settings.organization && settings.project && pat),
            );
          }
          return;
        }
        const pat = await hasTicketPat(platformId);
        if (!cancelled) setConnected(pat);
      } catch {
        if (!cancelled) setConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platformId, pane]);

  function selectPane(next: TicketsHubPane) {
    setHubPane(next);
    updateTicketsHubPane(tabId, next);
  }

  const q = filter.trim().toLowerCase();
  const list = recent.filter((t) => {
    if (!q) return true;
    return `${t.title} ${t.type} ${t.status}`.toLowerCase().includes(q);
  });

  const ready = platform.status === "ready";
  const statusLabel =
    connected === true
      ? "Connected"
      : connected === false
        ? "Not connected"
        : ready
          ? "Ready"
          : "Coming soon";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--vigil-panel)] text-[var(--vigil-text)]">
      <header className="shrink-0 border-b border-[var(--vigil-border)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-orange-600">
              Tickets
            </div>
            <h1 className="mt-1 text-lg font-semibold tracking-tight">
              {platform.label}
            </h1>
            <p className="mt-1 max-w-xl text-xs text-[var(--vigil-muted)]">
              {platform.hint}
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium uppercase ${
              statusLabel === "Connected"
                ? "bg-emerald-500/15 text-emerald-600"
                : statusLabel === "Ready"
                  ? "bg-orange-500/15 text-orange-600"
                  : statusLabel === "Coming soon"
                    ? "bg-[var(--vigil-hover)] text-[var(--vigil-muted)]"
                    : "bg-amber-500/15 text-amber-700"
            }`}
          >
            {statusLabel}
          </span>
        </div>

        <nav className="mt-4 flex flex-wrap gap-1" aria-label="Tickets panes">
          {PANES.map(({ id, label, labelAr, Icon }) => {
            const activePane = pane === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectPane(id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs ${
                  activePane
                    ? "bg-[var(--vigil-accent)] !text-white"
                    : "border border-[var(--vigil-border)] hover:bg-[var(--vigil-hover)]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span>{label}</span>
                <span className="opacity-70">· {labelAr}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {pane === "overview" ? (
          <div className="mx-auto max-w-2xl space-y-4">
            <p className="text-sm leading-relaxed text-[var(--vigil-muted)]">
              اكتب المسودة في Vigil، راجعها مع الشات أو من هنا، وبعدين انشرها على{" "}
              {platform.label}. الربط والإعدادات في تبويب Connect — الشغل اليومي
              في Drafts.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => selectPane("connect")}
                className="rounded-lg border border-[var(--vigil-border)] px-4 py-3 text-start hover:bg-[var(--vigil-hover)]"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="h-4 w-4 text-orange-600" aria-hidden />
                  Connect / Settings
                </div>
                <p className="mt-1 text-xs text-[var(--vigil-muted)]">
                  {ready
                    ? "Organization / project / token for publish."
                    : "Login for this platform lands in a later slice."}
                </p>
              </button>
              <button
                type="button"
                onClick={() => selectPane("drafts")}
                className="rounded-lg border border-[var(--vigil-border)] px-4 py-3 text-start hover:bg-[var(--vigil-hover)]"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ListTodo className="h-4 w-4 text-orange-600" aria-hidden />
                  Drafts & publish
                </div>
                <p className="mt-1 text-xs text-[var(--vigil-muted)]">
                  Open local drafts, edit, mark ready, publish.
                </p>
              </button>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--vigil-accent)] px-3 py-2 text-xs !text-white"
              onClick={() => void createDraft()}
            >
              <TicketPlus className="h-3.5 w-3.5" aria-hidden />
              New draft
            </button>
          </div>
        ) : null}

        {pane === "connect" ? (
          <div className="mx-auto max-w-xl space-y-3">
            <TicketConnectCard platformId={platformId} />
          </div>
        ) : null}

        {pane === "drafts" ? (
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--vigil-accent)] px-3 py-1.5 text-xs !text-white"
                onClick={() => void createDraft()}
              >
                <TicketPlus className="h-3.5 w-3.5" aria-hidden />
                New draft
              </button>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter drafts…"
                className="min-w-[12rem] flex-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1.5 text-xs"
              />
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-[var(--vigil-muted)]">
                مفيش مسودات. New draft أو اطلب من الشات تيكت دعم.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--vigil-border)] rounded-lg border border-[var(--vigil-border)]">
                {list.map((item) => (
                  <li
                    key={item.id}
                    className={`flex items-start gap-2 px-3 py-2 ${
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
                      <div className="truncate text-sm font-medium">
                        {item.title || "(untitled)"}
                      </div>
                      <div className="text-[11px] text-[var(--vigil-muted)]">
                        {item.status} · {item.type}
                        {item.adoWorkItemId
                          ? ` · ADO #${item.adoWorkItemId}`
                          : ""}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 text-[11px] text-[var(--vigil-muted)] hover:text-[var(--vigil-danger)]"
                      onClick={() => void archiveTicket(item.id)}
                      title="Archive"
                    >
                      Archive
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
