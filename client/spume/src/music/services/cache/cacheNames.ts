// cache naming utilities - separate to avoid circular deps
// used by both client.ts and blobCache.ts

// ===== per-remote cache naming =====
// cache names follow pattern: freqhole-blobs-{remoteId}
// this allows easy per-remote stats, clearing, and cleanup on remote deletion

export const REMOTE_CACHE_PREFIX = "freqhole-blobs-";

/** get cache name for a specific remote */
export function getRemoteCacheName(remoteId: string): string {
  return `${REMOTE_CACHE_PREFIX}${remoteId}`;
}

/** check if a cache name is a remote blob cache */
export function isRemoteBlobCache(cacheName: string): boolean {
  return cacheName.startsWith(REMOTE_CACHE_PREFIX);
}

/** extract remoteId from cache name */
export function getRemoteIdFromCacheName(cacheName: string): string | null {
  if (!isRemoteBlobCache(cacheName)) return null;
  return cacheName.slice(REMOTE_CACHE_PREFIX.length);
}

/** list all remote blob cache names */
export async function listRemoteBlobCaches(): Promise<string[]> {
  const allCaches = await caches.keys();
  return allCaches.filter(isRemoteBlobCache);
}
