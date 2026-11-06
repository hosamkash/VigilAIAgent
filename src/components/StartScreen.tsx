import { useEffect, useRef, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Cloud,
  FolderGit,
  FolderOpen,
  FolderPlus,
  GitFork,
  KeyRound,
  LogIn,
  Server,
} from "lucide-react";
import { useExplorerStore } from "../store/explorerStore";
import { getWorkspaceCwd } from "../lib/secure-storage";
import { createDir, runWorkspaceCommand, writeTextFile } from "../lib/workspace-fs";
import { gitClone } from "../lib/git";
import { projectName, readRecentProjects, type RecentProject } from "../lib/recent-projects";
import {
  GIT_HOSTS,
  credentialHostFromBase,
  forgetGitHost,
  hostMeta,
  listHostRepos,
  listSavedGitHosts,
  readGitToken,
  rememberHttpsCredential,
  repoFolderName,
  safeProjectName,
  saveGitHost,
  verifyGitHost,
  type GitHostId,
  type GitHostProfile,
  type RemoteRepo,
} from "../lib/git-hosts";
import {
  browserSignInUrl,
  existingCliToken,
  githubBrowserLogin,
  tokenFromClipboard,
} from "../lib/git-oauth";

type Step = "home" | "connect" | "repos" | "new" | "ssh" | "clone";

async function pickFolder(): Promise<string | null> {
  const picked = await openDialog({ directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}

export function StartScreen() {
  const root = useExplorerStore((s) => s.root);
  const openWorkspace = useExplorerStore((s) => s.openWorkspace);
  const closeLauncher = useExplorerStore((s) => s.closeLauncher);
  const [step, setStep] = useState<Step>("home");
  const [hosts, setHosts] = useState<GitHostProfile[]>([]);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [detected, setDetected] = useState<string | null>(null);
  const [hostId, setHostId] = useState<GitHostId>("github");
  const [baseUrl, setBaseUrl] = useState(hostMeta("github").defaultBase);
  const [token, setToken] = useState("");
  const [repos, setRepos] = useState<RemoteRepo[]>([]);
  const [activeHost, setActiveHost] = useState<GitHostProfile | null>(null);
  const [filter, setFilter] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [sshHost, setSshHost] = useState("github.com");
  const [busy, setBusy] = useState(false);
  const [browserWait, setBrowserWait] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const connecting = useRef(false);

  function reloadLists() {
    setRecent(readRecentProjects());
    void listSavedGitHosts()
      .then(setHosts)
      .catch(() => setHosts([]));
  }

  useEffect(() => {
    reloadLists();
    void getWorkspaceCwd()
      .then(setDetected)
      .catch(() => setDetected(null));
  }, []);

  function chooseHost(id: GitHostId) {
    setHostId(id);
    setBaseUrl(hostMeta(id).defaultBase);
    setToken("");
    setError(null);
    setNote(null);
    setBrowserWait(false);
    setStep("connect");
  }

  async function openPath(path: string) {
    setBusy(true);
    setError(null);
    try {
      await openWorkspace(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onOpenProject() {
    const folder = await pickFolder();
    if (folder) await openPath(folder);
  }

  async function onCreateProject() {
    const name = safeProjectName(projectTitle);
    if (!name) return;
    const parent = await pickFolder();
    if (!parent) return;
    setBusy(true);
    setError(null);
    try {
      const dest = `${parent.replace(/\/$/, "")}/${name}`;
      await createDir(dest);
      await runWorkspaceCommand("git init", dest);
      await writeTextFile(dest + "/README.md", `# ${projectTitle.trim() || name}\n`);
      await openWorkspace(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function connectWithSecret(secret: string) {
    const value = secret.trim();
    if (!value || connecting.current) return;
    connecting.current = true;
    setBusy(true);
    setError(null);
    try {
      const meta = hostMeta(hostId);
      const base = (baseUrl || meta.defaultBase).trim();
      if (!base) throw new Error("Enter the host URL");
      const verified = await verifyGitHost(hostId, base, value);
      const profile: GitHostProfile = {
        host: hostId,
        baseUrl: base.replace(/\/$/, ""),
        login: verified.login,
        credentialUser: meta.credentialUser,
        credentialHost: credentialHostFromBase(base),
      };
      await saveGitHost(profile, value);
      if (detected) {
        await rememberHttpsCredential(
          detected,
          profile.credentialHost,
          profile.credentialUser,
          value,
        ).catch(() => undefined);
      }
      setToken("");
      setBrowserWait(false);
      setActiveHost(profile);
      setRepos(await listHostRepos(hostId, profile.baseUrl, value));
      reloadLists();
      setStep("repos");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      connecting.current = false;
      setBusy(false);
    }
  }

  async function copiedToken(explicit: boolean): Promise<string | null> {
    try {
      const text = await navigator.clipboard.readText();
      return tokenFromClipboard(text, hostId, explicit);
    } catch {
      return null;
    }
  }

  async function signInWithBrowser() {
    setError(null);
    setNote(null);
    if (hostId === "github") {
      setBusy(true);
      setBrowserWait(true);
      try {
        const secret = await githubBrowserLogin();
        await connectWithSecret(secret);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setBrowserWait(false);
      }
      return;
    }
    const existing = await existingCliToken(hostId).catch(() => null);
    if (existing) {
      await connectWithSecret(existing);
      return;
    }
    const url = browserSignInUrl(hostId, baseUrl);
    if (!url) {
      setError("Enter the host URL, then paste a token.");
      return;
    }
    await openUrl(url);
    setBrowserWait(true);
  }

  useEffect(() => {
    if (!browserWait) return;
    let left = false;
    const onBlur = () => {
      left = true;
    };
    const onFocus = () => {
      if (!left) return;
      if (hostId === "github") return;
      void copiedToken(false).then((secret) => {
        if (secret) void connectWithSecret(secret);
      });
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [browserWait, hostId, baseUrl, detected]);

  async function browseHost(profile: GitHostProfile) {
    setBusy(true);
    setError(null);
    setActiveHost(profile);
    try {
      const secret = await readGitToken(profile.host);
      setRepos(await listHostRepos(profile.host, profile.baseUrl, secret));
      setStep("repos");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("home");
    } finally {
      setBusy(false);
    }
  }

  async function cloneRepo(url: string) {
    const parent = await pickFolder();
    if (!parent) return;
    setBusy(true);
    setError(null);
    try {
      if (activeHost) {
        const secret = await readGitToken(activeHost.host);
        await rememberHttpsCredential(
          parent,
          activeHost.credentialHost,
          activeHost.credentialUser,
          secret,
        );
      }
      const dest = `${parent.replace(/\/$/, "")}/${repoFolderName(url)}`;
      await gitClone(url.trim(), dest);
      await openWorkspace(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function testSsh() {
    if (!/^[a-zA-Z0-9.-]+$/.test(sshHost)) {
      setError("Enter a hostname such as github.com");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const cwd = detected || (await getWorkspaceCwd());
      const out = await runWorkspaceCommand(
        `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -T git@${sshHost}`,
        cwd,
      );
      const ok = /successfully authenticated|Welcome to GitLab|Shell access is not/i.test(out);
      setNote(ok ? `SSH to ${sshHost} is ready.` : out.slice(0, 400));
      if (!ok) setError("SSH did not confirm this account. Add your key, then test again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const visibleRepos = repos.filter((repo) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return repo.fullName.toLowerCase().includes(q) || repo.name.toLowerCase().includes(q);
  });

  return (
    <div className="flex h-full justify-center overflow-auto bg-[var(--vigil-editor)] px-6 py-10 text-[var(--vigil-text)]">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Vigil</div>
            <div className="text-xs text-[var(--vigil-muted)]">
              Open a project, create one, or sign in to a Git host.
            </div>
          </div>
          {root && (
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] px-2 py-1 text-xs"
              onClick={closeLauncher}
            >
              Back to editor
            </button>
          )}
        </div>

        {error && (
          <div className="mb-3 rounded border border-[var(--vigil-danger)]/40 bg-[var(--vigil-danger)]/10 px-3 py-2 text-xs text-[var(--vigil-danger)]">
            {error}
          </div>
        )}
        {note && !error && (
          <div className="mb-3 rounded border border-[var(--vigil-border)] px-3 py-2 text-xs text-[var(--vigil-muted)]">
            {note}
          </div>
        )}

        {step === "home" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <ActionCard
                icon={<FolderOpen className="h-4 w-4" />}
                title="Open project"
                detail="Choose a folder on this Mac"
                onClick={() => void onOpenProject()}
              />
              <ActionCard
                icon={<FolderPlus className="h-4 w-4" />}
                title="New project"
                detail="Create a folder and git init"
                onClick={() => {
                  setError(null);
                  setStep("new");
                }}
              />
              <ActionCard
                icon={<FolderGit className="h-4 w-4" />}
                title="Clone repo"
                detail="Paste any Git URL"
                onClick={() => {
                  setActiveHost(null);
                  setError(null);
                  setStep("clone");
                }}
              />
              <ActionCard
                icon={<KeyRound className="h-4 w-4" />}
                title="Connect via SSH"
                detail="Use a key you already have"
                onClick={() => {
                  setError(null);
                  setStep("ssh");
                }}
              />
            </div>

            <div className="mt-4 text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
              Sign in to a host
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {GIT_HOSTS.map((host) => {
                const saved = hosts.find((item) => item.host === host.id);
                return (
                  <button
                    key={host.id}
                    type="button"
                    className="flex items-center gap-3 rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-3 py-3 text-left hover:border-[var(--vigil-accent)]"
                    onClick={() => (saved ? void browseHost(saved) : chooseHost(host.id))}
                  >
                    <HostMark id={host.id} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{host.label}</span>
                      <span className="block truncate text-[11px] text-[var(--vigil-muted)]">
                        {saved ? `Signed in as ${saved.login}` : "Sign in"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 text-[11px] font-semibold uppercase text-[var(--vigil-muted)]">
              Recent projects
            </div>
            <div className="mt-2">
              {detected && detected !== root && (
                <RecentRow
                  name={projectName(detected)}
                  path={detected}
                  hint="Detected"
                  onClick={() => void openPath(detected)}
                />
              )}
              {recent.map((item) => (
                <RecentRow
                  key={item.path}
                  name={item.name}
                  path={item.path}
                  onClick={() => void openPath(item.path)}
                />
              ))}
              {recent.length === 0 && !detected && (
                <div className="text-xs text-[var(--vigil-muted)]">No projects yet.</div>
              )}
            </div>
          </>
        )}

        {step === "connect" && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void connectWithSecret(token);
            }}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <HostMark id={hostId} />
              Sign in to {hostMeta(hostId).label}
            </div>
            <p className="text-xs text-[var(--vigil-text)]">
              {hostId === "github"
                ? "Opens GitHub. Confirm there, and Vigil lists your repositories as soon as GitHub sends you back."
                : `Opens ${hostMeta(hostId).label}. Log in there, copy the token it shows, then come back.`}
            </p>
            <button
              type="button"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded bg-[var(--vigil-accent)] px-2.5 py-1.5 text-xs !text-white disabled:opacity-40"
              onClick={() => void signInWithBrowser()}
            >
              <LogIn className="h-3.5 w-3.5" />
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {browserWait && hostId === "github" && (
              <div className="rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-3 py-2 text-xs text-[var(--vigil-text)]">
                Confirm in the browser. Vigil lists your repositories when GitHub sends you back.
              </div>
            )}
            {browserWait && hostId !== "github" && (
              <div className="rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-3 py-2">
                <div className="text-xs text-[var(--vigil-text)]">Waiting for the browser.</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-xs !text-white disabled:opacity-40"
                    onClick={() =>
                      void copiedToken(true).then((secret) => {
                        if (secret) void connectWithSecret(secret);
                        else setError("Copy the token in the browser, then try again.");
                      })
                    }
                  >
                    Connect copied token
                  </button>
                  <button
                    type="button"
                    className="text-xs text-[var(--vigil-muted)]"
                    onClick={() => setBrowserWait(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://gitlab.example.com"
              className="w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1.5 text-xs"
            />
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Or paste a personal access token"
              className="w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1.5 text-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              {browserSignInUrl(hostId, baseUrl) && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-[var(--vigil-border)] px-2 py-1 text-xs"
                  onClick={() => void openUrl(browserSignInUrl(hostId, baseUrl))}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Create token
                </button>
              )}
              <button
                type="submit"
                disabled={busy || !token.trim()}
                className="rounded border border-[var(--vigil-border)] px-2 py-1 text-xs disabled:opacity-40"
              >
                {busy ? "Signing in…" : "Connect token"}
              </button>
              <button type="button" className="text-xs text-[var(--vigil-muted)]" onClick={() => setStep("home")}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {step === "repos" && activeHost && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium">
                {activeHost.login} · {hostMeta(activeHost.host).label}
              </div>
              <button
                type="button"
                className="text-[11px] text-[var(--vigil-danger)]"
                onClick={() =>
                  void forgetGitHost(activeHost.host).then(() => {
                    reloadLists();
                    setStep("home");
                  })
                }
              >
                Sign out
              </button>
            </div>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter repositories"
              className="mb-2 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-xs"
            />
            <div className="max-h-80 overflow-auto rounded border border-[var(--vigil-border)]">
              {visibleRepos.map((repo) => (
                <button
                  key={repo.cloneUrl}
                  type="button"
                  disabled={busy}
                  className="block w-full border-b border-[var(--vigil-border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--vigil-hover)] disabled:opacity-40"
                  onClick={() => void cloneRepo(repo.cloneUrl)}
                >
                  <div className="text-xs font-medium">{repo.fullName}</div>
                  <div className="truncate text-[10px] text-[var(--vigil-muted)]">Clone</div>
                </button>
              ))}
              {visibleRepos.length === 0 && (
                <div className="px-3 py-3 text-xs text-[var(--vigil-muted)]">No repositories.</div>
              )}
            </div>
            <button type="button" className="mt-2 text-xs text-[var(--vigil-muted)]" onClick={() => setStep("home")}>
              Back
            </button>
          </div>
        )}

        {step === "new" && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void onCreateProject();
            }}
          >
            <div className="text-sm font-medium">New project</div>
            <input
              autoFocus
              value={projectTitle}
              onChange={(event) => setProjectTitle(event.target.value)}
              placeholder="Project name"
              className="w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1.5 text-xs"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || !projectTitle.trim()}
                className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-xs !text-white disabled:opacity-40"
              >
                {busy ? "Creating…" : "Choose folder and create"}
              </button>
              <button type="button" className="text-xs text-[var(--vigil-muted)]" onClick={() => setStep("home")}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {step === "clone" && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void cloneRepo(cloneUrl);
            }}
          >
            <div className="text-sm font-medium">Clone repository</div>
            <input
              autoFocus
              value={cloneUrl}
              onChange={(event) => setCloneUrl(event.target.value)}
              placeholder="https://host/org/repo.git"
              className="w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1.5 text-xs"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || !cloneUrl.trim()}
                className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-xs !text-white disabled:opacity-40"
              >
                {busy ? "Cloning…" : "Choose folder and clone"}
              </button>
              <button type="button" className="text-xs text-[var(--vigil-muted)]" onClick={() => setStep("home")}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {step === "ssh" && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Connect via SSH</div>
            <p className="text-xs text-[var(--vigil-muted)]">
              Uses the SSH key already on this Mac. Test the host, then clone with a git@ URL.
            </p>
            <input
              value={sshHost}
              onChange={(event) => setSshHost(event.target.value.trim())}
              placeholder="github.com"
              className="w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1.5 text-xs"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded border border-[var(--vigil-border)] px-2 py-1 text-xs"
                onClick={() => void testSsh()}
              >
                Test connection
              </button>
              <button type="button" className="text-xs text-[var(--vigil-muted)]" onClick={() => setStep("home")}>
                Back
              </button>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void cloneRepo(cloneUrl);
              }}
            >
              <input
                value={cloneUrl}
                onChange={(event) => setCloneUrl(event.target.value)}
                placeholder="git@github.com:org/repo.git"
                className="min-w-0 flex-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1.5 text-xs"
              />
              <button
                type="submit"
                disabled={busy || !cloneUrl.trim()}
                className="rounded bg-[var(--vigil-accent)] px-2 py-1 text-xs !text-white disabled:opacity-40"
              >
                Clone
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionCard({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-md border border-[var(--vigil-border)] bg-[var(--vigil-panel)] px-3 py-3 text-left hover:border-[var(--vigil-accent)]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--vigil-accent)]/15 text-[var(--vigil-accent)]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-[11px] text-[var(--vigil-muted)]">{detail}</span>
      </span>
    </button>
  );
}

function HostMark({ id }: { id: GitHostId }) {
  const tone =
    id === "github"
      ? "bg-[#24292f] text-white"
      : id === "gitlab"
        ? "bg-[#e24329] text-white"
        : id === "azure"
          ? "bg-[#0078d4] text-white"
          : "bg-[var(--vigil-hover)] text-[var(--vigil-text)]";
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tone}`}>
      {id === "github" && <GithubMark />}
      {id === "gitlab" && <GitFork className="h-4 w-4" />}
      {id === "azure" && <Cloud className="h-4 w-4" />}
      {id === "other" && <Server className="h-4 w-4" />}
    </span>
  );
}

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function RecentRow({
  name,
  path,
  hint,
  onClick,
}: {
  name: string;
  path: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded px-1 py-1.5 text-left hover:bg-[var(--vigil-hover)]"
    >
      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--vigil-muted)]" />
      <span className="w-36 shrink-0 truncate text-xs">{name}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--vigil-muted)]">{path}</span>
      {hint && <span className="text-[10px] text-[var(--vigil-accent)]">{hint}</span>}
    </button>
  );
}
