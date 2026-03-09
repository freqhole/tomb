// blob resolver - resolves blob IDs to URLs for any transport type
//
// for HTTP remotes: returns direct URLs (browser handles auth via cookies/api key)
// for P2P remotes: fetches via WasmTransport, caches in Cache API, returns blob URL
//
// usage:
//   const url = await resolveBlobUrl(blobId, remoteId, "audio");
//   <img src={url} /> or <audio src={url} />

import { createSignal } from "solid-js";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import {
  getMiddenNode,
  type Remote,
} from "../../../app/api/client";
import { WasmTransport, type BlobProgressCallback } from "freqhole-api-client";
import { debug } from "../../../utils/logger";
import { 
  getRemoteCacheName, 
  saveP2PBlobMetadata, 
  updateLoadingProgress,
  addToLoadingSet,
  removeFromLoadingSet,
} from "../cache/blobCache";

// cache of active blob URLs to prevent memory leaks
// keyed by `${remoteId}/${blobId}`
const activeBlobUrls = new Map<string, string>();

// reactive set of P2P blob sha256s currently being fetched (for UI loading indicators)
// NOTE: now deprecated - P2P loading uses blobCache's unified loading set
// kept for backward compatibility with AppLayout.tsx
const [loadingP2PSha256s, _setLoadingP2PSha256s] = createSignal<Set<string>>(new Set());

// get the set of currently loading P2P song sha256s (for UI binding)
// NOTE: now deprecated - returns empty set since P2P loading uses blobCache's unified loading set
export function getLoadingP2PSongIds(): Set<string> {
  return loadingP2PSha256s();
}

// track in-progress P2P fetches to avoid duplicates
const inProgressP2PFetches = new Set<string>();

/**
 * resolve a blob ID to a URL for display/playback.
 *
 * @param blobId - the blob ID (sha256 or server blob ID)
 * @param remoteId - the remote server ID (for looking up transport type)
 * @param type - the blob type ("audio" or "image") for cache metadata tracking
 * @returns URL string usable in <img src> or <audio src>
 */
export async function resolveBlobUrl(
  blobId: string,
  remoteId: string,
  type: "audio" | "image" = "image",
  onProgress?: BlobProgressCallback,
): Promise<string> {
  debug("blobResolver", `resolving blob ${blobId.slice(0, 8)}... for remote ${remoteId}`);

  const remote = await getRemoteById(remoteId);
  if (!remote) {
    throw new Error(`remote not found: ${remoteId}`);
  }

  // check if we already have an active blob URL
  const cacheKey = `${remoteId}/${blobId}`;
  const cached = activeBlobUrls.get(cacheKey);
  if (cached) {
    debug("blobResolver", `using cached blob URL for ${blobId.slice(0, 8)}...`);
    return cached;
  }

  // determine transport type
  const transportType = remote.transport_type ?? (remote.peer_addr ? "wasm" : "http");

  if (transportType === "wasm") {
    return resolveP2PBlob(blobId, remote, cacheKey, type, onProgress);
  } else {
    // HTTP transport - return direct URL
    return `${remote.base_url}/api/blobs/${blobId}`;
  }
}

/**
 * resolve a blob via P2P transport.
 * fetches the blob, caches it, and returns a blob URL.
 * @param onProgress - optional callback for download progress (received, total)
 */
async function resolveP2PBlob(
  blobId: string,
  remote: Remote,
  cacheKey: string,
  type: "audio" | "image",
  onProgress?: BlobProgressCallback,
): Promise<string> {
  debug("blobResolver", `fetching P2P blob ${blobId.slice(0, 8)}...`);

  if (!remote.peer_addr) {
    throw new Error(`remote ${remote.remote_id} has no peer_addr for P2P transport`);
  }

  // get midden node and create transport with per-remote cache
  const node = await getMiddenNode();
  const cacheName = getRemoteCacheName(remote.remote_id);
  const transport = new WasmTransport(node, remote.peer_addr, cacheName);

  // use progress-enabled fetch if callback provided
  let url: string;
  if (onProgress) {
    url = await transport.getBlobUrlWithProgress(blobId, onProgress);
  } else {
    url = await transport.getBlobUrl(blobId);
  }

  // track the URL for cleanup
  activeBlobUrls.set(cacheKey, url);

  // save metadata for P2P-cached blobs so stats tracking works
  void saveP2PBlobMetadata(remote.remote_id, blobId, type);

  debug("blobResolver", `resolved P2P blob ${blobId.slice(0, 8)}... to blob URL`);
  return url;
}

/**
 * revoke a cached blob URL to free memory.
 * call this when an image/audio element is removed from the DOM.
 */
export function revokeBlobUrl(blobId: string, remoteId: string): void {
  const cacheKey = `${remoteId}/${blobId}`;
  const url = activeBlobUrls.get(cacheKey);
  if (url) {
    // only revoke blob: URLs (not http: URLs)
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
    activeBlobUrls.delete(cacheKey);
    debug("blobResolver", `revoked blob URL for ${blobId.slice(0, 8)}...`);
  }
}

/**
 * synchronously check if a P2P blob URL is already cached.
 * use this for instant render without async lookup.
 */
export function getCachedP2PBlobUrl(blobId: string, remoteId: string): string | null {
  const cacheKey = `${remoteId}/${blobId}`;
  return activeBlobUrls.get(cacheKey) ?? null;
}

/**
 * clear all cached blob URLs (memory only, not Cache API).
 * call this on logout or when switching remotes.
 */
export function clearAllBlobUrls(): void {
  for (const url of activeBlobUrls.values()) {
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
  activeBlobUrls.clear();
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
 * check if a remote uses P2P transport.
 */
export async function isP2PRemote(remoteId: string): Promise<boolean> {
  const remote = await getRemoteById(remoteId);
  if (!remote) return false;
  const transportType = remote.transport_type ?? (remote.peer_addr ? "wasm" : "http");
  return transportType === "wasm";
}

/**
 * get the transport type for a remote.
 */
export async function getRemoteTransportType(
  remoteId: string,
): Promise<"http" | "wasm" | "app" | null> {
  const remote = await getRemoteById(remoteId);
  if (!remote) return null;
  return remote.transport_type ?? (remote.peer_addr ? "wasm" : "http");
}

/**
 * check if a P2P blob is already cached.
 */
export async function isP2PBlobCached(blobId: string, remoteId: string): Promise<boolean> {
  // check in-memory cache
  const cacheKey = `${remoteId}/${blobId}`;
  if (activeBlobUrls.has(cacheKey)) {
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
 */
export async function preCacheP2PBlob(
  blobId: string,
  remoteId: string,
  sha256?: string,
  type: "audio" | "image" = "audio",
): Promise<void> {
  const cacheKey = `${remoteId}/${blobId}`;
  
  // check if already cached or in progress
  if (activeBlobUrls.has(cacheKey)) {
    debug("blobResolver", `P2P blob already cached: ${blobId.slice(0, 8)}...`);
    return;
  }
  
  if (inProgressP2PFetches.has(cacheKey)) {
    debug("blobResolver", `P2P blob fetch already in progress: ${blobId.slice(0, 8)}...`);
    return;
  }
  
  // check Cache API
  if (await isP2PBlobCached(blobId, remoteId)) {
    debug("blobResolver", `P2P blob already in cache: ${blobId.slice(0, 8)}...`);
    return;
  }
  
  // get remote to check transport type
  const remote = await getRemoteById(remoteId);
  if (!remote) {
    debug("blobResolver", `remote not found for P2P pre-cache: ${remoteId}`);
    return;
  }
  
  // mark as in progress (use blobCache's unified loading set for UI consistency)
  inProgressP2PFetches.add(cacheKey);
  if (sha256 && type === "audio") {
    addToLoadingSet(sha256);
    // initialize as indeterminate until we get total size
    updateLoadingProgress(sha256, null);
  }
  
  try {
    debug("blobResolver", `pre-caching P2P blob: ${blobId.slice(0, 8)}...`);
    
    // create progress callback if we have sha256 for tracking
    const onProgress: BlobProgressCallback | undefined = 
      (sha256 && type === "audio") 
        ? (received, total) => {
            if (total > 0) {
              updateLoadingProgress(sha256, received / total);
            }
          }
        : undefined;
    
    // resolve and cache the blob directly with progress callback
    await resolveP2PBlob(blobId, remote, cacheKey, type, onProgress);
    
    debug("blobResolver", `pre-cached P2P blob: ${blobId.slice(0, 8)}...`);
  } catch (err) {
    console.error(`failed to pre-cache P2P blob ${blobId}:`, err);
  } finally {
    inProgressP2PFetches.delete(cacheKey);
    if (sha256 && type === "audio") {
      removeFromLoadingSet(sha256);
    }
  }
}

/**
 * pre-cache next P2P songs from queue (rolling ~30 minute cache).
 */
export async function preCacheNextP2PSongs(
  currentSongSha256: string | null,
  queue: Array<{
    sha256: string;
    duration_seconds: number;
    source_type: string;
    remote_server_id: string | null;
  }>,
  targetMinutes: number = 30,
): Promise<void> {
  if (!currentSongSha256 || queue.length === 0) {
    return;
  }
  
  // find current song index
  const currentIdx = queue.findIndex((s) => s.sha256 === currentSongSha256);
  if (currentIdx < 0 || currentIdx >= queue.length - 1) {
    return;
  }
  
  const songsToCache: Array<{ sha256: string; remoteId: string }> = [];
  let totalSeconds = 0;
  const targetSeconds = targetMinutes * 60;
  
  // iterate from next song onwards
  for (let i = currentIdx + 1; i < queue.length; i++) {
    const song = queue[i];
    
    // only cache P2P remote songs
    if (song.source_type !== "remote" || !song.remote_server_id) {
      continue;
    }
    
    // check if remote is P2P
    const isP2P = await isP2PRemote(song.remote_server_id);
    if (!isP2P) {
      continue;
    }
    
    songsToCache.push({
      sha256: song.sha256,
      remoteId: song.remote_server_id,
    });
    
    totalSeconds += song.duration_seconds || 0;
    
    if (totalSeconds >= targetSeconds) {
      break;
    }
  }
  
  if (songsToCache.length === 0) {
    debug("blobResolver", "no P2P songs to pre-cache");
    return;
  }
  
  debug("blobResolver", `pre-caching ${songsToCache.length} P2P songs (~${targetMinutes} min)`);
  
  // start pre-caching (fire and forget, parallel)
  for (const song of songsToCache) {
    void preCacheP2PBlob(song.sha256, song.remoteId, song.sha256);
  }
}
