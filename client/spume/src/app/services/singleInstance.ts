// prevents spume from running in more than one browser tab at once.
//
// a second tab would spin up its own midden node sharing the same p2p
// identity (secret key persisted in IndexedDB - see client.ts's
// getMiddenNode()), advertising the same iroh node id from two places at
// once, and racing for the same OPFS-backed blob store (only one tab wins
// that lock too - see middenWorker.ts's acquireStoreLock(), the same Web
// Locks API pattern this mirrors). rather than let a second tab run in a
// silently degraded state, block it outright with a simple message.
//
// tauri/charnel is a single native window already - no multi-tab concept
// there, so callers should only use this in plain-browser mode.

const SINGLE_INSTANCE_LOCK_NAME = "spume-single-instance";

/**
 * resolves `true` if this tab acquired the single-instance lock (and now
 * holds it for the tab's lifetime - released automatically on tab close/
 * navigation), `false` if another tab already holds it.
 *
 * fails open (resolves `true`, never blocks) when the Web Locks API isn't
 * available or the request itself errors - this is a best-effort UX
 * guard, not a correctness requirement.
 */
export async function acquireSingleInstanceLock(): Promise<boolean> {
  const locks = (navigator as { locks?: LockManager }).locks;
  if (!locks) return true;
  return new Promise<boolean>((resolve) => {
    void locks
      .request(SINGLE_INSTANCE_LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        resolve(true);
        // hold the lock until this tab closes/navigates away
        await new Promise<never>(() => {});
      })
      .catch(() => resolve(true));
  });
}
