// storage manager - utilities for measuring and clearing app storage
// handles cache api, opfs, and indexeddb data

import { MUSIC_DB_NAME } from "../../music/services/storage/types";
import { closeMusicDB } from "../../music/services/storage/db/init";
import { closeBlobDB, BLOB_DB_NAME } from "../../music/services/storage/blobs";
import { APP_DB_NAME } from "../../app/services/storage/types";
import { closeAppDB } from "../../app/services/storage/db";
import { closeMetadataDB, clearBlobCache, listRemoteBlobCaches } from "../../music/services/cache/blobCache";
import { clearAllP2PCache } from "../../music/services/storage/blobResolver";
import { debug } from "../../utils/logger";

const CACHE_METADATA_DB_NAME = "freqhole_cache_metadata";

// opfs directories
const OPFS_AUDIO_DIR = "audio";
const OPFS_THUMBNAILS_DIR = "thumbnails";

export interface StorageBreakdown {
  cacheApi: {
    size: number;
    entryCount: number;
  };
  opfs: {
    size: number;
    audioSize: number;
    thumbnailsSize: number;
    audioCount: number;
    thumbnailCount: number;
  };
  indexedDb: {
    musicDbSize: number;
    appDbSize: number;
    cacheMetadataDbSize: number;
    totalSize: number;
  };
  total: {
    usage: number;
    quota: number;
    percentUsed: number;
  };
}

// estimate storage usage for a single indexeddb database
async function estimateIDBSize(dbName: string): Promise<number> {
  return new Promise((resolve) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => resolve(0);
    request.onsuccess = () => {
      const db = request.result;
      let totalSize = 0;
      const storeNames = Array.from(db.objectStoreNames);
      
      if (storeNames.length === 0) {
        db.close();
        resolve(0);
        return;
      }

      let processed = 0;
      
      for (const storeName of storeNames) {
        try {
          const tx = db.transaction(storeName, "readonly");
          const store = tx.objectStore(storeName);
          const countReq = store.count();
          const getAllReq = store.getAll();
          
          getAllReq.onsuccess = () => {
            const data = getAllReq.result;
            // estimate size by serializing to JSON
            try {
              totalSize += new Blob([JSON.stringify(data)]).size;
            } catch {
              // fallback: rough estimate based on count
              totalSize += (countReq.result || 0) * 1024;
            }
            processed++;
            if (processed === storeNames.length) {
              db.close();
              resolve(totalSize);
            }
          };
          
          getAllReq.onerror = () => {
            processed++;
            if (processed === storeNames.length) {
              db.close();
              resolve(totalSize);
            }
          };
        } catch {
          processed++;
          if (processed === storeNames.length) {
            db.close();
            resolve(totalSize);
          }
        }
      }
    };
  });
}

// get cache api storage size and entry count (aggregates all per-remote caches)
async function getCacheApiStats(): Promise<{ size: number; entryCount: number }> {
  try {
    const cacheNames = await listRemoteBlobCaches();
    let totalSize = 0;
    let totalEntryCount = 0;
    
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      totalEntryCount += keys.length;
      
      for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          totalSize += blob.size;
        }
      }
    }
    
    return { size: totalSize, entryCount: totalEntryCount };
  } catch (error) {
    console.warn("failed to get cache api stats:", error);
    return { size: 0, entryCount: 0 };
  }
}

// get opfs storage stats
async function getOPFSStats(): Promise<{
  audioSize: number;
  thumbnailsSize: number;
  audioCount: number;
  thumbnailCount: number;
}> {
  try {
    if (!("storage" in navigator) || !navigator.storage.getDirectory) {
      return { audioSize: 0, thumbnailsSize: 0, audioCount: 0, thumbnailCount: 0 };
    }
    
    const root = await navigator.storage.getDirectory();
    let audioSize = 0;
    let thumbnailsSize = 0;
    let audioCount = 0;
    let thumbnailCount = 0;
    
    // count audio directory
    try {
      const audioDir = await root.getDirectoryHandle(OPFS_AUDIO_DIR);
      for await (const entry of (audioDir as any).values()) {
        if (entry.kind === "file") {
          const file = await entry.getFile();
          audioSize += file.size;
          audioCount++;
        }
      }
    } catch {
      // directory doesn't exist
    }
    
    // count thumbnails directory
    try {
      const thumbDir = await root.getDirectoryHandle(OPFS_THUMBNAILS_DIR);
      for await (const entry of (thumbDir as any).values()) {
        if (entry.kind === "file") {
          const file = await entry.getFile();
          thumbnailsSize += file.size;
          thumbnailCount++;
        }
      }
    } catch {
      // directory doesn't exist
    }
    
    return { audioSize, thumbnailsSize, audioCount, thumbnailCount };
  } catch (error) {
    console.warn("failed to get opfs stats:", error);
    return { audioSize: 0, thumbnailsSize: 0, audioCount: 0, thumbnailCount: 0 };
  }
}

// get complete storage breakdown
export async function getStorageBreakdown(): Promise<StorageBreakdown> {
  // get overall storage estimate
  let usage = 0;
  let quota = 0;
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    usage = estimate.usage || 0;
    quota = estimate.quota || 0;
  }
  
  // get cache api stats
  const cacheStats = await getCacheApiStats();
  
  // get opfs stats
  const opfsStats = await getOPFSStats();
  
  // get indexeddb sizes
  const [musicDbSize, appDbSize, cacheMetadataDbSize] = await Promise.all([
    estimateIDBSize(MUSIC_DB_NAME),
    estimateIDBSize(APP_DB_NAME),
    estimateIDBSize(CACHE_METADATA_DB_NAME),
  ]);
  
  return {
    cacheApi: {
      size: cacheStats.size,
      entryCount: cacheStats.entryCount,
    },
    opfs: {
      size: opfsStats.audioSize + opfsStats.thumbnailsSize,
      audioSize: opfsStats.audioSize,
      thumbnailsSize: opfsStats.thumbnailsSize,
      audioCount: opfsStats.audioCount,
      thumbnailCount: opfsStats.thumbnailCount,
    },
    indexedDb: {
      musicDbSize,
      appDbSize,
      cacheMetadataDbSize,
      totalSize: musicDbSize + appDbSize + cacheMetadataDbSize,
    },
    total: {
      usage,
      quota,
      percentUsed: quota > 0 ? Math.round((usage / quota) * 100) : 0,
    },
  };
}

// delete all cache api data (HTTP + P2P blobs in per-remote caches)
export async function clearCacheApiData(): Promise<void> {
  const errors: string[] = [];
  
  // clear all per-remote blob caches
  try {
    await clearBlobCache(); // no remoteId = clear all remote caches
    debug("storageManager", "cleared all per-remote blob caches");
  } catch (error) {
    console.error("failed to clear blob caches:", error);
    errors.push("blob caches");
  }
  
  // clear P2P in-memory URLs
  try {
    await clearAllP2PCache();
    debug("storageManager", "cleared P2P in-memory URLs");
  } catch (error) {
    console.error("failed to clear P2P in-memory URLs:", error);
    errors.push("P2P in-memory");
  }
  
  // clear cache metadata IndexedDB
  try {
    closeMetadataDB(); // close connection first
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(CACHE_METADATA_DB_NAME);
      request.onsuccess = () => {
        debug("storageManager", "deleted cache metadata database");
        resolve();
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        console.warn("cache metadata db deletion blocked");
        setTimeout(resolve, 500);
      };
    });
  } catch (error) {
    console.error("failed to clear cache metadata db:", error);
    errors.push("cache metadata");
  }
  
  if (errors.length > 0) {
    throw new Error(`failed to clear: ${errors.join(", ")}`);
  }
  
  debug("storageManager", "cleared all cache data");
}

// delete all opfs data
export async function clearOPFSData(): Promise<void> {
  try {
    if (!("storage" in navigator) || !navigator.storage.getDirectory) {
      throw new Error("opfs not supported");
    }
    
    const root = await navigator.storage.getDirectory();
    
    // remove audio directory
    try {
      await root.removeEntry(OPFS_AUDIO_DIR, { recursive: true });
      debug("storageManager", "removed opfs audio directory");
    } catch {
      // directory doesn't exist, that's fine
    }
    
    // remove thumbnails directory
    try {
      await root.removeEntry(OPFS_THUMBNAILS_DIR, { recursive: true });
      debug("storageManager", "removed opfs thumbnails directory");
    } catch {
      // directory doesn't exist, that's fine
    }
    
    debug("storageManager", "cleared opfs data");
  } catch (error) {
    console.error("failed to clear opfs data:", error);
    throw error;
  }
}

// delete freqhole_music indexeddb
export async function clearMusicDbData(): Promise<void> {
  return new Promise((resolve, reject) => {
    // close any open connections first
    const request = indexedDB.deleteDatabase(MUSIC_DB_NAME);
    
    request.onsuccess = () => {
      debug("storageManager", "deleted music database");
      resolve();
    };
    
    request.onerror = () => {
      console.error("failed to delete music database:", request.error);
      reject(request.error);
    };
    
    request.onblocked = () => {
      console.warn("music database deletion blocked - other tabs may be using it");
      // still resolve after a delay, the deletion will complete when tabs close
      setTimeout(resolve, 1000);
    };
  });
}

// delete all data (cache api, opfs, all indexeddb)
export async function clearAllData(): Promise<void> {
  const errors: Error[] = [];
  
  // close all database connections first - critical for Safari!
  // if connections remain open, deletion will be "blocked" and silently fail
  debug("storageManager", "closing database connections...");
  try {
    closeAppDB();
  } catch (e) {
    console.warn("[clearAllData] error closing app db:", e);
  }
  try {
    closeMusicDB();
  } catch (e) {
    console.warn("[clearAllData] error closing music db:", e);
  }
  try {
    closeBlobDB();
  } catch (e) {
    console.warn("[clearAllData] error closing blob db:", e);
  }
  try {
    closeMetadataDB();
  } catch (e) {
    console.warn("[clearAllData] error closing metadata db:", e);
  }
  
  // small delay to ensure connections are fully closed
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // clear cache api
  try {
    await clearCacheApiData();
  } catch (error) {
    errors.push(error as Error);
  }

  // clear all caches (including service worker caches)
  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    debug("storageManager", `cleared ${cacheNames.length} cache(s)`);
  } catch (error) {
    errors.push(error as Error);
  }
  
  // clear opfs
  try {
    await clearOPFSData();
  } catch (error) {
    errors.push(error as Error);
  }
  
  // delete all known indexeddb databases
  const dbNames = [MUSIC_DB_NAME, APP_DB_NAME, BLOB_DB_NAME, CACHE_METADATA_DB_NAME];
  
  for (const dbName of dbNames) {
    try {
      await new Promise<void>((resolve, reject) => {
        debug("storageManager", `deleting database: ${dbName}`);
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => {
          debug("storageManager", `successfully deleted database: ${dbName}`);
          resolve();
        };
        request.onerror = () => {
          console.error(`[clearAllData] error deleting database: ${dbName}`, request.error);
          reject(request.error);
        };
        request.onblocked = () => {
          // database is blocked by open connections - this is expected
          // the deletion will complete when the page reloads (which happens after this fn)
          console.warn(`[clearAllData] database deletion blocked: ${dbName} - will complete on page reload`);
          resolve(); // don't reject, the reload will close connections
        };
      });
    } catch (error) {
      errors.push(error as Error);
    }
  }
  
  if (errors.length > 0) {
    console.error("[clearAllData] some errors during clear all:", errors);
    throw new Error(`failed to clear some data: ${errors.map(e => e.message).join(", ")}`);
  }
  
  debug("storageManager", "cleared all data successfully");
}

// format bytes to human readable string
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
