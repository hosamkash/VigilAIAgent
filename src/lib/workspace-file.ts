export function parseWorkspaceFolders(text: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object") return [];
  const folders = (data as { folders?: unknown }).folders;
  if (!Array.isArray(folders)) return [];
  const paths: string[] = [];
  for (const entry of folders) {
    if (!entry || typeof entry !== "object") continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path === "string" && path.trim()) paths.push(path.trim());
  }
  return paths;
}

export function serializeWorkspace(folders: string[]): string {
  return `${JSON.stringify(
    { folders: folders.map((path) => ({ path })) },
    null,
    2,
  )}\n`;
}
