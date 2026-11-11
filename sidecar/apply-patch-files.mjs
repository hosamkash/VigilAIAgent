/**
 * Extract file paths from a Cline / GPT-style apply_patch body.
 * Supports multi-file patches (Add / Update / Delete / Move).
 */

const PATH_MARKERS = [
  "*** Add File: ",
  "*** Update File: ",
  "*** Delete File: ",
  "*** Move to: ",
];

/**
 * @param {string} patchText
 * @returns {string[]} relative (or absolute) paths in patch order, de-duped
 */
export function extractPatchPaths(patchText) {
  const text = String(patchText || "");
  const paths = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    for (const marker of PATH_MARKERS) {
      if (!line.startsWith(marker)) continue;
      const p = line.slice(marker.length).trim();
      if (!p || seen.has(p)) continue;
      seen.add(p);
      paths.push(p);
    }
  }
  return paths;
}

/**
 * Pull the freeform patch body out of common apply_patch input shapes.
 * @param {unknown} input
 */
export function extractPatchText(input) {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";
  const obj = /** @type {Record<string, unknown>} */ (input);
  for (const key of ["patch", "diff", "input", "content", "patchText"]) {
    const v = obj[key];
    if (typeof v === "string" && v.includes("***")) return v;
  }
  // Nested input wrapper
  if (obj.input && typeof obj.input === "object") {
    return extractPatchText(obj.input);
  }
  return "";
}
