import type { SecureFinding } from "./secure-sidecar";
import type { SupportTicket } from "./support-ticket";

export function ticketDraftFromSecureFinding(
  finding: SecureFinding,
  scan?: { target?: string; pack?: string },
): Partial<SupportTicket> {
  const evidence = [finding.category, finding.path, finding.evidence]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  return {
    title: `[Secure] ${finding.title}`.slice(0, 140),
    type: "Bug",
    summary: finding.detail || finding.title,
    environment: [
      scan?.target ? `Target: ${scan.target}` : "",
      scan?.pack ? `Pack: ${scan.pack}` : "",
      finding.severity ? `Severity: ${finding.severity}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    evidence,
    suspectedArea: finding.path,
    acceptanceCriteria: [
      "Retest the same Secure check after the fix",
      "Residual risk documented if the finding cannot be fully cleared",
    ],
  };
}
