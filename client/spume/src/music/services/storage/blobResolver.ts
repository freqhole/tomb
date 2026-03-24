// blob resolver - resolves blob IDs to URLs for any transport type
//
// for HTTP remotes: returns direct URLs (browser handles auth via cookies/api key)
// for P2P remotes: fetches via transport, caches in Cache API, returns blob URL
// for Tauri-managed remotes: uses IPC to get local file path, returns asset:// URL
//
// usage:
//   const url = await resolveBlobUrl(blobId, remoteId, "audio");
//   <img src={url} /> or <audio src={url} />

import { createSignal, createMemo, type Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { getSyncQueueToLocal } from "../../../app/services/storage/db";
import {
  getTransportForRemote,
  isP2PTransportType,
  isCharnelAvailable,
  type Remote,
} from "../../../app/api/client";
import { type BlobProgressCallback } from "freqhole-api-client";
import { debug } from "../../../utils/logger";
import { 
  getRemoteCacheName, 
  saveP2PBlobMetadata, 
  getCachedBlob,
} from "../cache/blobCache";
import {
  updateLoadingProgress,
  addToLoadingSet,
  removeFromLoadingSet,
} from "../download";
import { syncSongToLocal, canSyncSong } from "../sync";
import { queryClient } from "../../../queryClient";
import { queryKeys } from "../../queries/queryKeys";
import type { Song } from "./types";

// store of active blob URLs - provides granular reactivity per key
// keyed by `${remoteId}/${blobId}` -> URL string
// using store instead of signal<Map> so each key can be tracked independently
const [activeBlobUrls, setActiveBlobUrls] = createStore<Record<string, string>>({});

// helper to add a URL to the reactive store
function addActiveBlobUrl(key: string, url: string) {
  debug("blobResolver", `adding to activeBlobUrls store: ${key.split('/')[1]?.slice(0, 8) ?? key.slice(0, 8)}...`);
  setActiveBlobUrls(key, url);
}

// helper to remove a URL from the reactive store
function removeActiveBlobUrl(key: string) {
  setActiveBlobUrls(key, undefined as unknown as string);
}

// helper to clear all URLs from the reactive store
function clearActiveBlobUrls() {
  setActiveBlobUrls(reconcile({}));
}

// reactive set of P2P blob sha256s currently being fetched (for UI loading indicators)
// NOTE: now deprecated - P2P loading uses blobCache's unified loading set
// kept for backward compatibility with AppLayout.tsx
const [loadingP2PSha256s, _setLoadingP2PSha256s] = createSignal<Set<string>>(new Set());

// get the set of currently loading P2P song sha256s (for UI binding)
// NOTE: now deprecated - returns empty set since P2P loading uses blobCache's unified loading set
export function getLoadingP2PSongIds(): Set<string> {
  return loadingP2PSha256s();
}

// track in-progress P2P fetches with their promises so callers can await them
const inProgressP2PFetches = new Map<string, Promise<string>>();

// track abort controllers for cancellable downloads
const inProgressAbortControllers = new Map<string, AbortController>();

// re-export transport cache functions for backward compatibility
export {
  isP2PRemoteSync,
  isCharnelManagedRemoteSync,
  cacheTransportType,
  preCacheRemoteTransport,
  isP2PRemote,
  usesBlobResolver,
  getRemoteTransportType,
} from "./transportCache";

// import functions from transportCache for local use
import { cacheTransportType, isP2PRemote } from "./transportCache";

// valid thumbnail sizes (must match server config)
export type ThumbnailSize = 50 | 200;

/**
 * resolve a blob ID to a URL for display/playback.
 *
 * @param blobId - the blob ID (sha256 or server blob ID)
 * @param remoteId - the remote server ID (for looking up transport type)
 * @param type - the blob type ("audio" or "image") for cache metadata tracking
 * @param onProgress - optional callback for download progress
 * @param thumbnailSize - optional thumbnail size (50 or 200px) - uses original if not specified
 * @param blake3 - optional blake3 hash for verified streaming via iroh-blobs
 * @returns URL string usable in <img src> or <audio src>
 */
export async function resolveBlobUrl(
  blobId: string,
  remoteId: string,
  type: "audio" | "image" = "image",
  onProgress?: BlobProgressCallback,
  thumbnailSize?: ThumbnailSize,
  blake3?: string,
): Promise<string> {
  // include thumbnail size in cache key so different sizes are cached separately
  const cacheKey = thumbnailSize 
    ? `${remoteId}/${blobId}/thumb/${thumbnailSize}`
    : `${remoteId}/${blobId}`;
  
  // check if we already have an active blob URL (fast path, no logging)
  const cached = activeBlobUrls[cacheKey];
  if (cached) {
    return cached;
  }

  const remote = await getRemoteById(remoteId);
  if (!remote) {
    throw new Error(`remote not found: ${remoteId}`);
  }

  // cache transport info for future sync lookups (reduces flicker)
  cacheTransportType(remoteId, remote.transport, remote.is_charnel_managed ?? false);

  // check if this is a P2P remote or Tauri-managed remote (both use transport for blobs)
  const isP2P = isP2PTransportType(remote);
  const isCharnel = isCharnelAvailable() && remote.is_charnel_managed;
  if (isP2P || isCharnel) {
    // check if there's already a fetch in progress for this blob
    // if so, wait for it instead of starting a duplicate fetch
    const inProgress = inProgressP2PFetches.get(cacheKey);
    if (inProgress) {
      debug("blobResolver", `waiting for in-progress fetch: ${blobId.slice(0, 8)}...`);
      return inProgress;
    }
    
    // only log when we're actually starting a new fetch
    const transportType = remote.is_charnel_managed ? "tauri" : "P2P";
    debug("blobResolver", `starting ${transportType} fetch for ${blobId.slice(0, 8)}...`);
    
    // create AbortController for cancellable downloads
    const abortController = new AbortController();
    inProgressAbortControllers.set(cacheKey, abortController);
    
    // start the fetch and track it
    // note: P2P thumbnail support requires proxy_request - use original blob for now
    // TODO: add P2P thumbnail support via proxy_request to /api/blobs/{id}/thumb/{size}
    const fetchPromise = resolveP2PBlob(blobId, remote, cacheKey, type, onProgress, blake3, abortController.signal);
    inProgressP2PFetches.set(cacheKey, fetchPromise);
    
    try {
      const url = await fetchPromise;
      return url;
    } finally {
      inProgressP2PFetches.delete(cacheKey);
      inProgressAbortControllers.delete(cacheKey);
    }
  } else {
    // HTTP transport - return direct URL (with thumbnail suffix if requested)
    // SAFEGUARD: charnel-managed remotes should never use base_url (they use transport)
    if (remote.is_charnel_managed) {
      throw new Error(`charnel-managed remote ${remoteId} should use transport, not base_url`);
    }
    const basePath = `${remote.base_url}/api/blobs/${blobId}`;
    return thumbnailSize ? `${basePath}/thumb/${thumbnailSize}` : basePath;
  }
}

/**
 * resolve a blob via transport (P2P or Tauri local).
 * for P2P: checks Cache API first, then fetches from peer if not cached.
 * for Tauri: uses IPC to get local file path, returns asset:// URL.
 * @param onProgress - optional callback for download progress (received, total)
 * @param blake3 - optional blake3 hash for verified streaming via iroh-blobs
 * @param signal - optional AbortSignal for cancellation
 */
async function resolveP2PBlob(
  blobId: string,
  remote: Remote,
  cacheKey: string,
  type: "audio" | "image",
  onProgress?: BlobProgressCallback,
  blake3?: string,
  signal?: AbortSignal,
): Promise<string> {
  // check if already cancelled
  if (signal?.aborted) {
    throw new Error("download cancelled");
  }

  // Tauri-managed remotes don't need Cache API - files are local
  if (isCharnelAvailable() && remote.is_charnel_managed) {
    debug("blobResolver", `resolving local blob via Tauri IPC: ${blobId.slice(0, 8)}...`);
    const transport = await getTransportForRemote(remote);
    const url = await transport.getBlobUrl(blobId, blake3);
    addActiveBlobUrl(cacheKey, url);
    debug("blobResolver", `resolved local blob: ${blobId.slice(0, 8)}... -> ${url.slice(0, 30)}...`);
    return url;
  }
  
  // P2P remotes - check Cache API first, blob might be cached from a previous session
  // use getCachedBlob to properly check metadata status (filters out incomplete downloads)
  try {
    const response = await getCachedBlob(remote.remote_id, blobId);
    if (response) {
      debug("blobResolver", `cache hit for P2P blob: ${blobId.slice(0, 8)}...`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      addActiveBlobUrl(cacheKey, url);
      // metadata was already updated by getCachedBlob
      return url;
    }
  } catch (err) {
    debug("blobResolver", `cache check failed for ${blobId.slice(0, 8)}...: ${err}`);
  }

  // not in cache - fetch from peer
  if (!remote.peer_addr) {
    throw new Error(`remote ${remote.remote_id} has no peer_addr for P2P transport`);
  }

  debug("blobResolver", `fetching from peer: ${blobId.slice(0, 8)}...${blake3 ? ` (verified: ${blake3.slice(0, 8)}...)` : ""}`);

  // get transport - handles wasm/app differences internally
  const transport = await getTransportForRemote(remote);
  
  // create abort promise that rejects when signal fires
  const abortPromise = signal 
    ? new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("download cancelled")), { once: true });
      })
    : null;
  
  // create download promise
  const downloadPromise = (async () => {
    // use progress-enabled fetch if callback provided and transport supports it
    // pass blake3 for verified streaming via iroh-blobs
    let url: string;
    if (onProgress && transport.getBlobUrlWithProgress) {
      url = await transport.getBlobUrlWithProgress(blobId, onProgress, blake3);
    } else {
      url = await transport.getBlobUrl(blobId, blake3);
    }
    return url;
  })();
  
  // race download against abort signal
  const url = abortPromise 
    ? await Promise.race([downloadPromise, abortPromise])
    : await downloadPromise;

  // track the URL for cleanup and trigger reactive updates
  addActiveBlobUrl(cacheKey, url);

  // save metadata for P2P-cached blobs so stats tracking works
  void saveP2PBlobMetadata(remote.remote_id, blobId, type);

  debug("blobResolver", `fetched P2P blob: ${blobId.slice(0, 8)}...`);
  return url;
}

/**
 * revoke a cached blob URL to free memory.
 * call this when an image/audio element is removed from the DOM.
 */
export function revokeBlobUrl(blobId: string, remoteId: string, thumbnailSize?: ThumbnailSize): void {
  const cacheKey = thumbnailSize 
    ? `${remoteId}/${blobId}/thumb/${thumbnailSize}`
    : `${remoteId}/${blobId}`;
  const url = activeBlobUrls[cacheKey];
  if (url) {
    // only revoke blob: URLs (not http: URLs)
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
    removeActiveBlobUrl(cacheKey);
    debug("blobResolver", `revoked blob URL for ${blobId.slice(0, 8)}...`);
  }
}

/**
 * cancel an in-progress P2P download.
 * call this when a song is removed from the queue to free network resources.
 * 
 * @param blobId - blob ID being downloaded  
 * @param remoteId - remote ID the download is from
 */
export function cancelP2PDownload(blobId: string, remoteId: string): void {
  const cacheKey = `${remoteId}/${blobId}`;
  const controller = inProgressAbortControllers.get(cacheKey);
  if (controller) {
    debug("blobResolver", `cancelling P2P download: ${blobId.slice(0, 8)}...`);
    controller.abort();
    inProgressAbortControllers.delete(cacheKey);
  }
}

/**
 * synchronously check if a P2P blob URL is already cached.
 * use this for instant render without async lookup.
 * reactive - components re-render when THIS key changes (granular tracking).
 */
export function getCachedP2PBlobUrl(blobId: string, remoteId: string, thumbnailSize?: ThumbnailSize): string | null {
  const cacheKey = thumbnailSize 
    ? `${remoteId}/${blobId}/thumb/${thumbnailSize}`
    : `${remoteId}/${blobId}`;
  return activeBlobUrls[cacheKey] ?? null;
}

/**
 * build an HTTP blob URL with optional thumbnail size.
 * use for direct HTTP remotes (not P2P).
 */
export function buildHttpBlobUrl(baseUrl: string, blobId: string, thumbnailSize?: ThumbnailSize): string {
  const basePath = `${baseUrl}/api/blobs/${blobId}`;
  return thumbnailSize ? `${basePath}/thumb/${thumbnailSize}` : basePath;
}

/**
 * reactive hook for resolving P2P image URLs.
 * returns a memo that tracks the P2P cache and triggers fetch if needed.
 * 
 * usage:
 *   const url = useResolvedP2PImageUrl(() => ({ blobId, remoteId, httpFallback }));
 *   <div style={{ "background-image": `url(${url()})` }} />
 * 
 * @param source - accessor returning blob ID, remote ID, and optional HTTP fallback URL
 * @returns accessor that returns URL string or undefined
 */
export function useResolvedP2PImageUrl(
  source: Accessor<{ blobId?: string; remoteId?: string; httpFallback?: string | null } | undefined>
): Accessor<string | undefined> {
  return createMemo(() => {
    const s = source();
    if (!s) return undefined;
    const { blobId, remoteId, httpFallback } = s;
    
    // check P2P cache if we have both IDs
    if (blobId && remoteId) {
      const cached = getCachedP2PBlobUrl(blobId, remoteId);
      if (cached) return cached;
      
      // not cached yet - trigger background fetch (fire-and-forget)
      // the memo will re-run when pre-caching completes and updates activeBlobUrls
      void preCacheP2PBlob(blobId, remoteId, undefined, "image");
    }
    
    // fall back to HTTP URL if valid
    if (httpFallback && isValidHttpUrl(httpFallback)) {
      return httpFallback;
    }
    
    return undefined;
  });
}

/**
 * clear all cached blob URLs (memory only, not Cache API).
 * call this on logout or when switching remotes.
 */
export function clearAllBlobUrls(): void {
  for (const url of Object.values(activeBlobUrls)) {
    if (url && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
  clearActiveBlobUrls();
  debug("blobResolver", "cleared all blob URLs");
}

/**
 * clear all P2P cache data (Cache API + memory).
 * call this when clearing cache storage.
 */
export async function clearAllP2PCache(): Promise<void> {
  // clear in-memory blob URLs
  clearAllBlobUrls();
  
  // note: P2P blobs are stored in per-remote caches (freqhole-blobs-{remoteId})
  // which are cleared by storageManager.clearCacheApiData()
  debug("blobResolver", "cleared P2P in-memory blob URLs");
}

/**
 * evict a specific P2P blob from cache.
 * call this when a song is removed from the queue.
 */
export async function evictP2PBlob(blobId: string, remoteId: string): Promise<void> {
  // clear in-memory URL
  revokeBlobUrl(blobId, remoteId);
  
  // clear from per-remote Cache API (blobId is the key, not ${remoteId}/${blobId})
  try {
    const cacheName = getRemoteCacheName(remoteId);
    const cache = await caches.open(cacheName);
    const deleted = await cache.delete(blobId);
    if (deleted) {
      debug("blobResolver", `evicted P2P blob from cache: ${blobId.slice(0, 8)}...`);
    }
  } catch (err) {
    console.error("failed to evict P2P blob:", err);
  }
}

/**
 * check if a P2P blob is already cached.
 */
export async function isP2PBlobCached(blobId: string, remoteId: string): Promise<boolean> {
  // check in-memory cache
  const cacheKey = `${remoteId}/${blobId}`;
  if (activeBlobUrls[cacheKey]) {
    return true;
  }
  
  // check per-remote Cache API (blobId is the key)
  try {
    const cacheName = getRemoteCacheName(remoteId);
    const cache = await caches.open(cacheName);
    const response = await cache.match(blobId);
    return response !== undefined;
  } catch {
    return false;
  }
}

/**
 * pre-cache a P2P blob (fetch in background for later use).
 * tracks loading state and progress for UI feedback.
 * @param blake3 - optional blake3 hash for verified streaming via iroh-blobs (audio only)
 */
export async function preCacheP2PBlob(
  blobId: string,
  remoteId: string,
  sha256?: string,
  type: "audio" | "image" = "audio",
  blake3?: string,
): Promise<void> {
  // only pre-cache for P2P remotes or charnel-managed, skip for regular HTTP
  const remote = await getRemoteById(remoteId);
  if (!remote) return;
  const needsPreCache = isP2PTransportType(remote) || (isCharnelAvailable() && !!remote.is_charnel_managed);
  if (!needsPreCache) {
    // regular HTTP remotes don't need pre-caching, URLs work directly
    return;
  }

  const cacheKey = `${remoteId}/${blobId}`;
  
  // check if already in memory
  if (activeBlobUrls[cacheKey]) {
    debug("blobResolver", `P2P blob already in memory: ${blobId.slice(0, 8)}...`);
    return;
  }
  
  // check if fetch is already in progress (will be awaited by resolveBlobUrl)
  if (inProgressP2PFetches.has(cacheKey)) {
    debug("blobResolver", `P2P blob fetch already in progress: ${blobId.slice(0, 8)}...`);
    return;
  }
  
  // check Cache API - if cached and complete, create blob URL from it
  // use getCachedBlob to properly check metadata status
  try {
    const response = await getCachedBlob(remoteId, blobId);
    if (response) {
      // blob is in Cache API and complete - create blob URL and add to memory
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      addActiveBlobUrl(cacheKey, url);
      debug("blobResolver", `restored P2P blob URL from cache: ${blobId.slice(0, 8)}...`);
      return;
    }
  } catch (err) {
    debug("blobResolver", `failed to check cache for ${blobId.slice(0, 8)}...: ${err}`);
  }
  
  // track loading state for UI (use blobCache's unified loading set)
  if (sha256 && type === "audio") {
    addToLoadingSet(sha256);
    updateLoadingProgress(sha256, null); // indeterminate until we get total size
  }
  
  try {
    debug("blobResolver", `pre-caching P2P blob: ${blobId.slice(0, 8)}...${blake3 ? ` (verified)` : ""}`);
    
    // create progress callback if we have sha256 for tracking
    const onProgress: BlobProgressCallback | undefined = 
      (sha256 && type === "audio") 
        ? (received, total) => {
            if (total > 0) {
              updateLoadingProgress(sha256, received / total);
            }
          }
        : undefined;
    
    // use resolveBlobUrl which handles in-progress tracking and deduplication
    // pass blake3 for verified streaming via iroh-blobs
    await resolveBlobUrl(blobId, remoteId, type, onProgress, undefined, blake3);
    
    debug("blobResolver", `pre-cached P2P blob: ${blobId.slice(0, 8)}...`);
  } catch (err) {
    console.error(`failed to pre-cache P2P blob ${blobId}:`, err);
  } finally {
    if (sha256 && type === "audio") {
      removeFromLoadingSet(sha256);
    }
  }
}

/**
 * pre-cache (or sync) next P2P songs from queue (rolling ~30 minute cache).
 * awaits the first song to ensure immediate playback works, then fires off the rest in parallel.
 * also pre-caches waveform images for P2P songs.
 * 
 * in browser mode with sync_queue_to_local enabled: syncs songs to local OPFS + IDB
 * otherwise: caches blobs to Cache API only
 */
export async function preCacheNextP2PSongs(
  currentSongSha256: string | null,
  queue: Song[],
  targetMinutes: number = 30,
): Promise<void> {
  if (!currentSongSha256 || queue.length === 0) {
    return;
  }
  
  // check if sync mode is enabled - syncSongToLocal handles charnel vs browser mode internally
  const shouldSync = getSyncQueueToLocal();
  
  // find current song index
  const currentIdx = queue.findIndex((s) => s.sha256 === currentSongSha256);
  if (currentIdx < 0) {
    return;
  }
  
  // songs selected for caching/syncing (we need full Song for sync mode)
  const songsToProcess: Array<{ 
    song: Song;  // full song for sync mode
    sha256: string; 
    remoteId: string;
    blake3?: string;
    waveformBlobId?: string;
    waveformRemoteId?: string;
    thumbnailBlobId?: string;
    thumbnailRemoteId?: string;
  }> = [];
  let totalSeconds = 0;
  const targetSeconds = targetMinutes * 60;
  
  // cache isP2PRemote results to avoid repeated async lookups
  const p2pRemoteCache = new Map<string, boolean>();
  
  // helper to check if remote is P2P (with caching)
  const checkP2PRemote = async (remoteId: string): Promise<boolean> => {
    let isP2P = p2pRemoteCache.get(remoteId);
    if (isP2P === undefined) {
      isP2P = await isP2PRemote(remoteId);
      p2pRemoteCache.set(remoteId, isP2P);
    }
    return isP2P;
  };
  
  // iterate from CURRENT song onwards (include current for immediate waveform display)
  for (let i = currentIdx; i < queue.length; i++) {
    const song = queue[i];
    
    // only cache P2P remote songs
    if (song.source_type !== "remote" || !song.remote_server_id) {
      continue;
    }
    
    // check if remote is P2P (use cached result if available)
    if (!await checkP2PRemote(song.remote_server_id)) {
      continue;
    }
    
    // find waveform image info
    const waveformImg = song.images?.find((img) => img.blob_type === "waveform");
    let waveformBlobId: string | undefined;
    let waveformRemoteId: string | undefined;
    if (waveformImg?.remote_blob_id && waveformImg?.remote_server_id) {
      if (await checkP2PRemote(waveformImg.remote_server_id)) {
        waveformBlobId = waveformImg.remote_blob_id;
        waveformRemoteId = waveformImg.remote_server_id;
      }
    }
    
    // debug: log if song has images but no waveform found
    if (song.images && song.images.length > 0 && !waveformImg) {
      debug("blobResolver", `song ${song.sha256.slice(0, 8)}... has ${song.images.length} images but no waveform (types: ${song.images.map(i => i.blob_type).join(", ")})`);
    }
    
    // find thumbnail image info
    const thumbnailImg = song.images?.find((img) => img.blob_type === "thumbnail");
    let thumbnailBlobId: string | undefined;
    let thumbnailRemoteId: string | undefined;
    if (thumbnailImg?.remote_blob_id && thumbnailImg?.remote_server_id) {
      if (await checkP2PRemote(thumbnailImg.remote_server_id)) {
        thumbnailBlobId = thumbnailImg.remote_blob_id;
        thumbnailRemoteId = thumbnailImg.remote_server_id;
      }
    }
    
    songsToProcess.push({
      song, // keep full song for sync mode
      sha256: song.sha256,
      remoteId: song.remote_server_id,
      blake3: song.blake3 ?? undefined,
      waveformBlobId,
      waveformRemoteId,
      thumbnailBlobId,
      thumbnailRemoteId,
    });
    
    totalSeconds += song.duration_seconds || 0;
    
    if (totalSeconds >= targetSeconds) {
      break;
    }
  }
  
  if (songsToProcess.length === 0) {
    debug("blobResolver", "no P2P songs to pre-cache");
    return;
  }
  
  const waveformCount = songsToProcess.filter(s => s.waveformBlobId).length;
  const thumbnailCount = songsToProcess.filter(s => s.thumbnailBlobId).length;
  debug("blobResolver", `${shouldSync ? "syncing" : "pre-caching"} ${songsToProcess.length} P2P songs (~${targetMinutes} min) [${waveformCount} waveforms, ${thumbnailCount} thumbnails]`);
  
  // await first song to ensure immediate next song is ready for playback
  const [firstEntry, ...restEntries] = songsToProcess;
  
  try {
    if (shouldSync && canSyncSong(firstEntry.song)) {
      // sync mode: download to OPFS + create IDB records
      addToLoadingSet(firstEntry.sha256);
      const result = await syncSongToLocal(firstEntry.song, (received, total) => {
        if (total > 0) {
          updateLoadingProgress(firstEntry.sha256, received / total);
        }
      });
      removeFromLoadingSet(firstEntry.sha256);
      if (result.success) {
        debug("blobResolver", `first P2P song synced: ${firstEntry.sha256.slice(0, 8)}...${result.skipped ? " (already exists)" : ""}`);
        // invalidate queries so local views can show the new song
        if (!result.skipped) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
          void queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
        }
      } else {
        // sync failed - when sync mode is enabled, we don't fall back to Cache API
        // the song won't be pre-cached but will be fetched on-demand when played
        console.warn(`failed to sync first P2P song ${firstEntry.sha256}:`, result.error);
      }
    } else {
      // cache mode: just cache the blob
      await preCacheP2PBlob(firstEntry.sha256, firstEntry.remoteId, firstEntry.sha256, "audio", firstEntry.blake3);
      debug("blobResolver", `first P2P song pre-cached: ${firstEntry.sha256.slice(0, 8)}...${firstEntry.blake3 ? " (verified)" : ""}`);
    }
    
    // also pre-cache first song's waveform and thumbnail (awaited for immediate display)
    if (firstEntry.waveformBlobId && firstEntry.waveformRemoteId) {
      debug("blobResolver", `pre-caching first song waveform: ${firstEntry.waveformBlobId.slice(0, 8)}...`);
      await preCacheP2PBlob(firstEntry.waveformBlobId, firstEntry.waveformRemoteId, undefined, "image");
    }
    if (firstEntry.thumbnailBlobId && firstEntry.thumbnailRemoteId) {
      await preCacheP2PBlob(firstEntry.thumbnailBlobId, firstEntry.thumbnailRemoteId, undefined, "image");
    }
  } catch (err) {
    // log but don't fail the whole pre-cache
    console.warn(`failed to pre-cache first P2P song ${firstEntry.sha256}:`, err);
  }
  
  // fire off the rest in parallel (fire and forget) - audio, waveform, and thumbnail images
  for (const entry of restEntries) {
    if (shouldSync && canSyncSong(entry.song)) {
      // sync mode: download to OPFS + create IDB records
      addToLoadingSet(entry.sha256);
      void syncSongToLocal(entry.song, (received, total) => {
        if (total > 0) {
          updateLoadingProgress(entry.sha256, received / total);
        }
      }).then((result) => {
        removeFromLoadingSet(entry.sha256);
        if (result.success) {
          // invalidate queries so local views can show the new song
          if (!result.skipped) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
          }
        } else {
          // sync failed - when sync mode is enabled, we don't fall back to Cache API
          // the song won't be pre-cached but will be fetched on-demand when played
          console.warn(`failed to sync P2P song ${entry.sha256}:`, result.error);
        }
      }).catch(() => {
        removeFromLoadingSet(entry.sha256);
      });
    } else {
      // cache mode: just cache the blob
      void preCacheP2PBlob(entry.sha256, entry.remoteId, entry.sha256, "audio", entry.blake3);
    }
    
    // always cache waveform and thumbnail images (they don't get synced as separate records)
    if (entry.waveformBlobId && entry.waveformRemoteId) {
      void preCacheP2PBlob(entry.waveformBlobId, entry.waveformRemoteId, undefined, "image");
    }
    if (entry.thumbnailBlobId && entry.thumbnailRemoteId) {
      void preCacheP2PBlob(entry.thumbnailBlobId, entry.thumbnailRemoteId, undefined, "image");
    }
  }
}

// ===== unified image resolution =====
// centralized logic for resolving image URLs across all transports
// components should use resolveImageUrlSync() for instant render, letting pre-caching handle P2P fetches

import type { ImageMetadata } from "./types";
import { getCachedBlobObjectURL } from "./blobs";

/**
 * check if a URL is a valid full HTTP(S) URL.
 * rejects relative paths like "/api/blobs/{id}" which don't work for P2P.
 */
export function isValidHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * synchronously resolve an image URL - for instant render without flicker.
 * 
 * priority order:
 * 1. local blob (OPFS cache)
 * 2. P2P cached blob (in-memory activeBlobUrls)
 * 3. valid HTTP URL (full URL with protocol, not relative paths)
 * 
 * returns null if no cached URL available - components should handle gracefully.
 * P2P images should be pre-cached by preCacheNextP2PSongs().
 */
export function resolveImageUrlSync(
  image: ImageMetadata | null | undefined,
  legacyBlobId?: string | null,
  legacyUrl?: string | null,
): string | null {
  // priority 1: local blob (OPFS cache)
  const localBlobId = image?.local_blob_id || legacyBlobId;
  if (localBlobId) {
    const cached = getCachedBlobObjectURL(localBlobId);
    if (cached) return cached;
    // not in sync cache - would need async lookup, return null
    return null;
  }

  // priority 2: P2P cached blob (in-memory)
  if (image?.remote_blob_id && image?.remote_server_id) {
    const cached = getCachedP2PBlobUrl(image.remote_blob_id, image.remote_server_id);
    if (cached) return cached;
    // not cached - fall through to check HTTP fallback
  }

  // priority 3: valid HTTP URL (not relative paths)
  // SAFEGUARD: in charnel mode, skip localhost URLs (stale sidecar refs)
  const httpUrl = image?.remote_url || legacyUrl;
  if (isValidHttpUrl(httpUrl)) {
    if (isCharnelAvailable() && httpUrl!.includes("localhost")) {
      debug("blobResolver", `skipping stale localhost URL in charnel mode: ${httpUrl!.slice(0, 50)}...`);
      return null;
    }
    return httpUrl!;
  }

  return null;
}

/**
 * check if an image needs async resolution (has local_blob_id but not in sync cache).
 */
export function imageNeedsAsyncResolution(
  image: ImageMetadata | null | undefined,
  legacyBlobId?: string | null,
): boolean {
  const localBlobId = image?.local_blob_id || legacyBlobId;
  if (!localBlobId) return false;
  return !getCachedBlobObjectURL(localBlobId);
}
