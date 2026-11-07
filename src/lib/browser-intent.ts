/**
 * Detect when the user wants Vigil Browser opened — don't rely on the LLM
 * remembering to call browser_open (models often invent VS Code "Simple Browser: Show").
 */

const URL_RE = /https?:\/\/[^\s)\]>'"]+/gi;
const LOCAL_BARE_RE =
  /(?:localhost|127\.0\.0\.1)(?::\d{2,5})?(?:\/[^\s)\]>'"]*)?/gi;

// No `\b` after Arabic tokens — JS word boundaries don't work with Arabic letters.
const OPEN_HINT =
  /(?:افتح|فتح|افتحى|افتحي|شوّل|شغل|اعرض|عرض|وديني|ودّيني|(?:^|\s)(?:open|show|preview|launch|start)(?=\s|$))/i;
const BROWSER_HINT =
  /(?:browser|براوزر|متصفح|vigil\s*browser|simple\s*browser|معاينة|preview|localhost|127\.0\.0\.1|\/modules\/|أداة|اداة|صفحة|page|tool)/i;

/** True when the user message is mainly “open this URL” — safe to skip a full agent turn. */
export function isPureBrowserOpenRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 180) return false;
  const intent = detectBrowserOpenIntent(trimmed);
  if (!intent) return false;
  // Only skip the LLM when the target URL is already known (not a vague “open the tool”).
  if (intent.url === "project" && !/localhost|127\.0\.0\.1|project|المشروع|معاينة/i.test(trimmed)) {
    return false;
  }
  if (
    /(?:صلح|عدّل|عدل|اكتب|fix|implement|refactor|bug|error|خطأ|ملف|file|function)/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  return OPEN_HINT.test(trimmed);
}

export interface BrowserOpenIntent {
  url: string | "project";
  /** Extra instruction injected into the agent prompt for this turn. */
  forceToolNote: string;
}

function firstUrl(text: string): string | null {
  const http = text.match(URL_RE);
  if (http?.[0]) return http[0].replace(/[.,;]+$/, "");
  const local = text.match(LOCAL_BARE_RE);
  if (local?.[0]) {
    const raw = local[0].replace(/[.,;]+$/, "");
    return raw.includes("://") ? raw : `http://${raw}`;
  }
  return null;
}

export function detectBrowserOpenIntent(text: string): BrowserOpenIntent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const url = firstUrl(trimmed);
  const wantsOpen = OPEN_HINT.test(trimmed) && BROWSER_HINT.test(trimmed);
  const onlyLocal =
    /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d{2,5})?(?:\/\S*)?$/i.test(
      trimmed,
    );

  if (!wantsOpen && !onlyLocal && !url) return null;
  if (!wantsOpen && !onlyLocal && url && !BROWSER_HINT.test(trimmed)) {
    // Bare link without open/browser wording — still open if they paste localhost.
    if (!/localhost|127\.0\.0\.1/i.test(url)) return null;
  }

  const target = url ?? "project";
  const shown = target === "project" ? "the project preview URL" : target;
  return {
    url: target,
    forceToolNote:
      `Vigil IDE note (mandatory): The user asked to open Vigil Browser. ` +
      `You MUST call the browser_open tool with url ${JSON.stringify(target === "project" ? "project" : target)} ` +
      `in this turn. Do not mention Command Palette, Simple Browser: Show, Cmd+Shift+P, or Ctrl+Shift+P. ` +
      `Do not tell the user to open ${shown} manually — you open it.`,
  };
}

/** Pull http(s) / localhost URLs from agent reply text (for auto-open fallback). */
export function extractPreviewUrls(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.match(URL_RE) ?? []) {
    const clean = m.replace(/[.,;]+$/, "");
    if (/localhost|127\.0\.0\.1/i.test(clean) || /^https?:\/\//i.test(clean)) {
      found.add(clean);
    }
  }
  for (const m of text.match(LOCAL_BARE_RE) ?? []) {
    const raw = m.replace(/[.,;]+$/, "");
    found.add(raw.includes("://") ? raw : `http://${raw}`);
  }
  return [...found];
}
