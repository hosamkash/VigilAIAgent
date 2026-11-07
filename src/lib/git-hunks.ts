export interface GitHunk {
  header: string;
  preview: string;
  patch: string;
}

/** Split a unified diff into one apply-able patch per hunk. */
export function splitUnifiedHunks(diff: string): GitHunk[] {
  const lines = diff.replace(/\r/g, "").split("\n");
  const fileHeader: string[] = [];
  const hunks: { header: string; body: string[] }[] = [];
  let current: { header: string; body: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (current) hunks.push(current);
      current = { header: line, body: [] };
      continue;
    }
    if (!current) {
      if (
        line.startsWith("diff --git ") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("new file") ||
        line.startsWith("deleted file")
      ) {
        fileHeader.push(line);
      }
      continue;
    }
    if (line === "") continue;
    current.body.push(line);
  }
  if (current) hunks.push(current);

  const header = fileHeader.filter(
    (line) =>
      line.startsWith("diff --git ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ "),
  );

  return hunks.map((hunk) => {
    const preview =
      hunk.body
        .find((line) => line.startsWith("+") || line.startsWith("-"))
        ?.slice(1)
        .trim() || hunk.header;
    const patch = [...header, hunk.header, ...hunk.body, ""].join("\n");
    return { header: hunk.header, preview, patch };
  });
}

export interface GitLogLine {
  hash: string;
  message: string;
}

export function parseOnelineLog(raw: string): GitLogLine[] {
  return raw
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(" ");
      if (space < 0) return { hash: line, message: "" };
      return { hash: line.slice(0, space), message: line.slice(space + 1) };
    });
}
