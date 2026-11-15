import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Plus, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useScmReposStore } from "../../../store/scmReposStore";

export function ScmRepoTabs() {
  const repos = useScmReposStore((s) => s.repos);
  const activeRepoId = useScmReposStore((s) => s.activeRepoId);
  const setActive = useScmReposStore((s) => s.setActive);
  const addRepoPath = useScmReposStore((s) => s.addRepoPath);
  const removeRepo = useScmReposStore((s) => s.removeRepo);

  async function addRepo() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string" || !picked) return;
    addRepoPath(picked);
  }

  if (repos.length === 0) return null;

  return (
    <div className="mb-2 flex items-center gap-1 overflow-x-auto border-b border-[var(--vigil-border)] pb-1.5">
      {repos.map((repo) => {
        const active = repo.id === activeRepoId;
        return (
          <button
            key={repo.id}
            type="button"
            title={repo.rootPath}
            onClick={() => setActive(repo.id)}
            className={`group flex max-w-[9.5rem] shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
              active ? "text-[var(--tab-color)]" : "opacity-70 hover:opacity-100"
            }`}
            style={
              {
                "--tab-color": repo.color,
                background: active ? `${repo.color}22` : "transparent",
                boxShadow: active ? `inset 0 -2px 0 ${repo.color}` : undefined,
                color: repo.color,
              } as CSSProperties
            }
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: repo.color }}
            />
            <span className="truncate">{repo.displayName}</span>
            {typeof repo.changeCount === "number" && repo.changeCount > 0 ? (
              <span className="font-mono text-[9px] opacity-80">
                {repo.changeCount}
              </span>
            ) : null}
            {!repo.isPrimary ? (
              <span
                role="button"
                tabIndex={0}
                title="Remove from Source Control (does not delete files)"
                className="hidden rounded p-0.5 group-hover:inline-flex hover:bg-[var(--vigil-hover)]"
                onClick={(e) => {
                  e.stopPropagation();
                  removeRepo(repo.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    removeRepo(repo.id);
                  }
                }}
              >
                <X className="h-2.5 w-2.5" />
              </span>
            ) : null}
          </button>
        );
      })}
      <button
        type="button"
        title="Add Git repository…"
        className="shrink-0 rounded p-0.5 text-[var(--vigil-muted)] hover:bg-[var(--vigil-hover)] hover:text-[var(--vigil-text)]"
        onClick={() => void addRepo()}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
