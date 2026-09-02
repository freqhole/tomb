// cancellation generations for asynchronous media loads.
//
// resolving a playable source can await a sync, a blob fetch, or a local-path
// lookup. queue edits can happen while that work is in flight. a late result
// must never begin playback after its item has left the queue.

const generationByKey = new Map<string, number>();

/** begin a new load attempt for this media item and return its generation. */
export function beginMediaLoad(key: string): number {
  const generation = (generationByKey.get(key) ?? 0) + 1;
  generationByKey.set(key, generation);
  return generation;
}

/** invalidate outstanding load attempts for items that left the queue. */
export function cancelMediaLoads(keys: Iterable<string>): void {
  for (const key of keys) {
    generationByKey.set(key, (generationByKey.get(key) ?? 0) + 1);
  }
}

/** true only while the caller's load attempt remains current. */
export function isMediaLoadCurrent(key: string, generation: number | undefined): boolean {
  return generation === undefined || generationByKey.get(key) === generation;
}
