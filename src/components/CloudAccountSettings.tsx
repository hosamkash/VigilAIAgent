import { useEffect, useState, type FormEvent } from "react";
import {
  hydrateLocalChatsFromCloud,
  hydrateLocalPlansFromCloud,
} from "../lib/cloud/cloud-hydrate";
import { isFirebaseConfigured } from "../lib/cloud/firebase";
import { pushPlanToCloud } from "../lib/cloud/plans-sync";
import {
  getConfiguredVigilWebUrl,
  isVigilWebConfigured,
  setConfiguredVigilWebUrl,
  vigilWebEmbedUrl,
} from "../lib/cloud/vigil-web-url";
import { useCloudAuthStore } from "../store/cloudAuthStore";
import { useEditorTabsStore } from "../store/editorTabsStore";
import { usePlanStore } from "../store/planStore";
import { useTabsStore } from "../store/tabsStore";

/** Settings → Account: Firebase Auth for Cloud Bridge. */
export function CloudAccountSettings() {
  const configured = useCloudAuthStore((s) => s.configured);
  const ready = useCloudAuthStore((s) => s.ready);
  const user = useCloudAuthStore((s) => s.user);
  const busy = useCloudAuthStore((s) => s.busy);
  const error = useCloudAuthStore((s) => s.error);
  const signIn = useCloudAuthStore((s) => s.signIn);
  const signUp = useCloudAuthStore((s) => s.signUp);
  const signOut = useCloudAuthStore((s) => s.signOut);
  const clearError = useCloudAuthStore((s) => s.clearError);
  const activePlan = usePlanStore((s) => s.activePlan);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [webUrl, setWebUrl] = useState(() => getConfiguredVigilWebUrl());
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  function openCloudEmbed() {
    setConfiguredVigilWebUrl(webUrl);
    if (!isVigilWebConfigured()) {
      setNote(
        "Set a Vigil Web URL first (hosted User shell), or VITE_VIGIL_WEB_URL in .env.local.",
      );
      return;
    }
    useEditorTabsStore.getState().openBrowser(vigilWebEmbedUrl());
    setNote("Opened Vigil Cloud embed tab (?embed=1).");
  }

  useEffect(() => {
    clearError();
  }, [mode, clearError]);

  useEffect(() => {
    if (!user) {
      setWalletBalance(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { doc, getDoc } = await import("firebase/firestore");
        const { getFirebaseDb } = await import("../lib/cloud/firebase");
        const { CLOUD_COLLECTIONS } = await import("../lib/cloud/collections");
        const snap = await getDoc(
          doc(getFirebaseDb(), CLOUD_COLLECTIONS.users, user.uid),
        );
        if (cancelled || !snap.exists()) return;
        const bal = Number(snap.data()?.tokenBalance ?? 0);
        setWalletBalance(Number.isFinite(bal) ? bal : 0);
      } catch {
        if (!cancelled) setWalletBalance(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password, displayName);
      setPassword("");
      setNote(mode === "signin" ? "Signed in." : "Account created.");
    } catch {
      /* error on store */
    }
  }

  async function syncActivePlan() {
    if (!user || !activePlan) return;
    setNote(null);
    try {
      await pushPlanToCloud(activePlan, user.uid);
      setNote(`Plan “${activePlan.title}” synced to cloud.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  }

  async function pullChatsFromCloud() {
    if (!user) return;
    setNote(null);
    try {
      const result = await hydrateLocalChatsFromCloud(user.uid);
      await useTabsStore.getState().reloadFromDb();
      setNote(
        `Cloud chats: ${result.chatsSeen} seen — imported ${result.imported}, skipped ${result.skipped}.`,
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  }

  async function pullPlansFromCloud() {
    if (!user) return;
    setNote(null);
    try {
      const result = await hydrateLocalPlansFromCloud(user.uid);
      if (!result.workspaceRoot) {
        setNote("Open a workspace folder before pulling plans.");
        return;
      }
      await usePlanStore.getState().refreshList({ includeArchived: true });
      setNote(
        `Cloud plans: ${result.plansSeen} seen — imported ${result.imported}, skipped ${result.skipped}.`,
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  }

  if (!configured) {
    return (
      <div className="rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-4 text-sm">
        <h3 className="font-semibold">Cloud account</h3>
        <p className="mt-1 text-xs text-[var(--vigil-muted)]">
          Firebase is not configured yet. Copy{" "}
          <code className="text-[11px]">.env.example</code> →{" "}
          <code className="text-[11px]">.env.local</code> and set{" "}
          <code className="text-[11px]">VITE_FIREBASE_*</code> (see{" "}
          <code className="text-[11px]">firebase/README.md</code>).
        </p>
        <p className="mt-2 text-xs text-[var(--vigil-muted)]">
          Configured now: {isFirebaseConfigured() ? "yes" : "no"}
        </p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="text-sm text-[var(--vigil-muted)]">
        Loading cloud session…
      </div>
    );
  }

  if (user) {
    return (
      <div className="space-y-3 rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-4">
        <div>
          <h3 className="text-sm font-semibold">Cloud account</h3>
          <p className="mt-1 text-xs text-[var(--vigil-muted)]">
            Same Vigil identity for web + desktop (Cloud Bridge). Workspace
            source is never uploaded.
          </p>
        </div>
        <div className="text-sm">
          <div className="font-medium">{user.displayName || "Signed in"}</div>
          <div className="text-xs text-[var(--vigil-muted)]">
            {user.email || user.uid}
          </div>
          {walletBalance != null ? (
            <div className="mt-1 text-xs text-[var(--vigil-muted)]">
              Shared wallet: {walletBalance.toLocaleString()} tokens
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            disabled={busy || !activePlan}
            onClick={() => void syncActivePlan()}
          >
            Sync active plan to cloud
          </button>
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            disabled={busy}
            onClick={() => void pullChatsFromCloud()}
          >
            Pull chats from cloud
          </button>
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            disabled={busy}
            onClick={() => void pullPlansFromCloud()}
          >
            Pull plans from cloud
          </button>
          <button
            type="button"
            className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs text-[var(--vigil-danger)] disabled:opacity-50"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
        <div className="rounded border border-[var(--vigil-border)] p-3">
          <div className="text-xs font-semibold">Vigil Cloud embed</div>
          <p className="mt-1 text-[11px] text-[var(--vigil-muted)]">
            Opens the hosted Vigil Web shell inside a desktop tab (same history
            UX). Set the URL when the web app is deployed.
          </p>
          <input
            className="mt-2 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-xs"
            placeholder="http://127.0.0.1:3000"
            value={webUrl}
            onChange={(e) => setWebUrl(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-xs !text-white"
              onClick={() => {
                setConfiguredVigilWebUrl(webUrl);
                setNote("Saved Vigil Web URL.");
              }}
            >
              Save URL
            </button>
            <button
              type="button"
              className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs"
              onClick={() => openCloudEmbed()}
            >
              Open Vigil Cloud
            </button>
          </div>
        </div>
        {note ? (
          <p className="text-xs text-[var(--vigil-muted)]">{note}</p>
        ) : null}
        {error ? (
          <p className="text-xs text-[var(--vigil-danger)]">{error}</p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="max-w-md space-y-3 rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-4"
    >
      <div>
        <h3 className="text-sm font-semibold">Cloud account</h3>
        <p className="mt-1 text-xs text-[var(--vigil-muted)]">
          Sign in to sync plans/chats across devices. Local Execute stays on this
          machine.
        </p>
      </div>
      <div className="rounded border border-[var(--vigil-border)] p-3">
        <div className="text-xs font-semibold">Vigil Cloud embed</div>
        <input
          className="mt-2 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-xs"
          placeholder="http://127.0.0.1:3000"
          value={webUrl}
          onChange={(e) => setWebUrl(e.target.value)}
        />
        <button
          type="button"
          className="mt-2 rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs"
          onClick={() => openCloudEmbed()}
        >
          Open Vigil Cloud
        </button>
      </div>
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          className={`rounded px-2 py-1 ${
            mode === "signin"
              ? "bg-[var(--vigil-accent)] !text-white"
              : "text-[var(--vigil-muted)]"
          }`}
          onClick={() => setMode("signin")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`rounded px-2 py-1 ${
            mode === "signup"
              ? "bg-[var(--vigil-accent)] !text-white"
              : "text-[var(--vigil-muted)]"
          }`}
          onClick={() => setMode("signup")}
        >
          Create account
        </button>
      </div>
      {mode === "signup" ? (
        <label className="block text-sm">
          Display name
          <input
            className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-sm"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
          />
        </label>
      ) : null}
      <label className="block text-sm">
        Email
        <input
          type="email"
          required
          className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </label>
      <label className="block text-sm">
        Password
        <input
          type="password"
          required
          minLength={6}
          className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-sm"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-sm !text-white disabled:opacity-50"
      >
        {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
      {error ? (
        <p className="text-xs text-[var(--vigil-danger)]">{error}</p>
      ) : null}
      {note ? (
        <p className="text-xs text-[var(--vigil-muted)]">{note}</p>
      ) : null}
    </form>
  );
}
