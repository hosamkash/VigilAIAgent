export interface RecentProject {
  path: string;
  name: string;
  openedAt: number;
}

const LAST_KEY = "vigil.workspace";
const RECENT_KEY = "vigil.recentProjects";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function projectName(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || path;
}

export function readLastWorkspace(): string | null {
  try {
    const value = localStorage.getItem(LAST_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function readRecentProjects(): RecentProject[] {
  const items = readJson<RecentProject[]>(RECENT_KEY, []);
  return Array.isArray(items) ? items : [];
}

export function clearLastWorkspace(): void {
  try {
    localStorage.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
}

export function clearRecentProjects(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* ignore */
  }
}

export function rememberProject(path: string): void {
  const name = projectName(path);
  const next: RecentProject = { path, name, openedAt: Date.now() };
  const recent = [
    next,
    ...readRecentProjects().filter((item) => item.path !== path),
  ].slice(0, 12);
  try {
    localStorage.setItem(LAST_KEY, path);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    /* ignore */
  }
}
