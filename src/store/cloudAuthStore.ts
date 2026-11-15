import { create } from "zustand";
import {
  fetchCloudBillingProfile,
  signInWithEmail,
  signOutCloud,
  signUpWithEmail,
  subscribeAuth,
  type CloudBillingProfile,
  type CloudSessionUser,
} from "../lib/cloud/auth";
import { isFirebaseConfigured } from "../lib/cloud/firebase";

/** Prevent overlapping hydrates for the same uid (auth restore + signIn). */
let hydrateInFlightUid: string | null = null;
let lastHydratedUid: string | null = null;
let visibilityHooked = false;

async function afterCloudSignIn(uid: string): Promise<void> {
  if (hydrateInFlightUid === uid) return;
  hydrateInFlightUid = uid;
  try {
    try {
      const { touchCloudDevice } = await import("../lib/cloud/devices");
      await touchCloudDevice(uid);
    } catch {
      /* offline */
    }
    try {
      const { hydrateLocalPlansFromCloud } = await import(
        "../lib/cloud/cloud-hydrate"
      );
      const { useTabsStore } = await import("./tabsStore");
      const tabs = useTabsStore.getState();
      // Firestore-primary: first load goes through tabs.hydrate(); later sign-in syncs.
      if (!tabs.hydrated) {
        await tabs.hydrate();
      } else {
        const { hydrateLocalChatsFromCloud } = await import(
          "../lib/cloud/cloud-hydrate"
        );
        await hydrateLocalChatsFromCloud(uid);
        await tabs.reloadFromDb();
      }
      await hydrateLocalPlansFromCloud(uid);
      const { usePlanStore } = await import("./planStore");
      await usePlanStore.getState().refreshList({ includeArchived: true });
      const { useBrowserHistoryStore } = await import("./browserHistoryStore");
      await useBrowserHistoryStore.getState().hydrate();
    } catch {
      /* offline / rules not deployed yet */
    }

    // Continuum UX: keep a dedicated Vigil Cloud tab (Firestore history canvas).
    try {
      const { isVigilWebConfigured } = await import("../lib/cloud/vigil-web-url");
      if (isVigilWebConfigured()) {
        const { openCloudEmbedTab } = await import("../lib/cloud/open-cloud-embed");
        const firstThisSession = lastHydratedUid !== uid;
        openCloudEmbedTab({ focus: firstThisSession });
      }
    } catch {
      /* embed optional */
    }

    try {
      const billing = await fetchCloudBillingProfile(uid);
      useCloudAuthStore.setState({ billing });
    } catch {
      /* offline */
    }

    lastHydratedUid = uid;

    // Keep native chat history closer to web while signed in.
    try {
      const { startCloudChatRefreshLoop } = await import(
        "../lib/cloud/cloud-refresh-loop"
      );
      startCloudChatRefreshLoop(uid);
    } catch {
      /* optional */
    }

    // Pull sooner when user returns to the desktop window.
    try {
      if (typeof document !== "undefined" && !visibilityHooked) {
        visibilityHooked = true;
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState !== "visible") return;
          const current = useCloudAuthStore.getState().user?.uid;
          if (!current) return;
          void import("../lib/cloud/cloud-refresh-loop")
            .then(({ refreshCloudChatsNow }) => refreshCloudChatsNow(current))
            .catch(() => undefined);
          void useCloudAuthStore.getState().refreshBilling().catch(() => undefined);
        });
      }
      if (typeof window !== "undefined") {
        const w = window as Window & { __vigilBillingFocus?: boolean };
        if (!w.__vigilBillingFocus) {
          w.__vigilBillingFocus = true;
          window.addEventListener("focus", () => {
            void useCloudAuthStore.getState().refreshBilling().catch(() => undefined);
          });
        }
      }
    } catch {
      /* ignore */
    }
  } finally {
    if (hydrateInFlightUid === uid) hydrateInFlightUid = null;
  }
}

type CloudAuthState = {
  configured: boolean;
  ready: boolean;
  user: CloudSessionUser | null;
  billing: CloudBillingProfile | null;
  error: string | null;
  busy: boolean;
  refreshBilling: () => Promise<void>;
  init: () => () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
};

export const useCloudAuthStore = create<CloudAuthState>((set) => ({
  configured: isFirebaseConfigured(),
  ready: false,
  user: null,
  billing: null,
  error: null,
  busy: false,

  refreshBilling: async () => {
    const uid = useCloudAuthStore.getState().user?.uid;
    if (!uid) {
      set({ billing: null });
      return;
    }
    const billing = await fetchCloudBillingProfile(uid);
    set({ billing });
  },

  init: () => {
    set({ configured: isFirebaseConfigured() });
    if (!isFirebaseConfigured()) {
      set({ ready: true, user: null });
      return () => {};
    }
    return subscribeAuth((user) => {
      set({ user, ready: true, error: null });
      if (user) {
        // Session restore + sign-in both land here — hydrate cloud history.
        void afterCloudSignIn(user.uid);
      } else {
        lastHydratedUid = null;
        set({ billing: null });
        void import("../lib/cloud/cloud-refresh-loop")
          .then(({ stopCloudChatRefreshLoop }) => stopCloudChatRefreshLoop())
          .catch(() => undefined);
      }
    });
  },

  signIn: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const user = await signInWithEmail(email, password);
      set({ user, busy: false });
      // subscribeAuth also fires; afterCloudSignIn is idempotent per uid in-flight.
      void afterCloudSignIn(user.uid);
    } catch (err) {
      set({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  signUp: async (email, password, displayName) => {
    set({ busy: true, error: null });
    try {
      const user = await signUpWithEmail(email, password, displayName);
      set({ user, busy: false });
      void afterCloudSignIn(user.uid);
    } catch (err) {
      set({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  signOut: async () => {
    set({ busy: true, error: null });
    try {
      await signOutCloud();
      lastHydratedUid = null;
      try {
        const { stopCloudChatRefreshLoop } = await import(
          "../lib/cloud/cloud-refresh-loop"
        );
        stopCloudChatRefreshLoop();
      } catch {
        /* ignore */
      }
      set({ user: null, billing: null, busy: false });
    } catch (err) {
      set({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  clearError: () => set({ error: null }),
}));
