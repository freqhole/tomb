// unified download state management
//
// consolidates all download-related state that was previously scattered across:
// - blobCache.ts (synced tracking keys, loading progress, in-progress fetches)
// - blobResolver.ts (in-progress P2P fetches)
// - autoDownload/manager.ts (active downloads, failed downloads, pause state)
//
// this module is the single source of truth for:
// - which songs are synced locally (see syncTrackingKey - sha256 in
//   browser mode, blake3-preferring in charnel mode, NOT always a sha256)
// - which songs are currently downloading
// - download progress for UI feedback
// - failed downloads and retry tracking
// - pause/resume state

import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { debug, warn } from "../../../utils/logger";
import { isCharnelMode } from "../../../app/services/charnel/mode";
import { initMusicDB } from "../storage/db";
import { syncTrackingKey } from "../storage/types";

// ===== synced songs tracking =====
// tracks which songs (by `syncTrackingKey`) have been synced to local
// storage (OPFS/IDB or grimoire). initialized on app startup from IDB
// (browser) or grimoire (charnel).

const [syncedTrackingKeys, setSyncedTrackingKeys] = createStore<Record<string, boolean>>({});

// version signal to force re-reads when store is bulk-updated
// (solid stores don't track access to non-existent keys, so we need this for initialization)
const [syncedVersion, setSyncedVersion] = createSignal(0);

/** check if a song has been synced to local storage (key: syncTrackingKey(song, isCharnelMode())) */
export function isSongSyncedLocally(trackingKey: string | null | undefined): boolean {
  if (!trackingKey) return false;
  // access version to ensure reactivity when store is bulk-loaded
  syncedVersion();
  return syncedTrackingKeys[trackingKey] ?? false;
}

/** mark a song as synced locally (called after successful sync) */
export function markSongSynced(trackingKey: string): void {
  const wasSynced = syncedTrackingKeys[trackingKey] === true;
  setSyncedTrackingKeys(trackingKey, true);
  // bump version so observers that read `syncedTrackingKeys[trackingKey]`
  // *before* the key existed (solid stores don't subscribe to
  // undefined-key reads) re-run and pick up the new state. without this,
  // a row that rendered an unsynced song will never flip to the
  // underlined "available offline" style after a background sync
  // completes.
  if (!wasSynced) setSyncedVersion((v) => v + 1);
  // persist to IDB in background (browser mode)
  void persistSyncedToIDB(trackingKey, true);
}

/** unmark a song as synced locally (called after deletion from local storage) */
export function unmarkSongSynced(trackingKey: string): void {
  const wasSynced = syncedTrackingKeys[trackingKey] === true;
  setSyncedTrackingKeys(trackingKey, false);
  // mirror of `markSongSynced`: bump so observers re-run after a delete.
  if (wasSynced) setSyncedVersion((v) => v + 1);
  // persist to IDB in background (browser mode)
  void persistSyncedToIDB(trackingKey, false);
}

/** bulk load synced tracking keys (called during initialization) */
export function loadSyncedTrackingKeys(trackingKeys: string[]): void {
  for (const trackingKey of trackingKeys) {
    setSyncedTrackingKeys(trackingKey, true);
  }
  // bump version to trigger re-renders
  setSyncedVersion((v) => v + 1);
  debug("downloadState", `loaded ${trackingKeys.length} synced tracking keys`);
}

/** clear all synced tracking keys (for testing/reset) */
export function clearSyncedTrackingKeys(): void {
  setSyncedTrackingKeys(reconcile({}));
  setSyncedVersion((v) => v + 1);
}

// ===== ephemeral-on-disk tracking =====
// the libmpv backend's `sync_queue_to_local = off` path lands audio in
// `<fetch_dir>/_ephemeral/<blake3>.<ext>` without writing any sqlite
// rows (see client/charnel/src-tauri/src/ephemeral_blob_commands.rs).
// those files are real on-disk audio that the player can replay
// instantly, but `isSongSyncedLocally` returns false for them
// (correctly — they're not in the library). this set lets the queue
// row underline + any other "available offline" UI affordance light
// up for songs that exist as ephemeral files.
//
// keyed by **blake3** (not sha256) because that's what's literally
// on disk — survives across app restarts when the libmpv backend
// reconciles `_ephemeral/` against the persisted queue and seeds
// this set from the survivors.

const [ephemeralOnDiskBlake3s, setEphemeralOnDiskBlake3sSig] = createSignal<Set<string>>(new Set());

/** check if a song has an ephemeral file on disk (libmpv backend + sync-off
 *  path). reactive. pass the song's `blake3` (not sha256) — that's the disk
 *  identifier. */
export function isSongOnDiskEphemeral(blake3: string | null | undefined): boolean {
  if (!blake3) return false;
  return ephemeralOnDiskBlake3s().has(blake3);
}

/** mark an ephemeral file as present on disk (called after `fetch_ephemeral_blob`). */
export function markEphemeralOnDisk(blake3: string): void {
  setEphemeralOnDiskBlake3sSig((prev) => {
    if (prev.has(blake3)) return prev;
    const next = new Set(prev);
    next.add(blake3);
    return next;
  });
}

/** unmark an ephemeral file (called after `delete_ephemeral_blob` / purge). */
export function unmarkEphemeralOnDisk(blake3: string): void {
  setEphemeralOnDiskBlake3sSig((prev) => {
    if (!prev.has(blake3)) return prev;
    const next = new Set(prev);
    next.delete(blake3);
    return next;
  });
}

/** clear all ephemeral-on-disk tracking (called after `purge_ephemeral_dir`). */
export function clearEphemeralOnDisk(): void {
  setEphemeralOnDiskBlake3sSig(new Set<string>());
}

/** bulk-replace the ephemeral-on-disk set. used after a reconcile pass
 *  (or on startup) to seed the signal from what's actually on disk. */
export function setEphemeralOnDiskBlake3s(blake3s: Iterable<string>): void {
  setEphemeralOnDiskBlake3sSig(new Set<string>(blake3s));
}

// persist synced status to IDB (browser mode only)
// charnel mode persists via grimoire sqlite automatically
// NOTE: currently a no-op - synced status is derived from song source_type in IDB
async function persistSyncedToIDB(_trackingKey: string, _synced: boolean): Promise<void> {
  // check if we're in charnel/tauri mode - no IDB persistence needed
  if (isCharnelMode()) return;

  // in browser mode, synced status is derived from whether the song exists
  // in IDB with source_type: "synced" - no separate persistence needed
}

// ===== download progress tracking =====
// tracks media currently being downloaded and their progress.
// keyed generically (a song's sha256, a video's own `id`, etc.) - NOT
// a content hash specifically, just a client-side tracking key. keep
// this generic; do not reintroduce sha256/song-specific naming here.

const [loadingIds, setLoadingIds] = createSignal<Set<string>>(new Set());
const [loadingProgress, setLoadingProgress] = createSignal<Map<string, number | null>>(new Map());

// debounced "visible" loading set - for UI binding only (queue row
// pulse/progress indicators). a load that finishes within
// LOADING_INDICATOR_DEBOUNCE_MS never gets shown at all, avoiding a
// flash of the loading UI for near-instant local/cached hits; a load
// that's genuinely still running after the delay reveals immediately.
const LOADING_INDICATOR_DEBOUNCE_MS = 1000;
const [visibleLoadingIds, setVisibleLoadingIds] = createSignal<Set<string>>(new Set());
const pendingRevealTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** get the set of currently downloading media ids (for UI binding) */
export function getLoadingIds(): Set<string> {
  return loadingIds();
}

/** debounced version of getLoadingIds() for UI loading indicators - only
 *  reflects an id once it's been loading for LOADING_INDICATOR_DEBOUNCE_MS. */
export function getVisibleLoadingIds(): Set<string> {
  return visibleLoadingIds();
}

/** check if a given id is currently being downloaded */
export function isLoading(id: string): boolean {
  return loadingIds().has(id);
}

/** get loading progress for an id (0-1, or null for indeterminate) */
export function getLoadingProgress(id: string): number | null | undefined {
  return loadingProgress().get(id);
}

/** get all loading progress as a map (for UI binding) */
export function getAllLoadingProgress(): Map<string, number | null> {
  return loadingProgress();
}

/** add an id to the loading set */
export function addToLoadingSet(id: string): void {
  debug("downloadState", `loading start: ${id}`);
  setLoadingIds((prev) => {
    if (prev.has(id)) return prev;
    const next = new Set(prev);
    next.add(id);
    return next;
  });
  if (!pendingRevealTimers.has(id)) {
    const timer = setTimeout(() => {
      pendingRevealTimers.delete(id);
      if (loadingIds().has(id)) {
        revealLoadingId(id);
      }
    }, LOADING_INDICATOR_DEBOUNCE_MS);
    pendingRevealTimers.set(id, timer);
  }
}

/** update download progress for an id */
export function updateLoadingProgress(id: string, progress: number | null): void {
  // a progress report for an id nobody registered means the producer and
  // the ui are keyed differently (sha256 vs video id vs mediaItemKey) -
  // the usual cause of "downloads fine, no progress bar".
  if (!loadingIds().has(id)) {
    debug(
      "downloadState",
      `progress for untracked id ${id} (progress=${progress}) - key mismatch?`
    );
  } else {
    debug("downloadState", `progress ${id}: ${progress === null ? "indeterminate" : progress}`);
  }
  // real bytes moving means this is a genuine transfer, not the instant
  // cache hit the reveal debounce exists to hide - show it now. without
  // this only the *current* item ever shows progress, since it's added to
  // the ui set through a separate, undebounced path (see AppLayout).
  if (typeof progress === "number" && loadingIds().has(id)) {
    revealLoadingId(id);
  }
  setLoadingProgress((prev) => {
    const next = new Map(prev);
    next.set(id, progress);
    return next;
  });
}

/** move an id into the ui-visible loading set immediately. */
function revealLoadingId(id: string): void {
  const timer = pendingRevealTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    pendingRevealTimers.delete(id);
  }
  setVisibleLoadingIds((prev) => {
    if (prev.has(id)) return prev;
    const next = new Set(prev);
    next.add(id);
    return next;
  });
}

/** remove an id from the loading set and clear its progress */
export function removeFromLoadingSet(id: string): void {
  debug(
    "downloadState",
    `loading end: ${id} (last progress=${loadingProgress().get(id) ?? "none"})`
  );
  setLoadingIds((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });
  setLoadingProgress((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Map(prev);
    next.delete(id);
    return next;
  });
  const timer = pendingRevealTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    pendingRevealTimers.delete(id);
  }
  setVisibleLoadingIds((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });
}

/** clear all loading-set/progress/reveal-timer state (test-only reset,
 *  mirrors clearSyncedTrackingKeys/clearEphemeralOnDisk/clearAllFailures above). */
export function resetLoadingState(): void {
  setLoadingIds(new Set<string>());
  setLoadingProgress(new Map<string, number | null>());
  setVisibleLoadingIds(new Set<string>());
  for (const timer of pendingRevealTimers.values()) clearTimeout(timer);
  pendingRevealTimers.clear();
}

/** runs `run(onProgress)`, wrapping it in the standard addToLoadingSet /
 *  updateLoadingProgress / removeFromLoadingSet lifecycle (cleanup
 *  guaranteed via `finally`, even on throw) - collapses the ~10 near-
 *  identical hand-rolled copies of this exact dance across audioAccess.ts,
 *  blobCache.ts, blobResolver.ts, libmpvBackend.ts, autoDownload/manager.ts,
 *  syncVideoToLocal.ts, videoBackend.ts.
 *  callers that need a fallthrough-on-failure shape (return a sentinel
 *  from `run` and check it after) still work fine - this only owns the
 *  loading-state bookkeeping, not the caller's own control flow. */
export async function withLoadingProgress<T>(
  id: string,
  run: (onProgress: (progress: number | null) => void) => Promise<T>
): Promise<T> {
  addToLoadingSet(id);
  try {
    return await run((progress) => updateLoadingProgress(id, progress));
  } finally {
    removeFromLoadingSet(id);
  }
}

// ===== in-progress download tracking =====
// tracks downloads currently in flight to prevent duplicates
// keyed by syncTrackingKey (see that function's doc comment) - NOT
// always a literal sha256, despite the param name history.

const inProgressDownloads = new Map<string, Promise<void>>();
const [activeDownloadCount, setActiveDownloadCount] = createSignal(0);

/** get the count of active downloads (for throttling) */
export function getActiveDownloadCount(): number {
  return activeDownloadCount();
}

/** check if a download is in progress for this tracking key */
export function isDownloadInProgress(trackingKey: string): boolean {
  return inProgressDownloads.has(trackingKey);
}

/** get the in-progress promise for a tracking key (for awaiting) */
export function getInProgressDownload(trackingKey: string): Promise<void> | undefined {
  return inProgressDownloads.get(trackingKey);
}

/** register a download as in-progress */
export function registerDownload(trackingKey: string, promise: Promise<void>): void {
  inProgressDownloads.set(trackingKey, promise);
  setActiveDownloadCount(inProgressDownloads.size);
  // auto-cleanup when done
  promise.finally(() => {
    inProgressDownloads.delete(trackingKey);
    setActiveDownloadCount(inProgressDownloads.size);
  });
}

/** check if we should start a download (not synced AND not in progress) */
export function canStartDownload(trackingKey: string | null | undefined): boolean {
  if (!trackingKey) return false;
  if (isSongSyncedLocally(trackingKey)) return false;
  if (isDownloadInProgress(trackingKey)) return false;
  return true;
}

// ===== failed downloads tracking =====
// tracks downloads that have failed and their retry counts

export const MAX_RETRY_ATTEMPTS = 3;
const failedDownloads = new Map<string, number>();

/** check if a download has permanently failed (exhausted retries) */
export function hasFailedPermanently(trackingKey: string): boolean {
  return (failedDownloads.get(trackingKey) ?? 0) >= MAX_RETRY_ATTEMPTS;
}

/** mark a download as failed and increment retry count */
export function markDownloadFailed(trackingKey: string): number {
  const attempts = (failedDownloads.get(trackingKey) ?? 0) + 1;
  failedDownloads.set(trackingKey, attempts);
  return attempts;
}

/** get retry count for a tracking key */
export function getRetryCount(trackingKey: string): number {
  return failedDownloads.get(trackingKey) ?? 0;
}

/** clear failure tracking for a tracking key (e.g., when user manually retries) */
export function clearFailure(trackingKey: string): void {
  failedDownloads.delete(trackingKey);
}

/** clear all failure tracking (e.g., when auto-download is toggled on) */
export function clearAllFailures(): void {
  failedDownloads.clear();
}

// ===== pause/resume state =====
// global pause state for downloads (player downloads for current song override)

const [isPaused, setIsPaused] = createSignal(false);

/** check if downloads are paused */
export function isDownloadsPaused(): boolean {
  return isPaused();
}

/** pause all downloads (player downloads for playback still work) */
export function pauseDownloads(): void {
  setIsPaused(true);
  debug("downloadState", "downloads paused");
}

/** resume downloads */
export function resumeDownloads(): void {
  setIsPaused(false);
  clearAllFailures(); // allow one more retry round
  debug("downloadState", "downloads resumed");
}

// ===== initialization =====
// load synced tracking keys from storage on app startup

/** initialize synced tracking keys from grimoire (charnel mode) */
async function initFromGrimoire(): Promise<void> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { invoke } = await import("@tauri-apps/api/core");
    const response = (await invoke("api_call", {
      path: "/api/sync/blake3s",
      body: null,
    })) as { success: boolean; data?: string[]; message?: string };

    if (response.success && response.data) {
      loadSyncedTrackingKeys(response.data);
      debug(
        "downloadState",
        `initialized ${response.data.length} synced tracking keys from grimoire`
      );
    } else {
      warn(
        "downloadState",
        `failed to fetch synced tracking keys from grimoire: ${response.message ?? "unknown error"}`
      );
    }
  } catch (err) {
    warn("downloadState", "failed to initialize synced tracking keys from grimoire:", err);
  }
}

/** initialize synced tracking keys from IDB (browser mode) */
async function initFromIDB(): Promise<void> {
  try {
    const db = await initMusicDB();

    const tx = db.transaction("songs", "readonly");
    const store = tx.objectStore("songs");
    const index = store.index("by_source_type");
    const syncedSongs = await index.getAll("synced");

    const trackingKeys = syncedSongs
      .map((song) => syncTrackingKey(song))
      .filter((key): key is string => !!key);

    loadSyncedTrackingKeys(trackingKeys);
    debug("downloadState", `initialized ${trackingKeys.length} synced tracking keys from IDB`);
  } catch (err) {
    warn("downloadState", "failed to initialize synced tracking keys from IDB:", err);
  }
}

/** initialize download state (call on app startup) */
export async function initDownloadState(): Promise<void> {
  const isCharnel = isCharnelMode();

  if (isCharnel) {
    await initFromGrimoire();
  } else {
    await initFromIDB();
  }
}
