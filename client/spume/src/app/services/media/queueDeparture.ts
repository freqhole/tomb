// queue departure diff — the exhaustive answer to "what just left the queue?"
//
// `queue.ts` has 13 `setQueue()` call sites and only 5 evict anything, so
// replacing the queue wholesale (selecting an album, resuming a history entry)
// currently leaks every previously-queued item's tier-2 bytes.
//
// rather than routing every caller through a helper — which is exactly how
// this drifted — `setQueue` diffs old against new and emits the departures.
// additive and reorder writes naturally produce an empty set, and a future
// 14th call site cannot forget.

import { warn } from "../../../utils/logger";
import { mediaItemKey, type MediaItem } from "../storage/mediaItem";

/**
 * items present in `prev` whose identity key is absent from `next`.
 *
 * identity is `mediaItemKey` (currently `Song.sha256` / `Video.id` —
 * DEPRECATED(sha256); this module only compares keys, so it needs no change
 * when the key becomes blake3).
 *
 * duplicates matter: a song queued twice and removed once has NOT departed,
 * and a song queued twice and removed twice is reported once. callers are
 * purging shared byte storage, so the unit of departure is the key, not the
 * queue slot.
 */
export function diffQueueDepartures(prev: MediaItem[], next: MediaItem[]): MediaItem[] {
  if (prev.length === 0) return [];

  const surviving = new Set<string>();
  for (const item of next) {
    surviving.add(mediaItemKey(item));
  }

  const departed: MediaItem[] = [];
  const seen = new Set<string>();
  for (const item of prev) {
    const key = mediaItemKey(item);
    if (surviving.has(key) || seen.has(key)) continue;
    seen.add(key);
    departed.push(item);
  }
  return departed;
}

type DepartureHandler = (items: MediaItem[], remaining: MediaItem[]) => void | Promise<void>;

const handlers = new Set<DepartureHandler>();

/** register a handler fired whenever items leave the queue.
 *
 * `db.ts` cannot import the media/cache layer directly (that would close an
 * import cycle), so the media layer subscribes here instead — the same idiom
 * as `registerStopMusic` in playbackCoordinator.ts.
 *
 * handlers receive the surviving queue as well, because some resources are
 * shared between items (album art across a whole album) and must not be
 * purged while anything still queued references them. */
export function registerQueueDeparture(fn: DepartureHandler): void {
  handlers.add(fn);
}

/** called by `setQueue` after every queue write. never throws: a failed purge
 * must not take a queue mutation down with it. */
export function notifyQueueDepartures(prev: MediaItem[], next: MediaItem[]): void {
  const departed = diffQueueDepartures(prev, next);
  if (departed.length === 0) return;
  for (const fn of handlers) {
    void (async () => {
      try {
        await fn(departed, next);
      } catch (e) {
        warn("queueDeparture", "departure handler failed:", e);
      }
    })();
  }
}
