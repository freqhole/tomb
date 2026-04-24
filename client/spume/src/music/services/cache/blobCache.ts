// blob cache manager for remote audio/image caching
// uses hybrid time-based + LRU eviction strategy
// caches are partitioned by remote for easy management and cleanup

import { createStore, reconcile } from "solid-js/store";
import { debug, warn, error as errorLog } from "../../../utils/logger";
import type { ImageMetadata } from "../storage/types";
import { getWaveformImage } from "../../../utils/images";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { isP2PRemote, isCharnelManagedRemoteSync } from "../storage/transportCache";
import {
  addToLoadingSet,
  updateLoadingProgress,
  removeFromLoadingSet,
} from "../download";

// ===== per-remote cache naming =====
// import from cacheNames to avoid circular deps with client.ts
import {
  REMOTE_CACHE_PREFIX,
  getRemoteCacheName,
  isRemoteBlobCache,
  getRemoteIdFromCacheName,
  listRemoteBlobCaches,
} from "./cacheNames";

// re-export for backward compatibility
export { REMOTE_CACHE_PREFIX, getRemoteCacheName, isRemoteBlobCache, getRemoteIdFromCacheName, listRemoteBlobCaches };

// webkitgtk (linux) requires HTTP/HTTPS URLs for Cache API keys.
// wrap bare blobIds with a synthetic URL prefix.
function cacheKey(blobId: string): string {
  return `https://blob.local/${blobId}`;
}

/** check if remote should skip caching (localhost or tauri-managed) */
export async function shouldSkipCaching(remoteId: string): Promise<boolean> {
  const remote = await getRemoteById(remoteId);
  if (!remote) return false;
  
  // skip for tauri-managed remotes
  if (remote.is_charnel_managed) return true;

  // P2P remotes should not skip caching
  const isPeerRemote = await isP2PRemote(remoteId);
  if (isPeerRemote) return false;
  
  // skip for localhost URLs (HTTP remotes only)
  const url = remote.base_url?.toLowerCase() ?? "";
  if (url.includes("localhost") || url.includes("127.0.0.1") || url.includes("[::1]")) {
    return true;
  }
  
  return false;
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// store of cached audio URLs for UI feedback (granular reactivity)
// keys are in the format: `${remoteId}/${blobId}` -> true/false
// using store instead of signal<Set> so each key can be tracked independently
const [cacheStatus, setCacheStatus] = createStore<Record<string, boolean>>({});

// check if a URL is in the reactive cache set (for UI binding)
// NOTE: this expects the key format `${remoteId}/${blobId}`, not a full URL
export function isBlobCachedReactive(url: string | null | undefined): boolean {
  if (!url) return false;
  return cacheStatus[url] ?? false;
}

// check if a song is cached using remoteId and blobId (sha256)
// this is the correct way to check cache status for both HTTP and P2P transports
// tauri-managed remotes are treated as always cached (local files)
export function isSongCachedReactive(remoteId: string | null | undefined, sha256: string | null | undefined): boolean {
  if (!remoteId || !sha256) return false;
  
  // tauri-managed remotes have local files - always "cached"
  const isCharnelManaged = isCharnelManagedRemoteSync(remoteId);
  if (isCharnelManaged) return true;
  
  const key = `${remoteId}/${sha256}`;
  return cacheStatus[key] ?? false;
}

function addToCachedSet(url: string): void {
  setCacheStatus(url, true);
}

function removeFromCachedSet(url: string): void {
  setCacheStatus(url, false);
}

function clearCachedSet(): void {
  setCacheStatus(reconcile({}));
}

// seed the reactive set from existing cache metadata on startup
// validates that blobs actually exist in Cache API before marking as cached
// also purges incomplete "pending" entries from previous sessions (crash recovery)
export async function initCachedAudioURLs(): Promise<void> {
  try {
    const allMetadata = await getAllMetadata();
    const audioMetadata = allMetadata.filter((m) => m.type === "audio");
    
    // validate each entry actually exists in Cache API
    const validatedKeys: Record<string, boolean> = {};
    const staleEntries: string[] = [];
    const pendingEntries: string[] = []; // incomplete downloads from previous session
    
    // group by remote for efficient cache access
    const byRemote = new Map<string, typeof audioMetadata>();
    for (const m of audioMetadata) {
      const list = byRemote.get(m.remoteId) || [];
      list.push(m);
      byRemote.set(m.remoteId, list);
    }
    
    // validate each remote's cached blobs
    for (const [remoteId, entries] of byRemote) {
      try {
        const cacheName = getRemoteCacheName(remoteId);
        const cache = await caches.open(cacheName);
        
        for (const entry of entries) {
          // purge incomplete downloads from previous session
          if (entry.status === "pending" || entry.status === "failed") {
            pendingEntries.push(entry.url);
            // also remove from Cache API if it exists (partial data)
            await cache.delete(cacheKey(entry.blobId)).catch(() => {});
            continue;
          }
          
          const response = await cache.match(cacheKey(entry.blobId));
          if (response) {
            validatedKeys[entry.url] = true;
          } else {
            // blob not in cache - mark for cleanup
            staleEntries.push(entry.url);
          }
        }
      } catch (err) {
        // if cache access fails, skip this remote's entries
        warn(`failed to validate cache for remote ${remoteId}:`, err);
      }
    }
    
    // batch update store with all validated entries
    setCacheStatus(reconcile(validatedKeys));
    debug(`initialized cache status store with ${Object.keys(validatedKeys).length} validated entries`);
    
    // clean up stale metadata entries in background
    if (staleEntries.length > 0) {
      debug(`cleaning up ${staleEntries.length} stale metadata entries`);
      for (const url of staleEntries) {
        void deleteMetadata(url);
      }
    }
    
    // clean up pending/incomplete entries (crash recovery)
    if (pendingEntries.length > 0) {
      debug(`purging ${pendingEntries.length} incomplete downloads from previous session`);
      for (const url of pendingEntries) {
        void deleteMetadata(url);
      }
    }
  } catch (error) {
    errorLog("failed to initialize cached audio URL set:", error);
  }
}

// pending cache queue - tracks blobs waiting to be cached
interface PendingCacheItem {
  url: string;
  type: "audio" | "image";
  remoteId: string;
  blobId: string;
  retries: number;
  addedAt: number;
}

let pendingCacheQueue: PendingCacheItem[] = [];
let isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
let processingPending = false;

// in-progress cache fetches - use shared tracking module to avoid circular deps
import {
  hasInProgressFetch as inProgressFetchesHas,
  addInProgressFetch as inProgressFetchesAdd,
  deleteInProgressFetch as inProgressFetchesDelete,
  clearInProgressTracking,
} from "./inProgressTracking";

// re-export for backward compatibility
export { clearInProgressTracking };

// dynamic cache size limits based on available storage
// reserve 10% of total quota for cache, but respect minimum headroom
const CACHE_QUOTA_PERCENT = 0.1; // use up to 10% of total storage for cache
const MIN_HEADROOM_MB = 100; // always leave at least 100MB free
const TOTAL_QUOTA_WARNING = 0.85; // warn if total storage >85% full
const TOTAL_QUOTA_CRITICAL = 0.95; // critical if total storage >95% full

// cache entry status for tracking download completion
export type CacheStatus = "pending" | "complete" | "failed";

interface CacheMetadata {
  url: string;
  remoteId: string; // which remote this blob belongs to
  blobId: string; // the blob id (sha256 or similar) as cache key
  cachedAt: number;
  lastAccessedAt: number;
  size: number;
  type: "audio" | "image";
  // v4 fields: status tracking for validation
  status?: CacheStatus; // undefined treated as "complete" for backwards compat
  expectedSize?: number; // expected size from Content-Length, for validation
}

// metadata store (in indexeddb for persistence)
const METADATA_DB_NAME = "freqhole_cache_metadata";
const METADATA_STORE_NAME = "blob_metadata";

let metadataDB: IDBDatabase | null = null;
const METADATA_DB_VERSION = 4; // v4: added status and expectedSize fields

// close metadata database connection (required before deletion in Safari)
export function closeMetadataDB(): void {
  if (metadataDB) {
    metadataDB.close();
    metadataDB = null;
  }
}

// initialize metadata database
async function initMetadataDB(): Promise<IDBDatabase> {
  if (metadataDB) return metadataDB;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(METADATA_DB_NAME, METADATA_DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      metadataDB = request.result;
      resolve(metadataDB);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // drop and recreate store on version upgrade to handle schema changes
      if (db.objectStoreNames.contains(METADATA_STORE_NAME)) {
        db.deleteObjectStore(METADATA_STORE_NAME);
      }
      
      const store = db.createObjectStore(METADATA_STORE_NAME, {
        keyPath: "url",
      });
      store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false });
      store.createIndex("remoteId", "remoteId", { unique: false });
      store.createIndex("type", "type", { unique: false });
    };
  });
}

// get metadata for a url
async function getMetadata(url: string): Promise<CacheMetadata | null> {
  const db = await initMetadataDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(METADATA_STORE_NAME, "readonly");
    const store = tx.objectStore(METADATA_STORE_NAME);
    const request = store.get(url);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

// get all metadata for a specific remote
async function getMetadataByRemote(remoteId: string): Promise<CacheMetadata[]> {
  const db = await initMetadataDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(METADATA_STORE_NAME, "readonly");
    const store = tx.objectStore(METADATA_STORE_NAME);
    const index = store.index("remoteId");
    const request = index.getAll(remoteId);

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// save metadata for a url
async function saveMetadata(metadata: CacheMetadata): Promise<void> {
  const db = await initMetadataDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(METADATA_STORE_NAME, "readwrite");
    const store = tx.objectStore(METADATA_STORE_NAME);
    const request = store.put(metadata);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// get all metadata entries
async function getAllMetadata(): Promise<CacheMetadata[]> {
  const db = await initMetadataDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(METADATA_STORE_NAME, "readonly");
    const store = tx.objectStore(METADATA_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// delete metadata for a url
async function deleteMetadata(url: string): Promise<void> {
  const db = await initMetadataDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(METADATA_STORE_NAME, "readwrite");
    const store = tx.objectStore(METADATA_STORE_NAME);
    const request = store.delete(url);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// create a "pending" cache entry before download starts
// this allows crash recovery - pending entries are purged on init
export async function createPendingCacheEntry(
  remoteId: string,
  blobId: string,
  type: "audio" | "image",
  expectedSize?: number,
): Promise<void> {
  try {
    const metadataKey = `${remoteId}/${blobId}`;
    const existing = await getMetadata(metadataKey);
    
    // don't overwrite a complete entry
    if (existing?.status === "complete") {
      return;
    }
    
    const metadata: CacheMetadata = {
      url: metadataKey,
      remoteId,
      blobId,
      cachedAt: Date.now(),
      lastAccessedAt: Date.now(),
      size: 0, // unknown until download completes
      type,
      status: "pending",
      expectedSize,
    };
    await saveMetadata(metadata);
    debug(`created pending cache entry: ${blobId.slice(0, 8)}... (expected: ${expectedSize ?? "unknown"})`);
  } catch (error) {
    // don't fail the download if metadata creation fails
    warn("failed to create pending cache entry:", error);
  }
}

// mark a cache entry as failed (for cleanup on next init)
async function markCacheFailed(metadataKey: string): Promise<void> {
  try {
    const existing = await getMetadata(metadataKey);
    if (existing) {
      existing.status = "failed";
      existing.lastAccessedAt = Date.now();
      await saveMetadata(existing);
    }
  } catch (error) {
    warn("failed to mark cache entry as failed:", error);
  }
}

// get cache size (only our blob cache, not total storage)
async function getCacheSize(): Promise<number> {
  try {
    const allMetadata = await getAllMetadata();
    return allMetadata.reduce((sum, m) => sum + m.size, 0);
  } catch (error) {
    errorLog("failed to get cache size:", error);
    return 0;
  }
}

// get storage info (total and cache-specific)
async function getStorageInfo(): Promise<{
  totalUsage: number;
  totalQuota: number;
  totalPercentUsed: number;
  cacheSize: number;
  maxCacheSize: number;
  cachePercentOfMax: number;
}> {
  const cacheSize = await getCacheSize();

  if (!navigator.storage?.estimate) {
    return {
      totalUsage: 0,
      totalQuota: 0,
      totalPercentUsed: 0,
      cacheSize,
      maxCacheSize: 0,
      cachePercentOfMax: 0,
    };
  }

  const estimate = await navigator.storage.estimate();
  const totalUsage = estimate.usage || 0;
  const totalQuota = estimate.quota || 0;
  const totalPercentUsed = totalQuota > 0 ? totalUsage / totalQuota : 0;

  // calculate max cache size dynamically
  // use 10% of total quota, but leave minimum headroom
  const maxCacheSizeFromQuota = totalQuota * CACHE_QUOTA_PERCENT;
  const availableSpace = totalQuota - totalUsage;
  const minHeadroomBytes = MIN_HEADROOM_MB * 1024 * 1024;
  const maxCacheSize = Math.min(
    maxCacheSizeFromQuota,
    availableSpace - minHeadroomBytes,
  );

  const cachePercentOfMax = maxCacheSize > 0 ? cacheSize / maxCacheSize : 0;

  return {
    totalUsage,
    totalQuota,
    totalPercentUsed,
    cacheSize,
    maxCacheSize: Math.max(0, maxCacheSize),
    cachePercentOfMax,
  };
}

// cache a blob (audio or image) for a specific remote
// skips caching for localhost/tauri-managed remotes
// validates size against expectedSize if provided
export async function cacheBlob(
  _url: string, // original fetch URL (kept for future debugging/metadata)
  response: Response,
  type: "audio" | "image",
  remoteId: string,
  blobId: string,
  expectedSize?: number, // expected size from Content-Length for validation
): Promise<void> {
  const metadataKey = `${remoteId}/${blobId}`;
  
  try {
    // skip caching for localhost/tauri remotes
    if (await shouldSkipCaching(remoteId)) {
      debug(`skipping cache for local/tauri remote: ${remoteId}`);
      return;
    }

    // check if we have space before caching
    const storageInfo = await getStorageInfo();

    // don't cache if total storage is critical
    if (storageInfo.totalPercentUsed >= TOTAL_QUOTA_CRITICAL) {
      warn(
        `total storage critical (${(storageInfo.totalPercentUsed * 100).toFixed(1)}%), skipping cache`,
      );
      // mark as failed if we had pending metadata
      void markCacheFailed(metadataKey);
      return;
    }

    const cacheName = getRemoteCacheName(remoteId);
    const cache = await caches.open(cacheName);

    // clone response to read size
    const clonedResponse = response.clone();
    const blob = await clonedResponse.blob();
    const size = blob.size;

    // validate size if expected size was provided
    if (expectedSize !== undefined && size !== expectedSize) {
      warn(
        `blob size mismatch for ${blobId.slice(0, 8)}...: expected ${expectedSize}, got ${size} (truncated download?)`,
      );
      // mark as failed - don't cache incomplete data
      void markCacheFailed(metadataKey);
      return;
    }

    // cache the response using blobId as key
    await cache.put(cacheKey(blobId), response);

    // save metadata - use remoteId/blobId as composite key
    const metadata: CacheMetadata = {
      url: metadataKey, // composite key for uniqueness
      remoteId,
      blobId,
      cachedAt: Date.now(),
      lastAccessedAt: Date.now(),
      size,
      type,
      status: "complete",
      expectedSize,
    };
    await saveMetadata(metadata);

    debug(`cached blob: ${blobId.slice(0, 8)}... for remote ${remoteId} (${(size / 1024).toFixed(1)} kb)`);

    // update reactive cache set for audio blobs (use original URL for compatibility)
    if (type === "audio") {
      addToCachedSet(metadataKey);
    }

    // check if we need to evict old entries
    await evictIfNeeded(remoteId);
  } catch (error) {
    errorLog("failed to cache blob:", error);
  }
}

// save metadata for a P2P blob that was cached by WasmTransport
// this allows stats tracking to include P2P-cached blobs
export async function saveP2PBlobMetadata(
  remoteId: string,
  blobId: string,
  type: "audio" | "image",
): Promise<void> {
  try {
    // skip for localhost/tauri remotes
    if (await shouldSkipCaching(remoteId)) {
      return;
    }

    // check if metadata already exists
    const metadataKey = `${remoteId}/${blobId}`;
    const cacheName = getRemoteCacheName(remoteId);
    const cache = await caches.open(cacheName);
    const response = await cache.match(cacheKey(blobId));
    
    // only proceed if blob is actually in cache
    if (!response) {
      debug(`saveP2PBlobMetadata: blob not in cache: ${blobId.slice(0, 8)}...`);
      return;
    }
    
    const existing = await getMetadata(metadataKey);
    if (existing) {
      // update last accessed time and ensure status is complete
      existing.lastAccessedAt = Date.now();
      existing.status = "complete"; // blob verified to be in cache
      await saveMetadata(existing);
      // ensure reactive set stays in sync (blob verified above)
      if (type === "audio") {
        addToCachedSet(metadataKey);
      }
      return;
    }

    // get size from response (already verified response exists above)
    const clonedResponse = response.clone();
    const blob = await clonedResponse.blob();
    const size = blob.size;

    // save metadata - mark as complete since blob is fully in cache
    const metadata: CacheMetadata = {
      url: metadataKey,
      remoteId,
      blobId,
      cachedAt: Date.now(),
      lastAccessedAt: Date.now(),
      size,
      type,
      status: "complete",
    };
    await saveMetadata(metadata);

    debug(`saved P2P blob metadata: ${blobId.slice(0, 8)}... (${(size / 1024).toFixed(1)} kb)`);

    // update reactive cache set for audio blobs
    if (type === "audio") {
      addToCachedSet(metadataKey);
    }
  } catch (error) {
    errorLog("failed to save P2P blob metadata:", error);
  }
}

// get a blob from cache (and update last accessed time)
export async function getCachedBlob(remoteId: string, blobId: string): Promise<Response | null> {
  try {
    const metadataKey = `${remoteId}/${blobId}`;
    const metadata = await getMetadata(metadataKey);
    
    // if metadata says pending/failed, don't trust cached data
    if (metadata && (metadata.status === "pending" || metadata.status === "failed")) {
      debug(`cache entry incomplete (${metadata.status}): ${blobId.slice(0, 8)}...`);
      return null;
    }
    
    const cacheName = getRemoteCacheName(remoteId);
    const cache = await caches.open(cacheName);
    const response = await cache.match(cacheKey(blobId));

    if (response) {
      // update last accessed time
      if (metadata) {
        metadata.lastAccessedAt = Date.now();
        await saveMetadata(metadata);
      }

      debug(`cache hit: ${blobId.slice(0, 8)}...`);
      return response;
    }

    // cache miss - check if we thought it was cached (indicates stale metadata)
    const wasInStore = cacheStatus[metadataKey];
    if (wasInStore) {
      warn(`CACHE MISMATCH: ${blobId.slice(0, 8)}... was in cacheStatus but NOT in Cache API - removing from store`);
      removeFromCachedSet(metadataKey);
      // also clean up stale metadata
      void deleteMetadata(metadataKey);
    }
    
    debug(`cache miss: ${blobId.slice(0, 8)}...`);
    return null;
  } catch (error) {
    errorLog("failed to get cached blob:", error);
    return null;
  }
}

// check if a blob is cached for a specific remote
// returns false if metadata indicates pending/failed status
export async function isCached(remoteId: string, blobId: string): Promise<boolean> {
  try {
    const metadataKey = `${remoteId}/${blobId}`;
    const metadata = await getMetadata(metadataKey);
    
    // if metadata says pending/failed, treat as not cached
    if (metadata && (metadata.status === "pending" || metadata.status === "failed")) {
      return false;
    }
    
    const cacheName = getRemoteCacheName(remoteId);
    const cache = await caches.open(cacheName);
    const response = await cache.match(cacheKey(blobId));
    return !!response;
  } catch (error) {
    errorLog("failed to check cache:", error);
    return false;
  }
}

// evict old/unused entries based on time and dynamic cache size limits
// if remoteId is provided, only evict from that remote's cache
async function evictIfNeeded(remoteId?: string): Promise<void> {
  try {
    const storageInfo = await getStorageInfo();
    const allMetadata = remoteId ? await getMetadataByRemote(remoteId) : await getAllMetadata();
    const now = Date.now();

    const cacheSizeMB = storageInfo.cacheSize / (1024 * 1024);
    const maxCacheSizeMB = storageInfo.maxCacheSize / (1024 * 1024);

    debug(
      `cache status: ${allMetadata.length} items, ${cacheSizeMB.toFixed(1)} / ${maxCacheSizeMB.toFixed(1)} MB (${(storageInfo.totalPercentUsed * 100).toFixed(1)}% total storage)`,
    );

    let itemsToDelete: CacheMetadata[] = [];

    // critical: total storage >95% or cache is full
    if (
      storageInfo.totalPercentUsed >= TOTAL_QUOTA_CRITICAL ||
      storageInfo.cachePercentOfMax >= 1.0
    ) {
      warn("storage critical, aggressive cleanup");
      const sorted = [...allMetadata].sort(
        (a, b) => a.lastAccessedAt - b.lastAccessedAt,
      );
      // keep only the 10 most recent
      itemsToDelete = sorted.slice(0, -10);
    } else if (
      storageInfo.totalPercentUsed >= TOTAL_QUOTA_WARNING ||
      storageInfo.cachePercentOfMax >= 0.8
    ) {
      // warning: total storage >85% or cache >80% of max
      warn("storage warning, LRU cleanup");
      const sorted = [...allMetadata].sort(
        (a, b) => a.lastAccessedAt - b.lastAccessedAt,
      );
      const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
      // delete items older than 3 days or bottom 40% by LRU
      const deleteCount = Math.floor(allMetadata.length * 0.4);
      itemsToDelete = sorted.filter(
        (m, idx) => m.lastAccessedAt < threeDaysAgo || idx < deleteCount,
      );
    } else {
      // normal: delete items not accessed in 7 days
      itemsToDelete = allMetadata.filter(
        (m) => now - m.lastAccessedAt > MAX_AGE_MS,
      );
    }

    if (itemsToDelete.length > 0) {
      debug(`evicting ${itemsToDelete.length} cached items`);
      // group by remote for efficient cache access
      const byRemote = new Map<string, CacheMetadata[]>();
      for (const metadata of itemsToDelete) {
        const items = byRemote.get(metadata.remoteId) || [];
        items.push(metadata);
        byRemote.set(metadata.remoteId, items);
      }
      
      for (const [rid, items] of byRemote) {
        try {
          const cacheName = getRemoteCacheName(rid);
          const cache = await caches.open(cacheName);
          for (const metadata of items) {
            await cache.delete(cacheKey(metadata.blobId));
            await deleteMetadata(metadata.url);
            removeFromCachedSet(metadata.url);
          }
        } catch (err) {
          errorLog(`failed to evict from remote ${rid}:`, err);
        }
      }
    }
  } catch (error) {
    errorLog("failed to evict cache entries:", error);
  }
}

// pre-cache a blob URL (fetch and cache in background with retry logic)
// remoteId and blobId are required for per-remote cache management
// sha256 is optional - when provided for audio, tracks in loadingSha256s for UI feedback
export async function preCacheBlob(
  url: string,
  type: "audio" | "image",
  remoteId: string,
  blobId: string,
  maxRetries: number = 3,
  sha256?: string,
): Promise<void> {
  // skip caching for localhost/tauri remotes
  if (await shouldSkipCaching(remoteId)) {
    debug(`skipping pre-cache for local/tauri remote: ${remoteId}`);
    return;
  }

  // check if already cached
  if (await isCached(remoteId, blobId)) {
    debug(`already cached: ${blobId.slice(0, 8)}...`);
    return;
  }

  // check if already in progress
  const progressKey = `${remoteId}/${blobId}`;
  if (inProgressFetchesHas(progressKey)) {
    debug(`already in progress: ${blobId.slice(0, 8)}...`);
    return;
  }

  // if offline, add to pending queue and return
  if (!isOnline) {
    debug(`offline - adding to pending queue: ${blobId.slice(0, 8)}...`);
    addToPendingQueue(url, type, remoteId, blobId);
    return;
  }

  debug(`pre-caching blob: ${blobId.slice(0, 8)}...`);

  // mark as in progress
  inProgressFetchesAdd(progressKey);
  
  // track sha256 in reactive loading set for UI feedback (audio only)
  if (sha256 && type === "audio") {
    addToLoadingSet(sha256);
    // initialize progress as null (indeterminate until we know total size)
    updateLoadingProgress(sha256, null);
  }

  try {
    // retry with exponential backoff
    let lastError: Error | null = null;
    let expectedSize: number | undefined;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, { credentials: "include" });

        if (!response.ok) {
          throw new Error(`fetch failed: ${response.status}`);
        }

        // track download progress if we have content-length and sha256
        const contentLength = response.headers.get("Content-Length");
        const totalBytes = contentLength ? parseInt(contentLength, 10) : null;
        expectedSize = totalBytes ?? undefined;
        
        // create pending entry with expected size (for crash recovery + validation)
        // only do this on first attempt to avoid overwriting previous state
        if (attempt === 0) {
          await createPendingCacheEntry(remoteId, blobId, type, expectedSize);
        }
        
        let responseToCache: Response;
        
        if (sha256 && type === "audio" && totalBytes && response.body) {
          // stream the response to track progress
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let receivedBytes = 0;
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedBytes += value.length;
            // update progress (0-1)
            updateLoadingProgress(sha256, receivedBytes / totalBytes);
          }
          
          // concatenate chunks into single buffer
          const allChunks = new Uint8Array(receivedBytes);
          let offset = 0;
          for (const chunk of chunks) {
            allChunks.set(chunk, offset);
            offset += chunk.length;
          }
          
          // reconstruct response for caching
          const blob = new Blob([allChunks], { 
            type: response.headers.get("Content-Type") || "application/octet-stream" 
          });
          responseToCache = new Response(blob, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } else {
          // no progress tracking - use response as-is
          responseToCache = response;
        }

        // cacheBlob validates size and marks as complete
        await cacheBlob(url, responseToCache, type, remoteId, blobId, expectedSize);
        debug(`pre-cache successful after ${attempt + 1} attempt(s)`);
        return; // success!
      } catch (error) {
        lastError = error as Error;

        // if we lost connection, add to pending queue
        if (!isOnline) {
          debug(
            `lost connection during pre-cache - adding to pending queue: ${blobId.slice(0, 8)}...`,
          );
          addToPendingQueue(url, type, remoteId, blobId);
          return;
        }

        if (attempt < maxRetries - 1) {
          // exponential backoff: 1s, 2s, 4s
          const delayMs = Math.pow(2, attempt) * 1000;
          warn(
            `pre-cache attempt ${attempt + 1} failed, retrying in ${delayMs}ms...`,
            error,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // all retries failed - add to pending queue for later
    errorLog(
      `failed to pre-cache blob after ${maxRetries} attempts, adding to pending queue:`,
      lastError,
    );
    addToPendingQueue(url, type, remoteId, blobId);
  } catch (error) {
    errorLog("failed to pre-cache blob:", error);
    addToPendingQueue(url, type, remoteId, blobId);
  } finally {
    // always remove from in-progress
    inProgressFetchesDelete(progressKey);
    // remove from loading set
    if (sha256 && type === "audio") {
      removeFromLoadingSet(sha256);
    }
  }
}

// evict a specific cached blob
export async function evictCachedBlob(remoteId: string, blobId: string): Promise<void> {
  try {
    const cacheName = getRemoteCacheName(remoteId);
    const cache = await caches.open(cacheName);
    const deleted = await cache.delete(cacheKey(blobId));
    const metadataKey = `${remoteId}/${blobId}`;
    await deleteMetadata(metadataKey);

    if (deleted) {
      removeFromCachedSet(metadataKey);
      debug(`evicted cached blob: ${blobId.slice(0, 8)}...`);
    }
  } catch (error) {
    errorLog("failed to evict cached blob:", error);
  }
}

// clear all cached blobs for a specific remote (or all remotes if not specified)
export async function clearBlobCache(remoteId?: string): Promise<void> {
  try {
    if (remoteId) {
      // clear specific remote's cache
      const cacheName = getRemoteCacheName(remoteId);
      await caches.delete(cacheName);
      
      // clear metadata for this remote
      const metadata = await getMetadataByRemote(remoteId);
      for (const m of metadata) {
        await deleteMetadata(m.url);
        removeFromCachedSet(m.url);
      }
      debug(`cleared blob cache for remote: ${remoteId}`);
    } else {
      // clear all remote caches
      const remoteCaches = await listRemoteBlobCaches();
      for (const cacheName of remoteCaches) {
        await caches.delete(cacheName);
      }
      
      // clear all metadata
      const db = await initMetadataDB();
      const tx = db.transaction(METADATA_STORE_NAME, "readwrite");
      const store = tx.objectStore(METADATA_STORE_NAME);
      await store.clear();
      clearCachedSet();
      debug("cleared all blob caches");
    }
  } catch (error) {
    errorLog("failed to clear cache:", error);
  }
}

// get cache stats
export async function getCacheStats(): Promise<{
  itemCount: number;
  totalSize: number;
  oldestItem: number | null;
  newestItem: number | null;
  cacheSizeMB: number;
  maxCacheSizeMB: number;
  totalStorageUsedMB: number;
  totalStorageQuotaMB: number;
  totalPercentUsed: number;
}> {
  try {
    const storageInfo = await getStorageInfo();
    const allMetadata = await getAllMetadata();

    const oldestItem =
      allMetadata.length > 0
        ? Math.min(...allMetadata.map((m) => m.lastAccessedAt))
        : null;
    const newestItem =
      allMetadata.length > 0
        ? Math.max(...allMetadata.map((m) => m.lastAccessedAt))
        : null;

    return {
      itemCount: allMetadata.length,
      totalSize: storageInfo.cacheSize,
      oldestItem,
      newestItem,
      cacheSizeMB: storageInfo.cacheSize / (1024 * 1024),
      maxCacheSizeMB: storageInfo.maxCacheSize / (1024 * 1024),
      totalStorageUsedMB: storageInfo.totalUsage / (1024 * 1024),
      totalStorageQuotaMB: storageInfo.totalQuota / (1024 * 1024),
      totalPercentUsed: storageInfo.totalPercentUsed,
    };
  } catch (error) {
    errorLog("failed to get cache stats:", error);
    return {
      itemCount: 0,
      totalSize: 0,
      oldestItem: null,
      newestItem: null,
      cacheSizeMB: 0,
      maxCacheSizeMB: 0,
      totalStorageUsedMB: 0,
      totalStorageQuotaMB: 0,
      totalPercentUsed: 0,
    };
  }
}

// per-remote cache stats type
export interface RemoteCacheStats {
  remoteId: string;
  itemCount: number;
  totalSize: number;
  audioCount: number;
  audioSize: number;
  imageCount: number;
  imageSize: number;
}

// get cache stats for a specific remote
export async function getRemoteCacheStats(remoteId: string): Promise<RemoteCacheStats> {
  try {
    const metadata = await getMetadataByRemote(remoteId);
    
    let audioCount = 0;
    let audioSize = 0;
    let imageCount = 0;
    let imageSize = 0;
    
    for (const m of metadata) {
      if (m.type === "audio") {
        audioCount++;
        audioSize += m.size || 0;
      } else if (m.type === "image") {
        imageCount++;
        imageSize += m.size || 0;
      }
    }
    
    return {
      remoteId,
      itemCount: metadata.length,
      totalSize: audioSize + imageSize,
      audioCount,
      audioSize,
      imageCount,
      imageSize,
    };
  } catch (error) {
    errorLog(`failed to get cache stats for remote ${remoteId}:`, error);
    return {
      remoteId,
      itemCount: 0,
      totalSize: 0,
      audioCount: 0,
      audioSize: 0,
      imageCount: 0,
      imageSize: 0,
    };
  }
}

// get cache stats for all remotes
export async function getAllRemoteCacheStats(): Promise<RemoteCacheStats[]> {
  try {
    const allMetadata = await getAllMetadata();
    
    // group by remoteId
    const byRemote = new Map<string, CacheMetadata[]>();
    for (const m of allMetadata) {
      if (!m.remoteId) continue;
      const existing = byRemote.get(m.remoteId) || [];
      existing.push(m);
      byRemote.set(m.remoteId, existing);
    }
    
    const stats: RemoteCacheStats[] = [];
    for (const [remoteId, metadata] of byRemote) {
      let audioCount = 0;
      let audioSize = 0;
      let imageCount = 0;
      let imageSize = 0;
      
      for (const m of metadata) {
        if (m.type === "audio") {
          audioCount++;
          audioSize += m.size || 0;
        } else if (m.type === "image") {
          imageCount++;
          imageSize += m.size || 0;
        }
      }
      
      stats.push({
        remoteId,
        itemCount: metadata.length,
        totalSize: audioSize + imageSize,
        audioCount,
        audioSize,
        imageCount,
        imageSize,
      });
    }
    
    return stats;
  } catch (error) {
    errorLog("failed to get all remote cache stats:", error);
    return [];
  }
}

// add item to pending cache queue (for retry when online)
function addToPendingQueue(url: string, type: "audio" | "image", remoteId: string, blobId: string): void {
  // check if already in queue
  const queueKey = `${remoteId}/${blobId}`;
  if (pendingCacheQueue.some((item) => `${item.remoteId}/${item.blobId}` === queueKey)) {
    return;
  }

  pendingCacheQueue.push({
    url,
    type,
    remoteId,
    blobId,
    retries: 0,
    addedAt: Date.now(),
  });

  debug(`added to pending cache queue: ${blobId.slice(0, 8)}...`);
}

// process pending cache queue (attempt to cache failed items)
async function processPendingQueue(): Promise<void> {
  if (processingPending || !isOnline || pendingCacheQueue.length === 0) {
    return;
  }

  processingPending = true;
  debug(
    `processing pending cache queue (${pendingCacheQueue.length} items)`,
  );

  const maxRetries = 3;
  const itemsToProcess = [...pendingCacheQueue];
  pendingCacheQueue = [];

  for (const item of itemsToProcess) {
    try {
      // check if we're still online
      if (!isOnline) {
        // re-add remaining items to queue
        pendingCacheQueue.push(item);
        continue;
      }

      // check if already cached (might have been cached by another process)
      if (await isCached(item.remoteId, item.blobId)) {
        debug(`pending item already cached: ${item.blobId.slice(0, 8)}...`);
        continue;
      }

      // attempt to fetch and cache
      const response = await fetch(item.url, { credentials: "include" });

      if (!response.ok) {
        throw new Error(`fetch failed: ${response.status}`);
      }

      await cacheBlob(item.url, response, item.type, item.remoteId, item.blobId);
      debug(`successfully cached pending item: ${item.blobId.slice(0, 8)}...`);
    } catch (error) {
      warn(
        `failed to cache pending item (attempt ${item.retries + 1}):`,
        error,
      );

      // re-add to queue if under retry limit
      if (item.retries < maxRetries - 1) {
        pendingCacheQueue.push({
          ...item,
          retries: item.retries + 1,
        });
      } else {
        errorLog(
          `giving up on pending item after ${maxRetries} attempts: ${item.blobId.slice(0, 8)}...`,
        );
      }
    }
  }

  processingPending = false;

  // if there are still items in queue, schedule another processing attempt
  if (pendingCacheQueue.length > 0 && isOnline) {
    setTimeout(() => void processPendingQueue(), 5000); // retry in 5 seconds
  }
}

// handle online event - resume pending cache jobs
function handleOnline(): void {
  debug("network connection restored, resuming cache operations");
  isOnline = true;
  void processPendingQueue();
}

// handle offline event - pause cache operations
function handleOffline(): void {
  debug("network connection lost, pausing cache operations");
  isOnline = false;
}

// initialize online/offline handlers (call once at app startup)
export function initCacheNetworkHandlers(): void {
  if (typeof window === "undefined") return;

  // set initial state
  isOnline = navigator.onLine;

  // add event listeners
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  debug("cache network handlers initialized");
}

// cleanup online/offline handlers (call at app teardown)
export function cleanupCacheNetworkHandlers(): void {
  if (typeof window === "undefined") return;

  window.removeEventListener("online", handleOnline);
  window.removeEventListener("offline", handleOffline);

  debug("cache network handlers cleaned up");
}

// get pending queue status (for debugging/monitoring)
export function getPendingQueueStatus(): {
  itemCount: number;
  items: Array<{ url: string; type: string; retries: number; addedAt: number }>;
} {
  return {
    itemCount: pendingCacheQueue.length,
    items: pendingCacheQueue.map((item) => ({
      url: item.url,
      type: item.type,
      retries: item.retries,
      addedAt: item.addedAt,
    })),
  };
}

// get next songs to cache based on target duration
export function getNextSongsToCache(
  currentSongId: string | null,
  queue: Array<{
    sha256: string;
    duration_seconds: number;
    source_type: string;
    source_url?: string | null;
    images?: ImageMetadata[] | null;
    remote_server_id?: string | null;
  }>,
  targetMinutes: number = 30,
): Array<{ sha256: string; source_url: string; remote_id: string; waveform_url?: string; waveform_blob_id?: string }> {
  if (!currentSongId || queue.length === 0) {
    return [];
  }

  // find current song index
  const currentIdx = queue.findIndex((s) => s.sha256 === currentSongId);
  if (currentIdx < 0 || currentIdx >= queue.length - 1) {
    return [];
  }

  const songsToCache: Array<{ sha256: string; source_url: string; remote_id: string; waveform_url?: string; waveform_blob_id?: string }> = [];
  let totalSeconds = 0;
  const targetSeconds = targetMinutes * 60;

  // iterate from next song onwards
  for (let i = currentIdx + 1; i < queue.length; i++) {
    const song = queue[i];

    // only cache remote songs with source URLs and remote_server_id
    if (song.source_type !== "remote" || !song.source_url || !song.remote_server_id) {
      continue;
    }

    // get waveform URL if available
    const waveformImage = getWaveformImage(song.images);
    const waveform_url = waveformImage?.remote_url || undefined;
    // extract blob_id from waveform URL path (e.g., /api/blobs/abc123 -> abc123)
    const waveform_blob_id = waveform_url ? waveform_url.split('/').pop() : undefined;

    songsToCache.push({
      sha256: song.sha256,
      source_url: song.source_url,
      remote_id: song.remote_server_id,
      waveform_url,
      waveform_blob_id,
    });

    totalSeconds += song.duration_seconds || 0;

    // stop when we've reached target duration
    if (totalSeconds >= targetSeconds) {
      break;
    }
  }

  return songsToCache;
}

// pre-cache multiple songs (rolling 30-minute cache)
export async function preCacheNextSongs(
  currentSongId: string | null,
  queue: Array<{
    sha256: string;
    duration_seconds: number;
    source_type: string;
    source_url?: string | null;
    images?: ImageMetadata[] | null;
    remote_server_id?: string | null;
  }>,
  targetMinutes: number = 30,
): Promise<void> {
  try {
    const songsToCache = getNextSongsToCache(
      currentSongId,
      queue,
      targetMinutes,
    );

    if (songsToCache.length === 0) {
      debug("no songs to pre-cache");
      return;
    }

    debug(
      `pre-caching next ${songsToCache.length} songs (~${targetMinutes} min)`,
    );

    // cache songs in order (nearest first), but don't wait for each one
    // use Promise.allSettled to allow parallel fetching without blocking
    const cachePromises = songsToCache.map(async (song) => {
      const results = { audio: "skipped", waveform: "skipped" };
      const progressKey = `${song.remote_id}/${song.sha256}`;

      // skip P2P remotes - they're handled by preCacheNextP2PSongs in blobResolver
      // (HTTP fetch doesn't work for P2P remotes and would cache bad data)
      if (await isP2PRemote(song.remote_id)) {
        results.audio = "p2p_remote";
        results.waveform = "p2p_remote";
        return results;
      }

      // cache audio (pass sha256 for loading tracking)
      if (await isCached(song.remote_id, song.sha256)) {
        results.audio = "already_cached";
      } else if (inProgressFetchesHas(progressKey)) {
        results.audio = "in_progress";
      } else {
        void preCacheBlob(song.source_url, "audio", song.remote_id, song.sha256, 3, song.sha256);
        results.audio = "started";
      }

      // cache waveform image if available
      if (song.waveform_url && song.waveform_blob_id) {
        const waveformProgressKey = `${song.remote_id}/${song.waveform_blob_id}`;
        if (await isCached(song.remote_id, song.waveform_blob_id)) {
          results.waveform = "already_cached";
        } else if (inProgressFetchesHas(waveformProgressKey)) {
          results.waveform = "in_progress";
        } else {
          void preCacheBlob(song.waveform_url, "image", song.remote_id, song.waveform_blob_id);
          results.waveform = "started";
        }
      }

      return results;
    });

    const results = await Promise.allSettled(cachePromises);

    const audioStarted = results.filter(
      (r) => r.status === "fulfilled" && r.value.audio === "started",
    ).length;
    const waveformStarted = results.filter(
      (r) => r.status === "fulfilled" && r.value.waveform === "started",
    ).length;

    debug(
      `pre-cache summary: ${audioStarted} audio started, ${waveformStarted} waveforms started`,
    );
  } catch (error) {
    errorLog("failed to pre-cache next songs:", error);
  }
}
