// unified download state management
//
// consolidates all download-related state that was previously scattered across:
// - blobCache.ts (synced sha256s, loading progress, in-progress fetches)
// - blobResolver.ts (in-progress P2P fetches)
// - autoDownload/manager.ts (active downloads, failed downloads, pause state)
//
// this module is the single source of truth for:
// - which songs are synced locally (by sha256)
// - which songs are currently downloading
// - download progress for UI feedback
// - failed downloads and retry tracking
// - pause/resume state

import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { debug, warn } from "../../../utils/logger";

// ===== synced songs tracking =====
// tracks which sha256s have been synced to local storage (OPFS/IDB or grimoire)
// initialized on app startup from IDB (browser) or grimoire (charnel)

const [syncedSha256s, setSyncedSha256s] = createStore<Record<string, boolean>>({});

// version signal to force re-reads when store is bulk-updated
// (solid stores don't track access to non-existent keys, so we need this for initialization)
const [syncedVersion, setSyncedVersion] = createSignal(0);

/** check if a song has been synced to local storage (by sha256) */
export function isSongSyncedLocally(sha256: string | null | undefined): boolean {
  if (!sha256) return false;
  // access version to ensure reactivity when store is bulk-loaded
  syncedVersion();
  return syncedSha256s[sha256] ?? false;
}

/** mark a song as synced locally (called after successful sync) */
export function markSongSynced(sha256: string): void {
  const wasSynced = syncedSha256s[sha256] === true;
  setSyncedSha256s(sha256, true);
  // bump version so observers that read `syncedSha256s[sha256]` *before*
  // the key existed (solid stores don't subscribe to undefined-key reads)
  // re-run and pick up the new state. without this, a row that rendered
  // an unsynced song will never flip to the underlined "available offline"
  // style after a background sync completes.
  if (!wasSynced) setSyncedVersion((v) => v + 1);
  // persist to IDB in background (browser mode)
  void persistSyncedToIDB(sha256, true);
}

/** unmark a song as synced locally (called after deletion from local storage) */
export function unmarkSongSynced(sha256: string): void {
  const wasSynced = syncedSha256s[sha256] === true;
  setSyncedSha256s(sha256, false);
  // mirror of `markSongSynced`: bump so observers re-run after a delete.
  if (wasSynced) setSyncedVersion((v) => v + 1);
  // persist to IDB in background (browser mode)
  void persistSyncedToIDB(sha256, false);
}

/** bulk load synced sha256s (called during initialization) */
export function loadSyncedSha256s(sha256s: string[]): void {
  for (const sha256 of sha256s) {
    setSyncedSha256s(sha256, true);
  }
  // bump version to trigger re-renders
  setSyncedVersion((v) => v + 1);
  debug("downloadState", `loaded ${sha256s.length} synced sha256s`);
}

/** clear all synced sha256s (for testing/reset) */
export function clearSyncedSha256s(): void {
  setSyncedSha256s(reconcile({}));
  setSyncedVersion((v) => v + 1);
}

// ===== ephemeral-on-disk tracking =====
// rodio backend's `sync_queue_to_local = off` path lands audio in
// `<fetch_dir>/_ephemeral/<blake3>.<ext>` without writing any sqlite
// rows (see client/charnel/src-tauri/src/ephemeral_blob_commands.rs).
// those files are real on-disk audio that the player can replay
// instantly, but `isSongSyncedLocally` returns false for them
// (correctly — they're not in the library). this set lets the queue
// row underline + any other "available offline" UI affordance light
// up for songs that exist as ephemeral files.
//
// keyed by **blake3** (not sha256) because that's what's literally
// on disk — survives across app restarts when the rodio backend
// reconciles `_ephemeral/` against the persisted queue and seeds
// this set from the survivors.

const [ephemeralOnDiskBlake3s, setEphemeralOnDiskBlake3sSig] = createSignal<Set<string>>(new Set());

/** check if a song has an ephemeral file on disk (rodio + sync-off path). reactive.
 *  pass the song's `blake3` (not sha256) — that's the disk identifier. */
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
async function persistSyncedToIDB(_sha256: string, _synced: boolean): Promise<void> {
  // check if we're in charnel/tauri mode - no IDB persistence needed
  const isCharnel = typeof window !== "undefined" && "__TAURI__" in window;
  if (isCharnel) return;

  // in browser mode, synced status is derived from whether the song exists
  // in IDB with source_type: "synced" - no separate persistence needed
}

// ===== download progress tracking =====
// tracks songs currently being downloaded and their progress

const [loadingSha256s, setLoadingSha256s] = createSignal<Set<string>>(new Set());
const [loadingProgress, setLoadingProgress] = createSignal<Map<string, number | null>>(new Map());

/** get the set of currently downloading song sha256s (for UI binding) */
export function getLoadingSongIds(): Set<string> {
  return loadingSha256s();
}

/** check if a song is currently being downloaded */
export function isLoading(sha256: string): boolean {
  return loadingSha256s().has(sha256);
}

/** get loading progress for a song (0-1, or null for indeterminate) */
export function getLoadingProgress(sha256: string): number | null | undefined {
  return loadingProgress().get(sha256);
}

/** get all loading progress as a map (for UI binding) */
export function getAllLoadingProgress(): Map<string, number | null> {
  return loadingProgress();
}

/** add a sha256 to the loading set */
export function addToLoadingSet(sha256: string): void {
  setLoadingSha256s((prev) => {
    if (prev.has(sha256)) return prev;
    const next = new Set(prev);
    next.add(sha256);
    return next;
  });
}

/** update download progress for a sha256 */
export function updateLoadingProgress(sha256: string, progress: number | null): void {
  setLoadingProgress((prev) => {
    const next = new Map(prev);
    next.set(sha256, progress);
    return next;
  });
}

/** remove a sha256 from the loading set and clear its progress */
export function removeFromLoadingSet(sha256: string): void {
  setLoadingSha256s((prev) => {
    if (!prev.has(sha256)) return prev;
    const next = new Set(prev);
    next.delete(sha256);
    return next;
  });
  setLoadingProgress((prev) => {
    if (!prev.has(sha256)) return prev;
    const next = new Map(prev);
    next.delete(sha256);
    return next;
  });
}

// ===== in-progress download tracking =====
// tracks downloads currently in flight to prevent duplicates
// keyed by sha256 (universal identifier)

const inProgressDownloads = new Map<string, Promise<void>>();
const [activeDownloadCount, setActiveDownloadCount] = createSignal(0);

/** get the count of active downloads (for throttling) */
export function getActiveDownloadCount(): number {
  return activeDownloadCount();
}

/** check if a download is in progress for this sha256 */
export function isDownloadInProgress(sha256: string): boolean {
  return inProgressDownloads.has(sha256);
}

/** get the in-progress promise for a sha256 (for awaiting) */
export function getInProgressDownload(sha256: string): Promise<void> | undefined {
  return inProgressDownloads.get(sha256);
}

/** register a download as in-progress */
export function registerDownload(sha256: string, promise: Promise<void>): void {
  inProgressDownloads.set(sha256, promise);
  setActiveDownloadCount(inProgressDownloads.size);
  // auto-cleanup when done
  promise.finally(() => {
    inProgressDownloads.delete(sha256);
    setActiveDownloadCount(inProgressDownloads.size);
  });
}

/** check if we should start a download (not synced AND not in progress) */
export function canStartDownload(sha256: string | null | undefined): boolean {
  if (!sha256) return false;
  if (isSongSyncedLocally(sha256)) return false;
  if (isDownloadInProgress(sha256)) return false;
  return true;
}

// ===== failed downloads tracking =====
// tracks downloads that have failed and their retry counts

export const MAX_RETRY_ATTEMPTS = 3;
const failedDownloads = new Map<string, number>();

/** check if a download has permanently failed (exhausted retries) */
export function hasFailedPermanently(sha256: string): boolean {
  return (failedDownloads.get(sha256) ?? 0) >= MAX_RETRY_ATTEMPTS;
}

/** mark a download as failed and increment retry count */
export function markDownloadFailed(sha256: string): number {
  const attempts = (failedDownloads.get(sha256) ?? 0) + 1;
  failedDownloads.set(sha256, attempts);
  return attempts;
}

/** get retry count for a sha256 */
export function getRetryCount(sha256: string): number {
  return failedDownloads.get(sha256) ?? 0;
}

/** clear failure tracking for a sha256 (e.g., when user manually retries) */
export function clearFailure(sha256: string): void {
  failedDownloads.delete(sha256);
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
// load synced sha256s from storage on app startup

/** initialize synced sha256s from grimoire (charnel mode) */
async function initFromGrimoire(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke("api_call", {
      path: "/api/sync/sha256s",
      body: null,
    }) as { success: boolean; data?: string[]; message?: string };

    if (response.success && response.data) {
      loadSyncedSha256s(response.data);
      debug("downloadState", `initialized ${response.data.length} synced sha256s from grimoire`);
    } else {
      warn("downloadState", `failed to fetch sha256s from grimoire: ${response.message ?? "unknown error"}`);
    }
  } catch (err) {
    warn("downloadState", "failed to initialize synced sha256s from grimoire:", err);
  }
}

/** initialize synced sha256s from IDB (browser mode) */
async function initFromIDB(): Promise<void> {
  try {
    const { initMusicDB } = await import("../storage/db");
    const db = await initMusicDB();
    
    const tx = db.transaction("songs", "readonly");
    const store = tx.objectStore("songs");
    const index = store.index("by_source_type");
    const syncedSongs = await index.getAll("synced");
    
    const sha256s = syncedSongs
      .map((song) => song.sha256)
      .filter((sha256): sha256 is string => !!sha256);
    
    loadSyncedSha256s(sha256s);
    debug("downloadState", `initialized ${sha256s.length} synced sha256s from IDB`);
  } catch (err) {
    warn("downloadState", "failed to initialize synced sha256s from IDB:", err);
  }
}

/** initialize download state (call on app startup) */
export async function initDownloadState(): Promise<void> {
  const isCharnel = typeof window !== "undefined" && "__TAURI__" in window;
  
  if (isCharnel) {
    await initFromGrimoire();
  } else {
    await initFromIDB();
  }
}
