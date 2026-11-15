import { create } from "zustand";
import {
  makeScmRepo,
  normalizeRepoPath,
  type ScmRepoRecord,
} from "../lib/scm-repo";

const STORAGE_KEY = "vigil.scm.repos.v1";

type Persisted = {
  repos: Array<Pick<ScmRepoRecord, "rootPath" | "displayName" | "commitDraft">>;
  activeRepoId: string | null;
};

const memoryPersist: Persisted = { repos: [], activeRepoId: null };

function loadPersisted(): Persisted {
  try {
    if (typeof localStorage === "undefined") return { ...memoryPersist };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { repos: [], activeRepoId: null };
    const data = JSON.parse(raw) as Persisted;
    return {
      repos: Array.isArray(data.repos) ? data.repos : [],
      activeRepoId: data.activeRepoId || null,
    };
  } catch {
    return { repos: [], activeRepoId: null };
  }
}

function savePersisted(state: {
  repos: ScmRepoRecord[];
  activeRepoId: string | null;
}) {
  const payload: Persisted = {
    activeRepoId: state.activeRepoId,
    repos: state.repos.map((r) => ({
      rootPath: r.rootPath,
      displayName: r.displayName,
      commitDraft: r.commitDraft,
    })),
  };
  memoryPersist.repos = payload.repos;
  memoryPersist.activeRepoId = payload.activeRepoId;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

type ScmReposState = {
  repos: ScmRepoRecord[];
  activeRepoId: string | null;
  hydrated: boolean;
  hydrate: () => void;
  syncFromWorkspace: (
    workspaceRoot: string | null,
    extraRoots?: string[],
  ) => void;
  addRepoPath: (rootPath: string) => ScmRepoRecord | null;
  removeRepo: (id: string) => void;
  setActive: (id: string) => void;
  setCommitDraft: (id: string, draft: string) => void;
  patchRepo: (id: string, patch: Partial<ScmRepoRecord>) => void;
};

function mergeUnique(
  existing: ScmRepoRecord[],
  incoming: ScmRepoRecord[],
): ScmRepoRecord[] {
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const r of incoming) {
    const prev = byId.get(r.id);
    byId.set(r.id, prev ? { ...r, commitDraft: prev.commitDraft, ...{ changeCount: prev.changeCount, branch: prev.branch } } : r);
  }
  return [...byId.values()];
}

export const useScmReposStore = create<ScmReposState>((set, get) => ({
  repos: [],
  activeRepoId: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const persisted = loadPersisted();
    const repos = persisted.repos
      .map((r) => makeScmRepo(r.rootPath, { displayName: r.displayName, commitDraft: r.commitDraft }))
      .filter((r) => r.rootPath);
    set({
      repos,
      activeRepoId: persisted.activeRepoId,
      hydrated: true,
    });
  },

  syncFromWorkspace: (workspaceRoot, extraRoots = []) => {
    get().hydrate();
    const primaryPath = normalizeRepoPath(workspaceRoot || "");
    if (!primaryPath) {
      set({ repos: get().repos.filter((r) => !r.isPrimary) });
      return;
    }
    const extras = extraRoots.map((p) => makeScmRepo(p));
    const primary = makeScmRepo(primaryPath, { isPrimary: true });
    const persistedExtras = get().repos.filter(
      (r) => r.rootPath !== primaryPath && !r.isPrimary,
    );
    const next = mergeUnique(
      [primary, ...persistedExtras, ...extras],
      [primary],
    ).map((r) =>
      r.rootPath === primaryPath ? { ...r, isPrimary: true } : { ...r, isPrimary: false },
    );
    let activeRepoId = get().activeRepoId;
    if (!activeRepoId || !next.some((r) => r.id === activeRepoId)) {
      activeRepoId = primary.id;
    }
    set({ repos: next, activeRepoId });
    savePersisted({ repos: next, activeRepoId });
  },

  addRepoPath: (rootPath) => {
    const repo = makeScmRepo(rootPath);
    if (!repo.rootPath) return null;
    const repos = mergeUnique(get().repos, [repo]);
    const activeRepoId = repo.id;
    set({ repos, activeRepoId });
    savePersisted({ repos, activeRepoId });
    return repos.find((r) => r.id === repo.id) || repo;
  },

  removeRepo: (id) => {
    const cur = get().repos.find((r) => r.id === id);
    if (!cur) return;
    if (cur.isPrimary) return;
    const repos = get().repos.filter((r) => r.id !== id);
    let activeRepoId = get().activeRepoId;
    if (activeRepoId === id) {
      activeRepoId = repos.find((r) => r.isPrimary)?.id || repos[0]?.id || null;
    }
    set({ repos, activeRepoId });
    savePersisted({ repos, activeRepoId });
  },

  setActive: (id) => {
    if (!get().repos.some((r) => r.id === id)) return;
    set({ activeRepoId: id });
    savePersisted({ repos: get().repos, activeRepoId: id });
  },

  setCommitDraft: (id, draft) => {
    const repos = get().repos.map((r) =>
      r.id === id ? { ...r, commitDraft: draft } : r,
    );
    set({ repos });
    savePersisted({ repos, activeRepoId: get().activeRepoId });
  },

  patchRepo: (id, patch) => {
    const repos = get().repos.map((r) =>
      r.id === id ? { ...r, ...patch, id: r.id, rootPath: r.rootPath, color: r.color } : r,
    );
    set({ repos });
  },
}));

export function getActiveScmRepo(): ScmRepoRecord | null {
  const s = useScmReposStore.getState();
  return s.repos.find((r) => r.id === s.activeRepoId) || s.repos[0] || null;
}
