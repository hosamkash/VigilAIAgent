/** Structured editor diagnostics for the Problems panel (TS/JS first). */

export type EditorProblemSeverity = "error" | "warning" | "info" | "hint";

export type EditorProblem = {
  id: string;
  path: string;
  message: string;
  severity: EditorProblemSeverity;
  line: number;
  column: number;
  source?: string;
};

const TS_JS_EXT = /\.(tsx?|jsx?|mjs|cjs)$/i;

export function isTsJsPath(path: string): boolean {
  return TS_JS_EXT.test(path.replace(/\\/g, "/"));
}

export function formatEditorProblem(problem: EditorProblem): string {
  const where = `${problem.path}:${problem.line}:${problem.column}`;
  return `${problem.severity}: ${problem.message} (${where})`;
}

export function isWarningSeverity(severity: EditorProblemSeverity): boolean {
  return severity === "warning" || severity === "hint" || severity === "info";
}

/** Map Monaco MarkerSeverity (1=Hint … 8=Error) to our severity. */
export function monacoSeverityToProblem(
  severity: number,
): EditorProblemSeverity {
  if (severity >= 8) return "error";
  if (severity >= 4) return "warning";
  if (severity >= 2) return "info";
  return "hint";
}
