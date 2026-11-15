import { getWorkspaceCwd } from "./secure-storage";
import { createDir, readTextFile, writeTextFile } from "./workspace-fs";
import { joinWorkspacePath } from "./support-ticket";

export type GlossaryTerm = {
  ar?: string;
  en?: string;
  table?: string;
  column?: string;
  note?: string;
};

const REL = ".vigil/glossary.json";

export function emptyGlossary(): GlossaryTerm[] {
  return [];
}

export async function loadSqlGlossary(): Promise<GlossaryTerm[]> {
  const root = await getWorkspaceCwd().catch(() => "");
  if (!root) return [];
  try {
    const raw = await readTextFile(joinWorkspacePath(root, REL));
    const data = JSON.parse(raw) as { terms?: GlossaryTerm[] };
    return Array.isArray(data.terms) ? data.terms : [];
  } catch {
    return [];
  }
}

export async function saveSqlGlossary(terms: GlossaryTerm[]): Promise<void> {
  const root = await getWorkspaceCwd();
  if (!root) throw new Error("No workspace open");
  await createDir(joinWorkspacePath(root, ".vigil")).catch(() => undefined);
  await writeTextFile(
    joinWorkspacePath(root, REL),
    `${JSON.stringify({ terms }, null, 2)}\n`,
  );
}
