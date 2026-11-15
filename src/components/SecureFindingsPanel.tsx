import { useMemo, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useSecureStore } from "../store/secureStore";
import type { SecureFinding } from "../lib/secure-sidecar";
import {
  buildSecureReportMarkdown,
  printSecureReportPdf,
} from "../lib/secure-report";
import { writeTextFile } from "../lib/workspace-fs";
import {
  isLocalSecureTarget,
  resolveSecureEntitlement,
} from "../lib/secure-entitlement";
import { useCloudAuthStore } from "../store/cloudAuthStore";
import { useChatStore } from "../store/chatStore";

const SEV_COLOR: Record<string, string> = {
  critical: "var(--vigil-danger)",
  high: "var(--vigil-danger)",
  medium: "#c27803",
  low: "var(--vigil-muted)",
  info: "var(--vigil-muted)",
};

function FindingRow({
  f,
  active,
  onSelect,
}: {
  f: SecureFinding;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`block w-full rounded border px-2 py-1.5 text-left text-[11px] ${
        active
          ? "border-[var(--vigil-accent)] bg-[var(--vigil-accent-soft)]/40"
          : "border-[var(--vigil-border)] hover:bg-[var(--vigil-hover)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1 text-[9px] font-semibold uppercase"
          style={{ color: SEV_COLOR[f.severity] || undefined }}
        >
          {f.severity}
        </span>
        <span className="truncate font-medium text-[var(--vigil-text)]">
          {f.title}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[10px] text-[var(--vigil-muted)]">
        {f.category}
        {f.path ? ` · ${f.path}` : ""}
      </div>
    </button>
  );
}

export function SecureFindingsPanel() {
  const panelOpen = useSecureStore((s) => s.panelOpen);
  const setPanelOpen = useSecureStore((s) => s.setPanelOpen);
  const lastScan = useSecureStore((s) => s.lastScan);
  const selected = useSecureStore((s) => s.selectedFinding);
  const setSelectedFinding = useSecureStore((s) => s.setSelectedFinding);
  const busy = useSecureStore((s) => s.busy);
  const retestLast = useSecureStore((s) => s.retestLast);
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [filter, setFilter] = useState("");
  const billing = useCloudAuthStore((s) => s.billing);
  const signedIn = !!useCloudAuthStore((s) => s.user);
  const reportEntitlement = resolveSecureEntitlement({
    planTier: billing?.planTier,
    entitlements: billing?.entitlements,
    signedIn,
    localTarget: isLocalSecureTarget(lastScan?.target),
  });

  const findings = useMemo(() => {
    const list = lastScan?.findings || [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q) ||
        f.detail.toLowerCase().includes(q),
    );
  }, [lastScan, filter]);

  if (!panelOpen) return null;

  const edu =
    lang === "ar" ? selected?.educationAr || selected?.education : selected?.education;

  return (
    <div className="mb-3 overflow-hidden rounded border border-[var(--vigil-border)] bg-[var(--vigil-panel)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--vigil-border)] px-3 py-2">
        <div>
          <div className="text-xs font-semibold text-[var(--vigil-text)]">
            Vigil Secure — Findings
          </div>
          <div className="text-[10px] text-[var(--vigil-muted)]">
            {lastScan?.target
              ? `Target: ${lastScan.target}`
              : "Run Quick / Active from the Run sidebar"}
            {lastScan?.pack ? ` · ${lastScan.pack}` : ""}
            {lastScan?.summary
              ? ` · ${lastScan.summary.total} finding(s)`
              : ""}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!lastScan?.findings?.length || !reportEntitlement.report}
            title={
              reportEntitlement.report
                ? "Print / Save as PDF"
                : reportEntitlement.reason
            }
            className="rounded border border-[var(--vigil-border)] px-2 py-1 text-[10px] hover:bg-[var(--vigil-hover)] disabled:opacity-50"
            onClick={() => {
              if (!lastScan) return;
              printSecureReportPdf(lastScan, lang);
            }}
          >
            PDF
          </button>
          <button
            type="button"
            disabled={!lastScan?.findings?.length}
            className="rounded border border-[var(--vigil-border)] px-2 py-1 text-[10px] hover:bg-[var(--vigil-hover)] disabled:opacity-50"
            onClick={() => {
              if (!lastScan) return;
              void (async () => {
                const md = buildSecureReportMarkdown(lastScan, lang);
                const dest = await saveDialog({
                  defaultPath: "vigil-secure-report.md",
                  filters: [{ name: "Markdown", extensions: ["md"] }],
                });
                if (typeof dest === "string" && dest) {
                  await writeTextFile(dest, md);
                }
              })();
            }}
          >
            MD
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded border border-[var(--vigil-border)] px-2 py-1 text-[10px] hover:bg-[var(--vigil-hover)] disabled:opacity-50"
            onClick={() => void retestLast()}
          >
            Retest
          </button>
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] px-2 py-1 text-[10px] hover:bg-[var(--vigil-hover)]"
            onClick={() => setPanelOpen(false)}
          >
            Close
          </button>
        </div>
      </div>

      <div className="grid max-h-[420px] grid-cols-1 gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-1 overflow-auto border-b border-[var(--vigil-border)] p-2 md:border-b-0 md:border-r">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter findings…"
            className="mb-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-[11px]"
          />
          {findings.length === 0 ? (
            <div className="p-2 text-[11px] text-[var(--vigil-muted)]">
              No findings yet. Use «Quick scan» / «اختبر أمان الصفحة».
            </div>
          ) : (
            findings.map((f) => (
              <FindingRow
                key={f.id}
                f={f}
                active={selected?.id === f.id}
                onSelect={() => setSelectedFinding(f)}
              />
            ))
          )}
        </div>

        <div className="overflow-auto p-3 text-[11px]" dir={lang === "ar" ? "rtl" : "ltr"}>
          <div className="mb-2 flex gap-1">
            <button
              type="button"
              className={`rounded px-2 py-0.5 text-[10px] ${
                lang === "en"
                  ? "bg-[var(--vigil-accent)] !text-white"
                  : "border border-[var(--vigil-border)]"
              }`}
              onClick={() => setLang("en")}
            >
              EN
            </button>
            <button
              type="button"
              className={`rounded px-2 py-0.5 text-[10px] ${
                lang === "ar"
                  ? "bg-[var(--vigil-accent)] !text-white"
                  : "border border-[var(--vigil-border)]"
              }`}
              onClick={() => setLang("ar")}
            >
              عربي
            </button>
          </div>
          {!selected ? (
            <div className="text-[var(--vigil-muted)]">Select a finding.</div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-[var(--vigil-text)]">
                {edu?.title || selected.title}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
                  {lang === "ar" ? "إيه دي؟" : "What"}
                </div>
                <p>{edu?.what || selected.detail}</p>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
                  {lang === "ar" ? "ليه مهمة؟" : "Why it matters"}
                </div>
                <p>{edu?.why}</p>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
                  {lang === "ar" ? "إزاي تصلّح؟" : "How to fix"}
                </div>
                <p>{edu?.fixHint}</p>
              </div>
              {selected.evidence && (
                <pre className="overflow-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-2 font-mono text-[10px]">
                  {selected.evidence}
                </pre>
              )}
              {lastScan?.screenshotBase64 ? (
                <div>
                  <div className="text-[10px] font-semibold uppercase text-[var(--vigil-muted)]">
                    {lang === "ar" ? "دليل المتصفح" : "Browser evidence"}
                  </div>
                  <img
                    alt="Secure scan screenshot"
                    className="mt-1 max-h-40 w-full rounded border border-[var(--vigil-border)] object-contain"
                    src={`data:image/png;base64,${lastScan.screenshotBase64}`}
                  />
                  {lastScan.screenshotUrl ? (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--vigil-muted)]">
                      {lastScan.screenshotUrl}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {selected.path && (
                <div className="font-mono text-[10px] text-[var(--vigil-muted)]">
                  {selected.path}
                </div>
              )}
              <button
                type="button"
                className="rounded border border-[var(--vigil-border)] px-2 py-1 text-[10px] hover:bg-[var(--vigil-hover)]"
                onClick={() => {
                  void import("../lib/ticket-from-finding").then(
                    ({ ticketDraftFromSecureFinding }) => {
                      const draft = ticketDraftFromSecureFinding(selected, {
                        target: lastScan?.target,
                        pack: lastScan?.pack,
                      });
                      void import("../store/supportTicketStore").then(({ useSupportTicketStore }) =>
                        useSupportTicketStore.getState().createDraft(draft),
                      );
                    },
                  );
                }}
              >
                {lang === "ar" ? "تيكت دعم" : "Support ticket"}
              </button>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-[10px] !text-white"
                  onClick={() => {
                    const prompt = [
                      "Fix this Vigil Secure finding in the workspace, then retest.",
                      `Target: ${lastScan?.target || ""}`,
                      `Finding: ${selected.title} (${selected.severity} / ${selected.category})`,
                      selected.detail,
                      selected.path ? `Path: ${selected.path}` : "",
                      selected.education?.fixHint
                        ? `Hint: ${selected.education.fixHint}`
                        : "",
                      "Prefer headers/validation patches. Do not weaponize. After the patch, run the same Secure scan pack.",
                    ]
                      .filter(Boolean)
                      .join("\n");
                    useChatStore.getState().queueAgentPrompt(prompt);
                  }}
                >
                  {lang === "ar" ? "صلّح في المشروع" : "Fix in project"}
                </button>
              </div>
              <p className="text-[10px] text-[var(--vigil-muted)]">
                {lang === "ar"
                  ? "صلّح يفتح الشات بإصلاح ثم Retest من اللوحة."
                  : "Fix queues the agent; use Retest after the patch."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
