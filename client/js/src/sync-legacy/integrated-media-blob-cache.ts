//! Integrated Media Blob Binary Data Cache Manager
//!
//! This module provides offline caching of media blob binary data using the
//! existing sync storage instead of a separate IndexedDB database.

import type { MediaBlob } from "../lib/websocket-types.js";
import type { WebSocketClient } from "../lib/websocket-client.js";
import type { SyncStorageManager } from "./sync-storage.js";
import type { IBlobCache } from "./blob-cache-interface.js";
import { BlobClient } from "../lib/blob-client.js";

/**
 * Binary data cache entry (matches sync storage structure)
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
export interface IntegratedMediaBlobCacheConfig {
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
 * Integrated Media Blob Binary Data Cache Manager
 * Uses the existing sync storage for binary data storage
 */
export class IntegratedMediaBlobCache
  extends EventTarget
  implements IBlobCache
{
  private config: IntegratedMediaBlobCacheConfig;
  private storage: SyncStorageManager;
  private blobClient: BlobClient;
  private isInitialized: boolean = false;
  private blobUrls: Map<string, string> = new Map();
  private requestQueue: Set<string> = new Set();
  private cacheHits: number = 0;
  private cacheRequests: number = 0;
  private lastCleanup?: Date;

  constructor(
    storage: SyncStorageManager,
    config: Partial<IntegratedMediaBlobCacheConfig> = {},
    apiBaseUrl: string = "http://localhost:8080"
  ) {
    super();
    this.storage = storage;
    this.blobClient = new BlobClient({
      baseUrl: apiBaseUrl,
      credentials: true,
      timeoutMs: 30_000,
    });
    this.config = {
      maxCacheSize: 500 * 1024 * 1024, // 500MB
      maxAge: 30, // 30 days
      batchSize: 10,
      autoCleanup: true,
      ...config,
    };
  }

  /**
   * Initialize the cache (uses existing storage)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Ensure storage is initialized
    await this.storage.initialize();

    this.isInitialized = true;

    // Start background cleanup if enabled
    if (this.config.autoCleanup) {
      this.scheduleCleanup();
    }
  }

  /**
   * Get cached binary data for a media blob
   */
  async getCachedData(blobId: string): Promise<CachedBinaryData | null> {
    if (!this.isInitialized) {
      throw new Error("Cache not initialized");
    }

    this.cacheRequests++;

    try {
      const result = await this.storage.getBinaryData(blobId);
      if (result) {
        this.cacheHits++;
        this.emit(CacheEventType.CACHE_HIT, { blobId });
        return result;
      } else {
        this.emit(CacheEventType.CACHE_MISS, { blobId });
        return null;
      }
    } catch (error) {
      this.emit(CacheEventType.ERROR, { blobId, error });
      throw error;
    }
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

    try {
      await this.storage.storeBinaryData(blobId, data, mime);
      this.emit(CacheEventType.ITEM_CACHED, { blobId, size: data.length });
    } catch (error) {
      this.emit(CacheEventType.ERROR, { blobId, error });
      throw error;
    }
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
    if (!this.isInitialized) {
      throw new Error("Cache not initialized");
    }

    try {
      return await this.storage.hasBinaryData(blobId);
    } catch (error) {
      this.emit(CacheEventType.ERROR, { blobId, error });
      return false;
    }
  }

  /**
   * Request binary data via HTTP and cache it
   */
  async requestAndCache(
    blobId: string,
    _websocketClient?: WebSocketClient
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

    try {
      // Download binary data via HTTP (much more efficient than WebSocket)
      const uint8Data = await this.blobClient.getBlobBytes(blobId);

      // Get metadata to determine MIME type
      const metadata = await this.blobClient.getBlobMetadata(blobId);
      const mimeType = metadata.mime_type || "application/octet-stream";

      // Cache the data
      await this.cacheData(blobId, uint8Data, mimeType);

      return true;
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

    try {
      const stats = await this.storage.getBinaryDataStats();

      // Calculate hit rate
      const hitRate =
        this.cacheRequests > 0 ? this.cacheHits / this.cacheRequests : 0;

      return {
        totalItems: stats.totalItems,
        totalSize: stats.totalSize,
        activeBlobUrls: this.blobUrls.size,
        hitRate,
        lastCleanup: this.lastCleanup?.toISOString(),
      };
    } catch (error) {
      this.emit(CacheEventType.ERROR, { error });
      throw error;
    }
  }

  /**
   * Clean up old cached data
   */
  async cleanup(): Promise<{ removed: number; freedBytes: number }> {
    if (!this.isInitialized) {
      throw new Error("Cache not initialized");
    }

    this.emit(CacheEventType.CLEANUP_STARTED, {});

    try {
      const maxAgeMs = this.config.maxAge * 24 * 60 * 60 * 1000;
      const result = await this.storage.cleanupBinaryData(maxAgeMs);

      // Release any blob URLs for removed items
      this.blobUrls.clear();

      this.lastCleanup = new Date();

      this.emit(CacheEventType.CLEANUP_COMPLETED, {
        removed: result.removed,
        freedBytes: result.freedBytes,
      });

      return result;
    } catch (error) {
      this.emit(CacheEventType.ERROR, { error });
      throw error;
    }
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

    try {
      // Get all binary data IDs and delete them
      const allData = await this.storage.getAllBinaryData();
      for (const data of allData) {
        await this.storage.deleteBinaryData(data.id);
      }
    } catch (error) {
      this.emit(CacheEventType.ERROR, { error });
      throw error;
    }
  }

  /**
   * Close the cache and clean up resources
   */
  async close(): Promise<void> {
    // Release all blob URLs
    for (const blobUrl of this.blobUrls.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    this.blobUrls.clear();

    this.isInitialized = false;
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
 * Create a new integrated media blob cache instance
 */
export function createIntegratedMediaBlobCache(
  storage: SyncStorageManager,
  config?: Partial<IntegratedMediaBlobCacheConfig>,
  apiBaseUrl?: string
): IntegratedMediaBlobCache {
  return new IntegratedMediaBlobCache(storage, config, apiBaseUrl);
}

/**
 * Helper function to create data URL from cached binary data
 */
export function createDataUrlFromCache(cachedData: CachedBinaryData): string {
  const blob = new Blob([cachedData.data], { type: cachedData.mime });
  return URL.createObjectURL(blob);
}

export default IntegratedMediaBlobCache;
