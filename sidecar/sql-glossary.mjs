/**
 * Support business glossary: Arabic/English term → table.column (local .vigil).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

function glossaryPath(cwd) {
  return path.join(cwd || process.cwd(), ".vigil", "glossary.json");
}

export function normalizeGlossaryQuery(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

export function matchGlossaryTerms(terms, query) {
  const q = normalizeGlossaryQuery(query);
  const list = Array.isArray(terms) ? terms : [];
  if (!q) return list.slice(0, 40);
  return list.filter((t) => {
    const blob = normalizeGlossaryQuery(
      `${t.ar || ""} ${t.en || ""} ${t.table || ""} ${t.column || ""} ${t.note || ""}`,
    );
    return blob.includes(q);
  });
}

export async function loadGlossary(cwd) {
  try {
    const raw = await fs.readFile(glossaryPath(cwd), "utf8");
    const data = JSON.parse(raw);
    const terms = Array.isArray(data?.terms) ? data.terms : [];
    return { ok: true, terms };
  } catch {
    return { ok: true, terms: [] };
  }
}

export async function saveGlossaryTerm(cwd, input = {}) {
  const ar = String(input.ar || input.term || "").trim();
  const en = String(input.en || "").trim();
  const table = String(input.table || "").trim();
  const column = String(input.column || "").trim();
  if (!ar && !en) {
    return { ok: false, error: "Need ar or en term." };
  }
  const loaded = await loadGlossary(cwd);
  const terms = loaded.terms.filter(
    (t) =>
      normalizeGlossaryQuery(t.ar) !== normalizeGlossaryQuery(ar) ||
      normalizeGlossaryQuery(t.en) !== normalizeGlossaryQuery(en),
  );
  terms.push({
    ar: ar || undefined,
    en: en || undefined,
    table: table || undefined,
    column: column || undefined,
    note: String(input.note || "").trim() || undefined,
  });
  const dir = path.dirname(glossaryPath(cwd));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    glossaryPath(cwd),
    `${JSON.stringify({ terms }, null, 2)}\n`,
    "utf8",
  );
  return { ok: true, terms };
}

export async function sql_glossary_search(cwd, query) {
  const { terms } = await loadGlossary(cwd);
  const hits = matchGlossaryTerms(terms, query);
  if (!hits.length) {
    return {
      ok: true,
      terms: [],
      output: "No glossary hits. Add terms with sql_glossary_save.",
    };
  }
  const lines = hits.map((t) => {
    const name = [t.ar, t.en].filter(Boolean).join(" / ");
    const loc = [t.table, t.column].filter(Boolean).join(".");
    return `- ${name}${loc ? ` → ${loc}` : ""}`;
  });
  return { ok: true, terms: hits, output: lines.join("\n") };
}
