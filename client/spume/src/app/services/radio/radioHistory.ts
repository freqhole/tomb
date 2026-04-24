// radio track history (IDB-backed, capped, infinite-scrolling reads)
//
// stores one row per (station, song_id) transition observed by the
// listener. designed to back the right-column history list in
// RadioView. capped at MAX_RADIO_HISTORY entries; oldest rows are
// trimmed on every write.
//
// keyed by uuid; sorted via the `by_played_at` index (descending reads).

import { initAppDB } from "../storage/db";
import { STORE_RADIO_HISTORY, type RadioHistoryEntry } from "../storage/types";
import { generateUUID } from "../../../utils/uuid";
import { debug } from "../../../utils/logger";

export const MAX_RADIO_HISTORY = 1000;

/** insert one history row. caller is responsible for de-duping (only call on track change). */
export async function recordHistoryEntry(
  partial: Omit<RadioHistoryEntry, "id" | "played_at">,
): Promise<RadioHistoryEntry> {
  const db = await initAppDB();
  const entry: RadioHistoryEntry = {
    ...partial,
    id: generateUUID(),
    played_at: Date.now(),
  };
  await db.put(STORE_RADIO_HISTORY, entry);
  // opportunistic trim — cheap with the index.
  await trimToCap();
  return entry;
}

/** read a page of history entries (newest-first). pass `before` to paginate. */
export async function getHistoryPage(opts: {
  before?: number; // played_at cursor (exclusive)
  limit: number;
  stationId?: string | null; // optional filter
}): Promise<RadioHistoryEntry[]> {
  const db = await initAppDB();
  const tx = db.transaction(STORE_RADIO_HISTORY, "readonly");
  const idx = tx.store.index("by_played_at");
  // open a descending cursor; iterate until we've collected `limit`.
  const upper = opts.before !== undefined ? IDBKeyRange.upperBound(opts.before, true) : null;
  const out: RadioHistoryEntry[] = [];
  let cursor = upper
    ? await idx.openCursor(upper, "prev")
    : await idx.openCursor(null, "prev");
  while (cursor && out.length < opts.limit) {
    const v = cursor.value as RadioHistoryEntry;
    if (opts.stationId === undefined || v.station_id === opts.stationId) {
      out.push(v);
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return out;
}

/** delete every history row. */
export async function clearHistory(): Promise<void> {
  const db = await initAppDB();
  await db.clear(STORE_RADIO_HISTORY);
  debug("radio-history", "cleared all entries");
}

/** count rows (for the clear-button confirmation copy). */
export async function countHistory(): Promise<number> {
  const db = await initAppDB();
  return db.count(STORE_RADIO_HISTORY);
}

/** delete oldest rows past MAX_RADIO_HISTORY. */
async function trimToCap(): Promise<void> {
  const db = await initAppDB();
  const total = await db.count(STORE_RADIO_HISTORY);
  if (total <= MAX_RADIO_HISTORY) return;
  const excess = total - MAX_RADIO_HISTORY;
  const tx = db.transaction(STORE_RADIO_HISTORY, "readwrite");
  const idx = tx.store.index("by_played_at");
  let cursor = await idx.openCursor(null, "next"); // ascending = oldest first
  let deleted = 0;
  while (cursor && deleted < excess) {
    await cursor.delete();
    deleted++;
    cursor = await cursor.continue();
  }
  await tx.done;
  debug("radio-history", `trimmed ${deleted} oldest entries`);
}
