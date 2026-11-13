import { useEffect, useState } from "react";
import type {
  SupportTicketPriority,
  SupportTicketSeverity,
  SupportTicketType,
} from "../lib/support-ticket";
import { looksArabic } from "../lib/plan-mode-heuristics";
import { publishSupportTicketToAdo } from "../lib/ado-settings";
import { useSupportTicketStore } from "../store/supportTicketStore";
import { useEditorTabsStore } from "../store/editorTabsStore";

const TYPES: SupportTicketType[] = ["Bug", "Task", "User Story", "Spike"];
const PRIORITIES: SupportTicketPriority[] = ["P0", "P1", "P2", "P3"];
const SEVERITIES: SupportTicketSeverity[] = ["Sev1", "Sev2", "Sev3", "Sev4"];

function linesToText(items?: string[]): string {
  return (items || []).join("\n");
}

function textToLines(value: string): string[] {
  return value
    .split(/\n+/)
    .map((s) => s.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter(Boolean);
}

/** Editable Support ticket composer (draft → ready; ADO later). */
export function SupportTicketPanel() {
  const ticket = useSupportTicketStore((s) => s.activeTicket);
  const panelOpen = useSupportTicketStore((s) => s.panelOpen);
  const recent = useSupportTicketStore((s) => s.recentTickets);
  const updateActive = useSupportTicketStore((s) => s.updateActive);
  const persistActive = useSupportTicketStore((s) => s.persistActive);
  const markReady = useSupportTicketStore((s) => s.markReady);
  const copyActiveMarkdown = useSupportTicketStore((s) => s.copyActiveMarkdown);
  const setPanelOpen = useSupportTicketStore((s) => s.setPanelOpen);
  const createDraft = useSupportTicketStore((s) => s.createDraft);
  const refreshList = useSupportTicketStore((s) => s.refreshList);
  const openTicket = useSupportTicketStore((s) => s.openTicket);
  const archiveTicket = useSupportTicketStore((s) => s.archiveTicket);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    void refreshList();
  }, [refreshList, panelOpen]);

  if (!panelOpen && !ticket) return null;

  const ar = looksArabic(`${ticket?.title || ""} ${ticket?.summary || ""}`);
  const t = {
    title: ar ? "تيكت الدعم" : "Support ticket",
    newDraft: ar ? "مسودة جديدة" : "New draft",
    save: ar ? "حفظ" : "Save",
    ready: ar ? "جاهز للنشر" : "Mark ready",
    copy: ar ? "نسخ Markdown" : "Copy Markdown",
    close: ar ? "إغلاق" : "Close",
    history: ar ? "السجل" : "History",
    publish: ar ? "نشر إلى Azure DevOps" : "Publish to Azure DevOps",
  };

  return (
    <div className="mb-3 rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-3 text-xs text-[var(--vigil-text)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--vigil-muted)]">
            {t.title}
          </span>
          {ticket ? (
            <span className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] text-[var(--vigil-muted)]">
              {ticket.status}
              {ticket.adoWorkItemId ? ` · #${ticket.adoWorkItemId}` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)]"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            {t.history}
          </button>
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)]"
            onClick={() => void createDraft()}
          >
            {t.newDraft}
          </button>
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] px-2 py-1 hover:bg-[var(--vigil-hover)]"
            onClick={() => setPanelOpen(false)}
          >
            {t.close}
          </button>
        </div>
      </div>

      {historyOpen ? (
        <div className="mb-3 max-h-36 overflow-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-2">
          {recent.length === 0 ? (
            <p className="text-[var(--vigil-muted)]">No tickets yet.</p>
          ) : (
            <ul className="space-y-1">
              {recent.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-start hover:underline"
                    onClick={() => void openTicket(item.id)}
                  >
                    [{item.status}] {item.type} — {item.title}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 text-[10px] text-[var(--vigil-muted)] hover:underline"
                    onClick={() => void archiveTicket(item.id)}
                  >
                    archive
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {!ticket ? (
        <p className="text-[var(--vigil-muted)]">
          {ar
            ? "اطلب من الوكيل تيكت، أو ابدأ مسودة جديدة."
            : "Ask the agent for a ticket, or start a new draft."}
        </p>
      ) : (
        <div className="space-y-2">
          <label className="block">
            <span className="text-[10px] text-[var(--vigil-muted)]">Title</span>
            <input
              className="mt-0.5 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
              value={ticket.title}
              onChange={(e) => updateActive({ title: e.target.value })}
            />
          </label>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="text-[10px] text-[var(--vigil-muted)]">Type</span>
              <select
                className="mt-0.5 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
                value={ticket.type}
                onChange={(e) =>
                  updateActive({ type: e.target.value as SupportTicketType })
                }
              >
                {TYPES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] text-[var(--vigil-muted)]">Priority</span>
              <select
                className="mt-0.5 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
                value={ticket.priority || ""}
                onChange={(e) =>
                  updateActive({
                    priority: (e.target.value || undefined) as
                      | SupportTicketPriority
                      | undefined,
                  })
                }
              >
                <option value="">—</option>
                {PRIORITIES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] text-[var(--vigil-muted)]">Severity</span>
              <select
                className="mt-0.5 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
                value={ticket.severity || ""}
                onChange={(e) =>
                  updateActive({
                    severity: (e.target.value || undefined) as
                      | SupportTicketSeverity
                      | undefined,
                  })
                }
              >
                <option value="">—</option>
                {SEVERITIES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] text-[var(--vigil-muted)]">Connection</span>
              <input
                className="mt-0.5 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
                value={ticket.connectionLabel || ""}
                onChange={(e) =>
                  updateActive({ connectionLabel: e.target.value || undefined })
                }
                placeholder="UAT"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] text-[var(--vigil-muted)]">Summary</span>
            <textarea
              className="mt-0.5 min-h-[56px] w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
              value={ticket.summary}
              onChange={(e) => updateActive({ summary: e.target.value })}
            />
          </label>

          <label className="block">
            <span className="text-[10px] text-[var(--vigil-muted)]">
              Business / user impact
            </span>
            <textarea
              className="mt-0.5 min-h-[40px] w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
              value={ticket.businessImpact || ""}
              onChange={(e) =>
                updateActive({ businessImpact: e.target.value || undefined })
              }
            />
          </label>

          <label className="block">
            <span className="text-[10px] text-[var(--vigil-muted)]">Environment</span>
            <textarea
              className="mt-0.5 min-h-[40px] w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
              value={ticket.environment || ""}
              onChange={(e) =>
                updateActive({ environment: e.target.value || undefined })
              }
            />
          </label>

          <label className="block">
            <span className="text-[10px] text-[var(--vigil-muted)]">
              Steps to reproduce (one per line)
            </span>
            <textarea
              className="mt-0.5 min-h-[64px] w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1 font-mono text-[11px]"
              value={linesToText(ticket.stepsToReproduce)}
              onChange={(e) =>
                updateActive({
                  stepsToReproduce: textToLines(e.target.value),
                })
              }
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[10px] text-[var(--vigil-muted)]">Expected</span>
              <textarea
                className="mt-0.5 min-h-[48px] w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
                value={ticket.expected || ""}
                onChange={(e) =>
                  updateActive({ expected: e.target.value || undefined })
                }
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-[var(--vigil-muted)]">Actual</span>
              <textarea
                className="mt-0.5 min-h-[48px] w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
                value={ticket.actual || ""}
                onChange={(e) =>
                  updateActive({ actual: e.target.value || undefined })
                }
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] text-[var(--vigil-muted)]">
              Evidence (queries / objects / errors — no secrets)
            </span>
            <textarea
              className="mt-0.5 min-h-[56px] w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1 font-mono text-[11px]"
              value={linesToText(ticket.evidence)}
              onChange={(e) =>
                updateActive({ evidence: textToLines(e.target.value) })
              }
            />
          </label>

          <label className="block">
            <span className="text-[10px] text-[var(--vigil-muted)]">Suspected area</span>
            <input
              className="mt-0.5 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
              value={ticket.suspectedArea || ""}
              onChange={(e) =>
                updateActive({ suspectedArea: e.target.value || undefined })
              }
            />
          </label>

          <label className="block">
            <span className="text-[10px] text-[var(--vigil-muted)]">
              Acceptance criteria (one per line)
            </span>
            <textarea
              className="mt-0.5 min-h-[56px] w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
              value={linesToText(ticket.acceptanceCriteria)}
              onChange={(e) =>
                updateActive({
                  acceptanceCriteria: textToLines(e.target.value),
                })
              }
            />
          </label>

          <label className="block">
            <span className="text-[10px] text-[var(--vigil-muted)]">
              Out of scope / notes
            </span>
            <textarea
              className="mt-0.5 min-h-[40px] w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1"
              value={ticket.outOfScope || ""}
              onChange={(e) =>
                updateActive({ outOfScope: e.target.value || undefined })
              }
            />
          </label>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-[11px] !text-white"
              onClick={() => {
                void persistActive().then(() => setNote(ar ? "اتحفظ" : "Saved"));
              }}
            >
              {t.save}
            </button>
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] px-3 py-1.5 hover:bg-[var(--vigil-hover)]"
              onClick={() => void markReady()}
            >
              {t.ready}
            </button>
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] px-3 py-1.5 hover:bg-[var(--vigil-hover)]"
              onClick={() => {
                void copyActiveMarkdown().then((md) => {
                  if (md) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                });
              }}
            >
              {copied ? (ar ? "اتنسخ" : "Copied") : t.copy}
            </button>
            <button
              type="button"
              disabled={publishing}
              className="rounded border border-[var(--vigil-border)] px-3 py-1.5 hover:bg-[var(--vigil-hover)] disabled:opacity-50"
              onClick={() => {
                if (!ticket) return;
                setPublishing(true);
                setNote(null);
                void (async () => {
                  try {
                    await persistActive();
                    const latest =
                      useSupportTicketStore.getState().activeTicket || ticket;
                    const result = await publishSupportTicketToAdo(latest);
                    useSupportTicketStore.getState().updateActive({
                      status: "published",
                      adoWorkItemId: result.id,
                      adoUrl: result.url,
                    });
                    await persistActive();
                    setNote(
                      ar
                        ? `اتنشر #${result.id}`
                        : `Published #${result.id}`,
                    );
                    try {
                      useEditorTabsStore.getState().openBrowser(result.url);
                    } catch {
                      /* optional */
                    }
                  } catch (err) {
                    setNote(String(err));
                  } finally {
                    setPublishing(false);
                  }
                })();
              }}
            >
              {publishing
                ? ar
                  ? "بيتنشر…"
                  : "Publishing…"
                : t.publish}
            </button>
            {note ? (
              <span className="text-[10px] text-[var(--vigil-muted)]">{note}</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
