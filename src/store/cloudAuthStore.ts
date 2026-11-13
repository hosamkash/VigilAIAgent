import { create } from "zustand";
import {
  signInWithEmail,
  signOutCloud,
  signUpWithEmail,
  subscribeAuth,
  type CloudSessionUser,
} from "../lib/cloud/auth";
import { isFirebaseConfigured } from "../lib/cloud/firebase";

/** Prevent overlapping hydrates for the same uid (auth restore + signIn). */
let hydrateInFlightUid: string | null = null;
let lastHydratedUid: string | null = null;

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
      const { hydrateLocalChatsFromCloud, hydrateLocalPlansFromCloud } =
        await import("../lib/cloud/cloud-hydrate");
      await hydrateLocalChatsFromCloud(uid);
      const { useTabsStore } = await import("./tabsStore");
      await useTabsStore.getState().reloadFromDb();
      await hydrateLocalPlansFromCloud(uid);
      const { usePlanStore } = await import("./planStore");
      await usePlanStore.getState().refreshList({ includeArchived: true });
    } catch {
      /* offline / rules not deployed yet */
    }

    // Continuum UX: open Vigil Web embed once per uid when configured.
    try {
      const {
        isVigilWebConfigured,
        vigilWebEmbedUrl,
      } = await import("../lib/cloud/vigil-web-url");
      if (isVigilWebConfigured() && lastHydratedUid !== uid) {
        const key = `vigil.cloud.embedAutoOpened.${uid}`;
        let already = false;
        try {
          already = sessionStorage.getItem(key) === "1";
        } catch {
          /* ignore */
        }
        if (!already) {
          const { useEditorTabsStore } = await import("./editorTabsStore");
          useEditorTabsStore.getState().openBrowser(vigilWebEmbedUrl());
          try {
            sessionStorage.setItem(key, "1");
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* embed optional */
    }

    lastHydratedUid = uid;
  } finally {
    if (hydrateInFlightUid === uid) hydrateInFlightUid = null;
  }
}

type CloudAuthState = {
  configured: boolean;
  ready: boolean;
  user: CloudSessionUser | null;
  error: string | null;
  busy: boolean;
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
  error: null,
  busy: false,

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
      set({ user: null, busy: false });
    } catch (err) {
      set({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  clearError: () => set({ error: null }),
}));
