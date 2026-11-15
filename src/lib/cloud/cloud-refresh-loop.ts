/**
 * Periodic pull of cloud chats into VigilDB while signed in.
 * Closes the gap where phone/web messages only appear after re-login.
 */

const DEFAULT_INTERVAL_MS = 45_000;

let timer: ReturnType<typeof setInterval> | null = null;
let activeUid: string | null = null;
let inFlight = false;

export function isCloudRefreshLoopRunning(): boolean {
  return timer != null;
}

export function stopCloudChatRefreshLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  activeUid = null;
  inFlight = false;
}

async function tick(uid: string): Promise<void> {
  if (inFlight || activeUid !== uid) return;
  inFlight = true;
  try {
    const { hydrateLocalChatsFromCloud } = await import("./cloud-hydrate");
    await hydrateLocalChatsFromCloud(uid);
    const { useTabsStore } = await import("../../store/tabsStore");
    await useTabsStore.getState().reloadFromDb();
  } catch {
    /* offline / rules */
  } finally {
    inFlight = false;
  }
}

/** Start (or restart) background chat hydrate for this uid. */
export function startCloudChatRefreshLoop(
  uid: string,
  intervalMs = DEFAULT_INTERVAL_MS,
): void {
  if (!uid) return;
  if (timer && activeUid === uid) return;
  stopCloudChatRefreshLoop();
  activeUid = uid;
  timer = setInterval(() => {
    if (activeUid) void tick(activeUid);
  }, Math.max(15_000, intervalMs));
}

/** Visibility / focus nudge — pull sooner when user returns to the app. */
export async function refreshCloudChatsNow(uid?: string | null): Promise<void> {
  const id = uid ?? activeUid;
  if (!id) return;
  await tick(id);
}
