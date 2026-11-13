/**
 * Plan Mode close-out helpers: auto-suggest, language, ops/danger labels.
 */

const PLAN_HINT =
  /\b(plan|refactor|migrate|multi[- ]?file|across (the )?codebase|step by step|implement (a |the )?(feature|system))\b|خطة|خطه|عدّل|عدل|نفّذ|نفذ|عدة ملفات|اكتر من ملف|أكثر من ملف|ريفكتور|ترحيل/i;

/** Large / multi-step work → suggest Plan mode when currently in Agent. */
export function shouldSuggestPlanMode(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 40) return false;
  if (PLAN_HINT.test(t)) return true;
  // Several sentences or bullet-ish lines
  const lines = t.split(/\n/).filter((l) => l.trim().length > 0);
  if (lines.length >= 4) return true;
  if ((t.match(/[.!?؟]/g) || []).length >= 3 && t.length > 120) return true;
  return false;
}

export function looksArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text || "");
}

/** Ops-flavored steps (tests / CI / PR). */
export function isOpsStepContent(content: string): boolean {
  return /\b(npm test|vitest|pytest|lint|ci\b|pull request|\bpr\b|push_and_check|create_pull_request|test gate)\b/i.test(
    content,
  );
}
