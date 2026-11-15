import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
});

const { scmRepoIdFromPath } = await import("../lib/scm-repo");
const { useScmReposStore } = await import("./scmReposStore");

describe("scmReposStore", () => {
  beforeEach(() => {
    memory.clear();
    useScmReposStore.setState({
      repos: [],
      activeRepoId: null,
      hydrated: false,
    });
  });

  it("scopes active repo and does not mix two roots", () => {
    const store = useScmReposStore.getState();
    store.syncFromWorkspace("/proj/VigilAIAgent");
    store.addRepoPath("/proj/Vigil-AI-Agent-Web");
    const s = useScmReposStore.getState();
    expect(s.repos.length).toBe(2);
    expect(s.activeRepoId).toBe(
      scmRepoIdFromPath("/proj/Vigil-AI-Agent-Web"),
    );
    s.setActive(scmRepoIdFromPath("/proj/VigilAIAgent"));
    expect(useScmReposStore.getState().activeRepoId).toBe(
      scmRepoIdFromPath("/proj/VigilAIAgent"),
    );
  });

  it("keeps per-repo commit drafts when switching", () => {
    const store = useScmReposStore.getState();
    store.syncFromWorkspace("/a");
    store.addRepoPath("/b");
    const idA = scmRepoIdFromPath("/a");
    const idB = scmRepoIdFromPath("/b");
    store.setCommitDraft(idA, "desktop fix");
    store.setCommitDraft(idB, "web copy");
    expect(
      useScmReposStore.getState().repos.find((r) => r.id === idA)?.commitDraft,
    ).toBe("desktop fix");
    expect(
      useScmReposStore.getState().repos.find((r) => r.id === idB)?.commitDraft,
    ).toBe("web copy");
  });

  it("closing a tab does not drop the primary workspace", () => {
    const store = useScmReposStore.getState();
    store.syncFromWorkspace("/a");
    store.addRepoPath("/b");
    store.removeRepo(scmRepoIdFromPath("/a"));
    expect(
      useScmReposStore.getState().repos.some((r) => r.rootPath === "/a"),
    ).toBe(true);
    store.removeRepo(scmRepoIdFromPath("/b"));
    expect(
      useScmReposStore.getState().repos.map((r) => r.rootPath),
    ).toEqual(["/a"]);
  });

  it("restores extra repos and last active tab after hydrate", () => {
    const store = useScmReposStore.getState();
    store.syncFromWorkspace("/a");
    store.addRepoPath("/b");
    const idB = scmRepoIdFromPath("/b");
    expect(useScmReposStore.getState().activeRepoId).toBe(idB);

    useScmReposStore.setState({
      repos: [],
      activeRepoId: null,
      hydrated: false,
    });
    useScmReposStore.getState().hydrate();
    useScmReposStore.getState().syncFromWorkspace("/a");
    const s = useScmReposStore.getState();
    expect(s.repos.map((r) => r.rootPath).sort()).toEqual(["/a", "/b"]);
    expect(s.activeRepoId).toBe(idB);
  });
});
