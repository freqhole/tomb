// single-flight for keyed async work.
//
// every `getOrCreate*` helper in the local library does a read, awaits, then
// writes. with concurrent syncs (the auto-download manager runs 3 at once)
// several callers for the same key all miss the read and all create a row -
// which is how duplicate series/artists/albums appear in the local library.
//
// callers for the same key share one in-flight promise instead. this covers
// concurrency within a tab, which is where the duplication comes from; it is
// not a cross-tab lock (that would need the whole read+write in one IDB
// readwrite transaction).

const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = (async () => {
    try {
      return await fn();
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
