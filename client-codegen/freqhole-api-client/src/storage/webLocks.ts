// web locks leader election for the iroh node.
// only one tab per origin runs the midden node at a time.

/** lock name used for iroh node leader election */
export const LOCK_NAME = "freqhole-iroh-node";

export interface AcquireNodeLeadershipOpts {
  /** called when this tab becomes the node leader */
  onAcquired: () => void | Promise<void>;
  /** called with state transitions; optional */
  onStateChange?: (state: "leader" | "waiting" | "unsupported") => void;
}

/**
 * attempt to acquire exclusive leadership of the iroh node.
 *
 * behavior:
 *   - tries ifAvailable first; if the lock is free, holds it and calls onAcquired
 *   - if already held, reports "waiting" and queues a normal request with an AbortController
 *     so leadership transfers when the current leader tab closes
 *   - if navigator.locks is absent (e.g. non-secure context), reports "unsupported"
 *     and calls onAcquired immediately (single-tab fallback)
 *
 * returns a cancel/release function; call it to give up leadership or cancel the wait.
 */
export function acquireNodeLeadership(
  opts: AcquireNodeLeadershipOpts,
): () => void {
  const { onAcquired, onStateChange } = opts;

  // single-tab fallback for environments without Web Locks
  if (
    typeof navigator === "undefined" ||
    !navigator.locks
  ) {
    onStateChange?.("unsupported");
    void Promise.resolve().then(() => onAcquired());
    return () => {};
  }

  let released = false;
  // resolving this promise releases the held lock
  let releaseLock: (() => void) | null = null;
  // used to cancel the waiting queue request
  const waitAbort = new AbortController();

  function cancel() {
    released = true;
    waitAbort.abort();
    releaseLock?.();
  }

  // try to grab the lock immediately without queuing
  navigator.locks.request(
    LOCK_NAME,
    { ifAvailable: true },
    async (lock: Lock | null) => {
      if (released) return;

      if (lock !== null) {
        // we are now the leader - call onAcquired, then hold the lock until released
        onStateChange?.("leader");
        await onAcquired();
        await new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
      } else {
        // another tab holds the lock - queue up for leadership
        onStateChange?.("waiting");

        try {
          await navigator.locks.request(
            LOCK_NAME,
            { signal: waitAbort.signal },
            async () => {
              if (released) return;
              onStateChange?.("leader");
              await onAcquired();
              await new Promise<void>((resolve) => {
                releaseLock = resolve;
              });
            },
          );
        } catch {
          // aborted by cancel() or context destroyed - not an error
        }
      }
    },
  );

  return cancel;
}
