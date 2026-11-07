export function languageLabel(path: string, language: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const byExt: Record<string, string> = {
    tsx: "TypeScript JSX",
    jsx: "JavaScript JSX",
    ts: "TypeScript",
    js: "JavaScript",
    mjs: "JavaScript",
    cjs: "JavaScript",
    json: "JSON",
    md: "Markdown",
    rs: "Rust",
    css: "CSS",
    html: "HTML",
    py: "Python",
    toml: "TOML",
    yml: "YAML",
    yaml: "YAML",
    sh: "Shell Script",
    txt: "Plain Text",
  };
  if (byExt[ext]) return byExt[ext];
  if (!language || language === "plaintext") return "Plain Text";
  return language.charAt(0).toUpperCase() + language.slice(1);
}

/** Saved tabs over open tabs, in the same x/y (%) shape as Cursor's tab stats. */
export function tabStats(total: number, saved: number): string {
  if (total <= 0) return "Tab Stats: 0/0 (0%)";
  const pct = Math.round((saved / total) * 100);
  return `Tab Stats: ${saved}/${total} (${pct}%)`;
}

export function agentStats(inputTokens: number, outputTokens: number): string {
  const used = Math.max(0, inputTokens) + Math.max(0, outputTokens);
  return `Agent Stats: ${used.toLocaleString("en-US")} tokens`;
}

export function isWarningProblem(message: string): boolean {
  return /\bwarn(ing)?\b/i.test(message) && !/\berror\b/i.test(message);
}
