/**
 * In-flight delegate_tasks cancel token (leaf workers).
 */

let cancelled = false;
/** @type {Set<() => void>} */
const hooks = new Set();

export function resetDelegateCancel() {
  cancelled = false;
}

export function isDelegateCancelled() {
  return cancelled;
}

/**
 * @param {() => void} fn
 */
export function onDelegateCancel(fn) {
  hooks.add(fn);
  return () => hooks.delete(fn);
}

export function cancelDelegates() {
  cancelled = true;
  for (const fn of [...hooks]) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  hooks.clear();
  return { ok: true, cancelled: true };
}
