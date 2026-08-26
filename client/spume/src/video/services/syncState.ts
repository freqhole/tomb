// reactive tracking of which remote videos have a local (opfs-backed) copy
// synced via syncVideoToLocal.ts — mirrors music's isSongSyncedLocally
// pattern (music/services/download/downloadState.ts) but scoped to the
// video domain so a queued `QueuedVideo` snapshot (still `source_type:
// "remote"`) can flip its "cached locally" UI state (e.g. the queue row's
// duration underline) the moment a background sync completes, without
// waiting for the queue item itself to be refreshed/re-looked-up.
//
// charnel/tauri mode never syncs videos (see syncVideoToLocal.ts), so this
// only needs to be seeded from IDB, not grimoire.

import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { debug, warn } from "../../utils/logger";
import { getLocalVideos } from "./storage/db/videos";

const [syncedVideoIds, setSyncedVideoIds] = createStore<Record<string, boolean>>({});

// version signal to force re-reads when the store is bulk-updated (solid
// stores don't track access to not-yet-existing keys)
const [syncedVersion, setSyncedVersion] = createSignal(0);

/** check if a video has been synced to local storage (by id). reactive. */
export function isVideoSyncedLocally(id: string | null | undefined): boolean {
  if (!id) return false;
  syncedVersion();
  return syncedVideoIds[id] ?? false;
}

/** mark a video as synced locally (called after a successful sync) */
export function markVideoSynced(id: string): void {
  const wasSynced = syncedVideoIds[id] === true;
  setSyncedVideoIds(id, true);
  if (!wasSynced) setSyncedVersion((v) => v + 1);
}

/** unmark a video as synced locally (called after deletion from local storage) */
export function unmarkVideoSynced(id: string): void {
  const wasSynced = syncedVideoIds[id] === true;
  setSyncedVideoIds(id, false);
  if (wasSynced) setSyncedVersion((v) => v + 1);
}

/** bulk load synced video ids (called during initialization) */
export function loadSyncedVideoIds(ids: string[]): void {
  for (const id of ids) {
    setSyncedVideoIds(id, true);
  }
  setSyncedVersion((v) => v + 1);
  debug("videoSyncState", `loaded ${ids.length} synced video ids`);
}

/** clear all synced video ids (for testing/reset) */
export function clearSyncedVideoIds(): void {
  setSyncedVideoIds(reconcile({}));
  setSyncedVersion((v) => v + 1);
}

/** seed synced video ids from IDB on app startup (browser mode only) */
export async function initVideoSyncState(): Promise<void> {
  try {
    // local rows include both genuinely-imported videos and synced-from-
    // remote copies (no distinct source_type for the latter) - loading
    // both is harmless since a genuinely-local queue item's underline
    // already comes from its own source_type check, never this store.
    const result = await getLocalVideos({ limit: 10000, offset: 0 });
    const ids = result.items.map((v) => v.id);
    loadSyncedVideoIds(ids);
  } catch (err) {
    warn("videoSyncState", "failed to initialize synced video ids from IDB:", err);
  }
}
