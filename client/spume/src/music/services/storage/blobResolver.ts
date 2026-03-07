// blob resolver - resolves blob IDs to URLs for any transport type
//
// for HTTP remotes: returns direct URLs (browser handles auth via cookies/api key)
// for P2P remotes: fetches via WasmTransport, caches in Cache API, returns blob URL
//
// usage:
//   const url = await resolveBlobUrl(blobId, remoteId);
//   <img src={url} /> or <audio src={url} />

import { createSignal } from "solid-js";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import {
  getMiddenNode,
  type Remote,
} from "../../../app/api/client";
import { WasmTransport } from "freqhole-api-client";
import { debug } from "../../../utils/logger";

// cache of active blob URLs to prevent memory leaks
// keyed by `${remoteId}/${blobId}`
const activeBlobUrls = new Map<string, string>();

// reactive set of P2P blob sha256s currently being fetched (for UI loading indicators)
const [loadingP2PSha256s, setLoadingP2PSha256s] = createSignal<Set<string>>(new Set());

// get the set of currently loading P2P song sha256s (for UI binding)
export function getLoadingP2PSongIds(): Set<string> {
  return loadingP2PSha256s();
}

function addToP2PLoadingSet(sha256: string): void {
  setLoadingP2PSha256s((prev) => {
    if (prev.has(sha256)) return prev;
    const next = new Set(prev);
    next.add(sha256);
    return next;
  });
}

function removeFromP2PLoadingSet(sha256: string): void {
  setLoadingP2PSha256s((prev) => {
    if (!prev.has(sha256)) return prev;
    const next = new Set(prev);
    next.delete(sha256);
    return next;
  });
}

// track in-progress P2P fetches to avoid duplicates
const inProgressP2PFetches = new Set<string>();

/**
 * resolve a blob ID to a URL for display/playback.
 *
 * @param blobId - the blob ID (sha256 or server blob ID)
 * @param remoteId - the remote server ID (for looking up transport type)
 * @returns URL string usable in <img src> or <audio src>
 */
export async function resolveBlobUrl(
  blobId: string,
  remoteId: string,
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
    return resolveP2PBlob(blobId, remote, cacheKey);
  } else {
    // HTTP transport - return direct URL
    return `${remote.base_url}/api/blobs/${blobId}`;
  }
}

/**
 * resolve a blob via P2P transport.
 * fetches the blob, caches it, and returns a blob URL.
 */
async function resolveP2PBlob(
  blobId: string,
  remote: Remote,
  cacheKey: string,
): Promise<string> {
  debug("blobResolver", `fetching P2P blob ${blobId.slice(0, 8)}...`);

  if (!remote.peer_addr) {
    throw new Error(`remote ${remote.remote_id} has no peer_addr for P2P transport`);
  }

  // get midden node and create transport
  const node = await getMiddenNode();
  const transport = new WasmTransport(node, remote.peer_addr);

  // use WasmTransport's getBlobUrl which fetches, caches, and returns blob URL
  const url = await transport.getBlobUrl(blobId);

  // track the URL for cleanup
  activeBlobUrls.set(cacheKey, url);

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

// unified cache name for all remote blobs (HTTP + P2P) - must match blobCache.ts and WasmTransport
const BLOB_CACHE_NAME = "freqhole-blobs-v1";

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
  
  // note: P2P blobs are now in the unified cache (freqhole-blobs-v1)
  // which is cleared by storageManager.clearCacheApiData()
  debug("blobResolver", "cleared P2P in-memory blob URLs");
}

/**
 * evict a specific P2P blob from cache.
 * call this when a song is removed from the queue.
 */
export async function evictP2PBlob(blobId: string, remoteId: string): Promise<void> {
  // clear in-memory URL
  revokeBlobUrl(blobId, remoteId);
  
  // clear from unified Cache API
  try {
    const cache = await caches.open(BLOB_CACHE_NAME);
    const cacheKey = `${remoteId}/${blobId}`;
    const deleted = await cache.delete(cacheKey);
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
  
  // check unified Cache API
  try {
    const cache = await caches.open(BLOB_CACHE_NAME);
    const response = await cache.match(cacheKey);
    return response !== undefined;
  } catch {
    return false;
  }
}

/**
 * pre-cache a P2P blob (fetch in background for later use).
 * tracks loading state for UI feedback.
 */
export async function preCacheP2PBlob(
  blobId: string,
  remoteId: string,
  sha256?: string,
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
  
  // mark as in progress
  inProgressP2PFetches.add(cacheKey);
  if (sha256) {
    addToP2PLoadingSet(sha256);
  }
  
  try {
    debug("blobResolver", `pre-caching P2P blob: ${blobId.slice(0, 8)}...`);
    
    // resolve and cache the blob (this fetches via WasmTransport + stores in Cache API)
    await resolveBlobUrl(blobId, remoteId);
    
    debug("blobResolver", `pre-cached P2P blob: ${blobId.slice(0, 8)}...`);
  } catch (err) {
    console.error(`failed to pre-cache P2P blob ${blobId}:`, err);
  } finally {
    inProgressP2PFetches.delete(cacheKey);
    if (sha256) {
      removeFromP2PLoadingSet(sha256);
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
