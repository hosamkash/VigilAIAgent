import type { SecureFinding, SecureScanResult } from "./secure-sidecar";

export function buildSecureReportMarkdown(
  scan: SecureScanResult,
  lang: "en" | "ar" = "en",
): string {
  const ar = lang === "ar";
  const s = scan.summary || {
    total: scan.findings.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const when = scan.scannedAt
    ? new Date(scan.scannedAt).toISOString()
    : new Date().toISOString();
  const lines = [
    ar ? "# تقرير Vigil Secure" : "# Vigil Secure Report",
    "",
    ar
      ? "هذا تقرير مساعد دفاعي على هدف مصرّح به — ليس اختبار اختراق معتمد."
      : "Defensive assistant report on an authorized target — not a certified pentest.",
    "",
    `- ${ar ? "الهدف" : "Target"}: ${scan.target || "—"}`,
    `- ${ar ? "الحزمة" : "Pack"}: ${scan.pack || "—"}`,
    `- ${ar ? "التاريخ" : "When"}: ${when}`,
    `- ${ar ? "الإجمالي" : "Total"}: ${s.total} (critical=${s.critical} high=${s.high} medium=${s.medium} low=${s.low} info=${s.info})`,
    "",
    ar ? "## الملخص التنفيذي" : "## Executive summary",
    "",
    s.critical + s.high > 0
      ? ar
        ? `يوجد ${s.critical + s.high} إيجاد مرتفع/حرج. عالجها قبل النشر.`
        : `${s.critical + s.high} high/critical finding(s). Fix before production.`
      : ar
        ? "لا توجد إيجادات حرجة في هذه الحزمة."
        : "No critical/high findings in this pack.",
    "",
    ar ? "## الإيجادات" : "## Findings",
    "",
  ];
  for (const f of scan.findings) {
    lines.push(...findingMarkdown(f, ar), "");
  }
  lines.push(
    ar ? "## قائمة الإصلاح" : "## Fix checklist",
    "",
    ...scan.findings.map(
      (f, i) =>
        `- [ ] ${i + 1}. ${f.title}${f.education?.fixHint ? ` — ${f.education.fixHint}` : ""}`,
    ),
    "",
  );
  return lines.join("\n");
}

function findingMarkdown(f: SecureFinding, ar: boolean): string[] {
  const edu = ar ? f.educationAr || f.education : f.education;
  return [
    `### [${f.severity}] ${f.title}`,
    "",
    `- ${ar ? "التصنيف" : "Category"}: ${f.category}`,
    f.path ? `- Path: ${f.path}` : "",
    "",
    f.detail,
    "",
    edu?.what ? `**${ar ? "المعنى" : "What"}:** ${edu.what}` : "",
    edu?.why ? `**${ar ? "ليه يهم" : "Why"}:** ${edu.why}` : "",
    edu?.fixHint ? `**${ar ? "الإصلاح" : "Fix"}:** ${edu.fixHint}` : "",
    f.evidence ? `\n\`\`\`\n${f.evidence}\n\`\`\`` : "",
  ].filter((x) => x !== "");
}

export function buildSecureReportHtml(
  scan: SecureScanResult,
  lang: "en" | "ar" = "en",
): string {
  const md = buildSecureReportMarkdown(scan, lang);
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const dir = lang === "ar" ? "rtl" : "ltr";
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8"/>
  <title>Vigil Secure Report</title>
  <style>
    body { font-family: "Segoe UI", Tahoma, system-ui, sans-serif; margin: 32px; color: #111; }
    pre { white-space: pre-wrap; font-family: inherit; }
    h1 { font-size: 22px; }
    @media print { body { margin: 16px; } }
  </style>
</head>
<body>
  <pre>${escaped}</pre>
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script>
</body>
</html>`;
}

export function printSecureReportPdf(
  scan: SecureScanResult,
  lang: "en" | "ar" = "en",
): void {
  const html = buildSecureReportHtml(scan, lang);
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=800");
  if (!w) throw new Error("Pop-up blocked — allow pop-ups to save PDF.");
  w.document.open();
  w.document.write(html);
  w.document.close();
}
