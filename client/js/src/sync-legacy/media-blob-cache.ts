//! Media Blob Binary Data Cache Manager
//!
//! This module provides offline caching of media blob binary data in IndexedDB.
//! It separates binary data storage from structured sync data to avoid JSON
//! serialization issues and provides efficient blob URL generation for media playback.

import type { MediaBlob } from "../lib/websocket-types.js";
import type { WebSocketClient } from "../lib/websocket-client.js";
import type { IBlobCache } from "./blob-cache-interface.js";

/**
 * Binary data cache entry
 */
export interface CachedBinaryData {
  /** Media blob ID (short hash) */
  id: string;
  /** Binary data as Uint8Array */
  data: Uint8Array;
  /** MIME type */
  mime: string;
  /** File size in bytes */
  size: number;
  /** Cache timestamp */
  cached_at: string;
  /** Blob URL (created on demand) */
  blobUrl?: string;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total cached items */
  totalItems: number;
  /** Total cache size in bytes */
  totalSize: number;
  /** Number of active blob URLs */
  activeBlobUrls: number;
  /** Cache hit rate (0-1) */
  hitRate: number;
  /** Last cleanup timestamp */
  lastCleanup?: string;
}

/**
 * Cache configuration
 */
export interface MediaBlobCacheConfig {
  /** Database name */
  dbName: string;
  /** Maximum cache size in bytes (default: 500MB) */
  maxCacheSize: number;
  /** Maximum age for cached items in days (default: 30) */
  maxAge: number;
  /** Batch size for processing (default: 10) */
  batchSize: number;
  /** Enable automatic cleanup (default: true) */
  autoCleanup: boolean;
}

/**
 * Cache events
 */
export enum CacheEventType {
  CACHE_HIT = "cache_hit",
  CACHE_MISS = "cache_miss",
  ITEM_CACHED = "item_cached",
  ITEM_REMOVED = "item_removed",
  CLEANUP_STARTED = "cleanup_started",
  CLEANUP_COMPLETED = "cleanup_completed",
  ERROR = "error",
}

/**
 * Media Blob Binary Data Cache Manager
 */
export class MediaBlobCache extends EventTarget implements IBlobCache {
  private config: MediaBlobCacheConfig;
  private db?: IDBDatabase;
  private isInitialized: boolean = false;
  private blobUrls: Map<string, string> = new Map();
  private requestQueue: Set<string> = new Set();
  private cacheHits: number = 0;
  private cacheRequests: number = 0;
  private lastCleanup?: Date;

  constructor(config: Partial<MediaBlobCacheConfig> = {}) {
    super();
    this.config = {
      dbName: "media_blob_cache",
      maxCacheSize: 500 * 1024 * 1024, // 500MB
      maxAge: 30, // 30 days
      batchSize: 10,
      autoCleanup: true,
      ...config,
    };
  }

  /**
   * Initialize the cache database
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, 1);

      request.onerror = () => {
        reject(new Error(`Failed to open cache database: ${request.error}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;

        // Setup error handling
        this.db.onerror = (event) => {
          console.error("Database error:", event);
          this.emit(CacheEventType.ERROR, { error: event });
        };

        // Start background cleanup if enabled
        if (this.config.autoCleanup) {
          this.scheduleCleanup();
        }

        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create binary data store
        if (!db.objectStoreNames.contains("binary_data")) {
          const store = db.createObjectStore("binary_data", { keyPath: "id" });
          store.createIndex("cached_at", "cached_at");
          store.createIndex("size", "size");
          store.createIndex("mime", "mime");
        }

        // Create metadata store for cache stats
        if (!db.objectStoreNames.contains("metadata")) {
          db.createObjectStore("metadata", { keyPath: "key" });
        }
      };
    });
  }

  /**
   * Get cached binary data for a media blob
   */
  async getCachedData(blobId: string): Promise<CachedBinaryData | null> {
    if (!this.isInitialized) {
      throw new Error("Cache not initialized");
    }

    this.cacheRequests++;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["binary_data"], "readonly");
      const store = transaction.objectStore("binary_data");
      const request = store.get(blobId);

      request.onsuccess = () => {
        const result = request.result as CachedBinaryData | undefined;
        if (result) {
          this.cacheHits++;
          this.emit(CacheEventType.CACHE_HIT, { blobId });
        } else {
          this.emit(CacheEventType.CACHE_MISS, { blobId });
        }
        resolve(result || null);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get cached data: ${request.error}`));
      };
    });
  }

  /**
   * Cache binary data for a media blob
   */
  async cacheData(
    blobId: string,
    data: Uint8Array,
    mime: string
  ): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Cache not initialized");
    }

    const cachedData: CachedBinaryData = {
      id: blobId,
      data,
      mime,
      size: data.length,
      cached_at: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["binary_data"], "readwrite");
      const store = transaction.objectStore("binary_data");
      const request = store.put(cachedData);

      request.onsuccess = () => {
        this.emit(CacheEventType.ITEM_CACHED, { blobId, size: data.length });
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to cache data: ${request.error}`));
      };
    });
  }

  /**
   * Get or create blob URL for cached data
   */
  async getBlobUrl(blobId: string): Promise<string | null> {
    // Check if we already have a blob URL
    if (this.blobUrls.has(blobId)) {
      return this.blobUrls.get(blobId)!;
    }

    // Get cached data
    const cachedData = await this.getCachedData(blobId);
    if (!cachedData) {
      return null;
    }

    // Create blob URL
    const blob = new Blob([cachedData.data], { type: cachedData.mime });
    const blobUrl = URL.createObjectURL(blob);

    // Store for reuse
    this.blobUrls.set(blobId, blobUrl);

    return blobUrl;
  }

  /**
   * Release blob URL and free memory
   */
  releaseBlobUrl(blobId: string): void {
    const blobUrl = this.blobUrls.get(blobId);
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      this.blobUrls.delete(blobId);
    }
  }

  /**
   * Check if binary data is cached
   */
  async isCached(blobId: string): Promise<boolean> {
    const cachedData = await this.getCachedData(blobId);
    return cachedData !== null;
  }

  /**
   * Request binary data via WebSocket and cache it
   */
  async requestAndCache(
    blobId: string,
    websocketClient?: WebSocketClient
  ): Promise<boolean> {
    // Avoid duplicate requests
    if (this.requestQueue.has(blobId)) {
      return false;
    }

    // Check if already cached
    if (await this.isCached(blobId)) {
      return true;
    }

    this.requestQueue.add(blobId);

    if (!websocketClient) {
      throw new Error(
        "WebSocket client is required for this cache implementation"
      );
    }

    try {
      // Request binary data via WebSocket and wait for response
      const response = await new Promise<{
        id: string;
        data: number[];
        mime?: string;
      } | null>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timeout waiting for binary data: ${blobId}`));
        }, 30000); // 30 second timeout

        // Set up one-time listener for this specific blob
        const handleBlobData = (data: {
          id: string;
          data: number[];
          mime?: string;
        }) => {
          if (data.id === blobId) {
            clearTimeout(timeout);
            websocketClient.off("mediaBlobData");
            resolve(data);
          }
        };

        // Add listener
        websocketClient.on("mediaBlobData", handleBlobData);

        // Request the data
        const success = websocketClient.getMediaBlobData(blobId);
        if (!success) {
          clearTimeout(timeout);
          websocketClient.off("mediaBlobData");
          resolve(null);
        }

        // Clean up listener after timeout
        setTimeout(() => {
          websocketClient.off("mediaBlobData");
        }, 31000);
      });

      if (response && response.data) {
        // Convert number array to Uint8Array
        const uint8Data = new Uint8Array(response.data);

        // Cache the data
        await this.cacheData(
          blobId,
          uint8Data,
          response.mime || "application/octet-stream"
        );

        return true;
      }

      return false;
    } catch (error) {
      console.error(`Failed to request binary data for ${blobId}:`, error);
      this.emit(CacheEventType.ERROR, { blobId, error });
      return false;
    } finally {
      this.requestQueue.delete(blobId);
    }
  }

  /**
   * Batch process media blobs from sync storage to cache their binary data
   */
  async syncFromMediaBlobs(
    mediaBlobs: MediaBlob[],
    websocketClient: WebSocketClient,
    progressCallback?: (processed: number, total: number) => void
  ): Promise<{ cached: number; failed: number; skipped: number }> {
    let cached = 0;
    let failed = 0;
    let skipped = 0;

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < mediaBlobs.length; i += this.config.batchSize) {
      const batch = mediaBlobs.slice(i, i + this.config.batchSize);

      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (blob) => {
          // Skip if already cached
          if (await this.isCached(blob.id)) {
            skipped++;
            return false;
          }

          // Request and cache
          return await this.requestAndCache(blob.id, websocketClient);
        })
      );

      // Count results
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          if (result.value) {
            cached++;
          }
        } else {
          failed++;
        }
      });

      // Report progress
      if (progressCallback) {
        progressCallback(i + batch.length, mediaBlobs.length);
      }

      // Small delay between batches to avoid overwhelming the server
      if (i + this.config.batchSize < mediaBlobs.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return { cached, failed, skipped };
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    if (!this.isInitialized) {
      throw new Error("Cache not initialized");
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["binary_data"], "readonly");
      const store = transaction.objectStore("binary_data");

      let totalItems = 0;
      let totalSize = 0;

      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          totalItems++;
          totalSize += cursor.value.size;
          cursor.continue();
        } else {
          // Calculate hit rate
          const hitRate =
            this.cacheRequests > 0 ? this.cacheHits / this.cacheRequests : 0;

          resolve({
            totalItems,
            totalSize,
            activeBlobUrls: this.blobUrls.size,
            hitRate,
            lastCleanup: this.lastCleanup?.toISOString(),
          });
        }
      };

      request.onerror = () => {
        reject(new Error(`Failed to get cache stats: ${request.error}`));
      };
    });
  }

  /**
   * Clean up old cached data
   */
  async cleanup(): Promise<{ removed: number; freedBytes: number }> {
    if (!this.isInitialized) {
      throw new Error("Cache not initialized");
    }

    this.emit(CacheEventType.CLEANUP_STARTED, {});

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.maxAge);
    const cutoffIso = cutoffDate.toISOString();

    let removed = 0;
    let freedBytes = 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["binary_data"], "readwrite");
      const store = transaction.objectStore("binary_data");
      const index = store.index("cached_at");

      const request = index.openCursor(IDBKeyRange.upperBound(cutoffIso));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const data = cursor.value as CachedBinaryData;

          // Remove old entry
          cursor.delete();

          // Release blob URL if exists
          this.releaseBlobUrl(data.id);

          removed++;
          freedBytes += data.size;

          this.emit(CacheEventType.ITEM_REMOVED, {
            blobId: data.id,
            reason: "expired",
          });

          cursor.continue();
        } else {
          this.lastCleanup = new Date();

          this.emit(CacheEventType.CLEANUP_COMPLETED, {
            removed,
            freedBytes,
          });

          resolve({ removed, freedBytes });
        }
      };

      request.onerror = () => {
        reject(new Error(`Failed to cleanup cache: ${request.error}`));
      };
    });
  }

  /**
   * Clear all cached data
   */
  async clear(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Cache not initialized");
    }

    // Release all blob URLs
    for (const blobUrl of this.blobUrls.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    this.blobUrls.clear();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["binary_data"], "readwrite");
      const store = transaction.objectStore("binary_data");
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to clear cache: ${request.error}`));
      };
    });
  }

  /**
   * Close the cache and clean up resources
   */
  async close(): Promise<void> {
    if (this.db) {
      // Release all blob URLs
      for (const blobUrl of this.blobUrls.values()) {
        URL.revokeObjectURL(blobUrl);
      }
      this.blobUrls.clear();

      this.db.close();
      this.db = undefined;
      this.isInitialized = false;
    }
  }

  /**
   * Schedule background cleanup
   */
  private scheduleCleanup(): void {
    // Run cleanup every 24 hours
    setInterval(
      () => {
        this.cleanup().catch((error) => {
          console.error("Background cleanup failed:", error);
        });
      },
      24 * 60 * 60 * 1000
    );
  }

  /**
   * Emit cache event
   */
  private emit(type: CacheEventType, data: any): void {
    this.dispatchEvent(new CustomEvent(type, { detail: data }));
  }
}

/**
 * Create a new media blob cache instance
 */
export function createMediaBlobCache(
  config?: Partial<MediaBlobCacheConfig>
): MediaBlobCache {
  return new MediaBlobCache(config);
}

/**
 * Helper function to create data URL from cached binary data
 */
export function createDataUrlFromCache(cachedData: CachedBinaryData): string {
  const blob = new Blob([cachedData.data], { type: cachedData.mime });
  return URL.createObjectURL(blob);
}

export default MediaBlobCache;
