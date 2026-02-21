// blob cache manager for remote audio/image caching
// uses hybrid time-based + LRU eviction strategy

import { createSignal } from "solid-js";
import { debug, warn, error as errorLog } from "../../../utils/logger";

const CACHE_NAME = "freqhole-blobs-v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// reactive set of cached audio URLs for UI feedback
const [cachedAudioURLs, setCachedAudioURLs] = createSignal<Set<string>>(new Set());

// check if a URL is in the reactive cache set (for UI binding)
export function isBlobCachedReactive(url: string | null | undefined): boolean {
  if (!url) return false;
  return cachedAudioURLs().has(url);
}

function addToCachedSet(url: string): void {
  setCachedAudioURLs((prev) => {
    const next = new Set(prev);
    next.add(url);
    return next;
  });
}

function removeFromCachedSet(url: string): void {
  setCachedAudioURLs((prev) => {
    if (!prev.has(url)) return prev;
    const next = new Set(prev);
    next.delete(url);
    return next;
  });
}

function clearCachedSet(): void {
  setCachedAudioURLs(new Set<string>());
}

// seed the reactive set from existing cache metadata on startup
export async function initCachedAudioURLs(): Promise<void> {
  try {
    const allMetadata = await getAllMetadata();
    const audioUrls = new Set(
      allMetadata
        .filter((m) => m.type === "audio")
        .map((m) => m.url),
    );
    setCachedAudioURLs(audioUrls);
    debug(`initialized cached audio URL set with ${audioUrls.size} entries`);
  } catch (error) {
    errorLog("failed to initialize cached audio URL set:", error);
  }
}

// pending cache queue - tracks URLs waiting to be cached
interface PendingCacheItem {
  url: string;
  type: "audio" | "image";
  retries: number;
  addedAt: number;
}

let pendingCacheQueue: PendingCacheItem[] = [];
let isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
let processingPending = false;

// in-progress cache fetches - tracks URLs currently being fetched
const inProgressFetches = new Set<string>();

// dynamic cache size limits based on available storage
// reserve 10% of total quota for cache, but respect minimum headroom
const CACHE_QUOTA_PERCENT = 0.1; // use up to 10% of total storage for cache
const MIN_HEADROOM_MB = 100; // always leave at least 100MB free
const TOTAL_QUOTA_WARNING = 0.85; // warn if total storage >85% full
const TOTAL_QUOTA_CRITICAL = 0.95; // critical if total storage >95% full

interface CacheMetadata {
  url: string;
  cachedAt: number;
  lastAccessedAt: number;
  size: number;
  type: "audio" | "image";
}

// metadata store (in indexeddb for persistence)
const METADATA_DB_NAME = "freqhole_cache_metadata";
const METADATA_STORE_NAME = "blob_metadata";

let metadataDB: IDBDatabase | null = null;
const METADATA_DB_VERSION = 2; // bump version to ensure schema upgrade

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
      if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) {
        const store = db.createObjectStore(METADATA_STORE_NAME, {
          keyPath: "url",
        });
        store.createIndex("lastAccessedAt", "lastAccessedAt", {
          unique: false,
        });
      }
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

// cache a blob (audio or image)
export async function cacheBlob(
  url: string,
  response: Response,
  type: "audio" | "image",
): Promise<void> {
  try {
    // check if we have space before caching
    const storageInfo = await getStorageInfo();

    // don't cache if total storage is critical
    if (storageInfo.totalPercentUsed >= TOTAL_QUOTA_CRITICAL) {
      warn(
        `total storage critical (${(storageInfo.totalPercentUsed * 100).toFixed(1)}%), skipping cache`,
      );
      return;
    }

    const cache = await caches.open(CACHE_NAME);

    // clone response to read size
    const clonedResponse = response.clone();
    const blob = await clonedResponse.blob();
    const size = blob.size;

    // cache the response
    await cache.put(url, response);

    // save metadata
    const metadata: CacheMetadata = {
      url,
      cachedAt: Date.now(),
      lastAccessedAt: Date.now(),
      size,
      type,
    };
    await saveMetadata(metadata);

    debug(`cached blob: ${url} (${(size / 1024).toFixed(1)} kb)`);

    // update reactive cache set for audio blobs
    if (type === "audio") {
      addToCachedSet(url);
    }

    // check if we need to evict old entries
    await evictIfNeeded();
  } catch (error) {
    errorLog("failed to cache blob:", error);
  }
}

// get a blob from cache (and update last accessed time)
export async function getCachedBlob(url: string): Promise<Response | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);

    if (response) {
      // update last accessed time
      const metadata = await getMetadata(url);
      if (metadata) {
        metadata.lastAccessedAt = Date.now();
        await saveMetadata(metadata);
      }

      debug(`cache hit: ${url}`);
      return response;
    }

    debug(`cache miss: ${url}`);
    return null;
  } catch (error) {
    errorLog("failed to get cached blob:", error);
    return null;
  }
}

// check if a url is cached
export async function isCached(url: string): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);
    return !!response;
  } catch (error) {
    errorLog("failed to check cache:", error);
    return false;
  }
}

// evict old/unused entries based on time and dynamic cache size limits
async function evictIfNeeded(): Promise<void> {
  try {
    const storageInfo = await getStorageInfo();
    const allMetadata = await getAllMetadata();
    const now = Date.now();
    const cache = await caches.open(CACHE_NAME);

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
      for (const metadata of itemsToDelete) {
        await cache.delete(metadata.url);
        await deleteMetadata(metadata.url);
        removeFromCachedSet(metadata.url);
      }
    }
  } catch (error) {
    errorLog("failed to evict cache entries:", error);
  }
}

// pre-cache a blob URL (fetch and cache in background with retry logic)
export async function preCacheBlob(
  url: string,
  type: "audio" | "image",
  maxRetries: number = 3,
): Promise<void> {
  // check if already cached
  if (await isCached(url)) {
    debug(`already cached: ${url}`);
    return;
  }

  // check if already in progress
  if (inProgressFetches.has(url)) {
    debug(`already in progress: ${url}`);
    return;
  }

  // if offline, add to pending queue and return
  if (!isOnline) {
    debug(`offline - adding to pending queue: ${url}`);
    addToPendingQueue(url, type);
    return;
  }

  debug(`pre-caching blob: ${url}`);

  // mark as in progress
  inProgressFetches.add(url);

  try {
    // retry with exponential backoff
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, { credentials: "include" });

        if (!response.ok) {
          throw new Error(`fetch failed: ${response.status}`);
        }

        await cacheBlob(url, response, type);
        debug(`pre-cache successful after ${attempt + 1} attempt(s)`);
        return; // success!
      } catch (error) {
        lastError = error as Error;

        // if we lost connection, add to pending queue
        if (!isOnline) {
          debug(
            `lost connection during pre-cache - adding to pending queue: ${url}`,
          );
          addToPendingQueue(url, type);
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
    addToPendingQueue(url, type);
  } catch (error) {
    errorLog("failed to pre-cache blob:", error);
    addToPendingQueue(url, type);
  } finally {
    // always remove from in-progress
    inProgressFetches.delete(url);
  }
}

// evict a specific cached blob by URL
export async function evictCachedBlob(url: string): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const deleted = await cache.delete(url);
    await deleteMetadata(url);

    if (deleted) {
      removeFromCachedSet(url);
      debug(`evicted cached blob: ${url}`);
    }
  } catch (error) {
    errorLog("failed to evict cached blob:", error);
  }
}

// clear all cached blobs
export async function clearBlobCache(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME);
    const db = await initMetadataDB();
    const tx = db.transaction(METADATA_STORE_NAME, "readwrite");
    const store = tx.objectStore(METADATA_STORE_NAME);
    await store.clear();
    clearCachedSet();
    debug("blob cache cleared");
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

// add item to pending cache queue (for retry when online)
function addToPendingQueue(url: string, type: "audio" | "image"): void {
  // check if already in queue
  if (pendingCacheQueue.some((item) => item.url === url)) {
    return;
  }

  pendingCacheQueue.push({
    url,
    type,
    retries: 0,
    addedAt: Date.now(),
  });

  debug(`added to pending cache queue: ${url}`);
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
      if (await isCached(item.url)) {
        debug(`pending item already cached: ${item.url}`);
        continue;
      }

      // attempt to fetch and cache
      const response = await fetch(item.url, { credentials: "include" });

      if (!response.ok) {
        throw new Error(`fetch failed: ${response.status}`);
      }

      await cacheBlob(item.url, response, item.type);
      debug(`successfully cached pending item: ${item.url}`);
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
          `giving up on pending item after ${maxRetries} attempts: ${item.url}`,
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
  }>,
  targetMinutes: number = 30,
): Array<{ sha256: string; source_url: string }> {
  if (!currentSongId || queue.length === 0) {
    return [];
  }

  // find current song index
  const currentIdx = queue.findIndex((s) => s.sha256 === currentSongId);
  if (currentIdx < 0 || currentIdx >= queue.length - 1) {
    return [];
  }

  const songsToCache: Array<{ sha256: string; source_url: string }> = [];
  let totalSeconds = 0;
  const targetSeconds = targetMinutes * 60;

  // iterate from next song onwards
  for (let i = currentIdx + 1; i < queue.length; i++) {
    const song = queue[i];

    // only cache remote songs with source URLs
    if (song.source_type !== "remote" || !song.source_url) {
      continue;
    }

    songsToCache.push({
      sha256: song.sha256,
      source_url: song.source_url,
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
      // check if already cached or in progress
      if (await isCached(song.source_url)) {
        return { status: "already_cached", url: song.source_url };
      }

      if (inProgressFetches.has(song.source_url)) {
        return { status: "in_progress", url: song.source_url };
      }

      // start pre-caching (non-blocking)
      void preCacheBlob(song.source_url, "audio");
      return { status: "started", url: song.source_url };
    });

    const results = await Promise.allSettled(cachePromises);

    const started = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === "started",
    ).length;
    const alreadyCached = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === "already_cached",
    ).length;
    const inProgress = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === "in_progress",
    ).length;

    debug(
      `pre-cache summary: ${started} started, ${alreadyCached} already cached, ${inProgress} in progress`,
    );
  } catch (error) {
    errorLog("failed to pre-cache next songs:", error);
  }
}

// clear in-progress tracking (useful when queue changes)
export function clearInProgressTracking(): void {
  inProgressFetches.clear();
  debug("cleared in-progress cache tracking");
}
