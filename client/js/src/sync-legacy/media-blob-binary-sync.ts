//! Media Blob Binary Data Synchronization
//!
//! This module provides integration between the sync system and binary data cache,
//! allowing for offline caching of media blob binary data while keeping it separate
//! from the structured sync data to avoid JSON serialization issues.

import { SyncStorageManager } from "./sync-storage.js";
import type { WebSocketClient } from "../lib/websocket-client.js";
import type { MediaBlob } from "../lib/websocket-types.js";
import type { IBlobCache } from "./blob-cache-interface.js";

/**
 * Binary sync configuration
 */
export interface BinarySyncConfig {
  /** Enable automatic binary sync after media blob sync */
  autoSync: boolean;
  /** Maximum concurrent requests */
  maxConcurrent: number;
  /** Priority filter - only sync these MIME types */
  priorityMimeTypes?: string[];
  /** Skip files larger than this size (in bytes) */
  maxFileSize?: number;
  /** Batch size for processing */
  batchSize: number;
}

/**
 * Binary sync progress information
 */
export interface BinarySyncProgress {
  /** Current phase */
  phase: "scanning" | "filtering" | "downloading" | "complete";
  /** Items processed */
  processed: number;
  /** Total items to process */
  total: number;
  /** Items successfully cached */
  cached: number;
  /** Items skipped */
  skipped: number;
  /** Items failed */
  failed: number;
  /** Bytes downloaded */
  bytesDownloaded: number;
  /** Estimated time remaining (ms) */
  estimatedTimeRemaining?: number;
  /** Current item being processed */
  currentItem?: string;
}

/**
 * Binary sync result
 */
export interface BinarySyncResult {
  /** Items successfully cached */
  cached: number;
  /** Items skipped (already cached) */
  skipped: number;
  /** Items failed to cache */
  failed: number;
  /** Total bytes downloaded */
  bytesDownloaded: number;
  /** Duration in milliseconds */
  duration: number;
  /** Error details for failed items */
  errors: Array<{ blobId: string; error: string }>;
}

/**
 * Media Blob Binary Synchronization Manager
 */
export class MediaBlobBinarySync extends EventTarget {
  private cache: IBlobCache;
  private storage: SyncStorageManager;
  private config: BinarySyncConfig;
  private isRunning: boolean = false;
  private abortController?: AbortController;

  constructor(
    cache: IBlobCache,
    storage: SyncStorageManager,
    config: Partial<BinarySyncConfig> = {}
  ) {
    super();
    this.cache = cache;
    this.storage = storage;
    this.config = {
      autoSync: true,
      maxConcurrent: 3,
      batchSize: 10,
      ...config,
    };
  }

  /**
   * Sync binary data for all media blobs in storage
   */
  async syncAllBinaryData(
    websocketClient?: WebSocketClient,
    signal?: AbortSignal
  ): Promise<BinarySyncResult> {
    if (this.isRunning) {
      throw new Error("Binary sync already running");
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    // Link external abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        this.abortController?.abort();
      });
    }

    const startTime = Date.now();
    let progress: BinarySyncProgress = {
      phase: "scanning",
      processed: 0,
      total: 0,
      cached: 0,
      skipped: 0,
      failed: 0,
      bytesDownloaded: 0,
    };

    const errors: Array<{ blobId: string; error: string }> = [];

    try {
      // Emit initial progress
      this.emitProgress(progress);

      // Phase 1: Get all media blobs from storage
      progress.phase = "scanning";
      this.emitProgress(progress);

      const allBlobs = await this.storage.queryMediaBlobs();
      progress.total = allBlobs.length;

      if (progress.total === 0) {
        this.emitProgress({ ...progress, phase: "complete" });
        return {
          cached: 0,
          skipped: 0,
          failed: 0,
          bytesDownloaded: 0,
          duration: Date.now() - startTime,
          errors: [],
        };
      }

      // Phase 2: Filter blobs that need binary data
      progress.phase = "filtering";
      this.emitProgress(progress);

      const blobsToSync = await this.filterBlobsForSync(allBlobs);
      progress.total = blobsToSync.length;

      // Phase 3: Download binary data
      progress.phase = "downloading";
      this.emitProgress(progress);

      // Process in batches to manage memory and network load
      for (let i = 0; i < blobsToSync.length; i += this.config.batchSize) {
        if (this.abortController.signal.aborted) {
          throw new Error("Sync aborted");
        }

        const batch = blobsToSync.slice(i, i + this.config.batchSize);

        // Process batch with limited concurrency
        const semaphore = new Semaphore(this.config.maxConcurrent);

        const batchPromises = batch.map(async (blob) => {
          return semaphore.acquire(async () => {
            if (this.abortController?.signal.aborted) {
              return { success: false, bytes: 0, skipped: false };
            }

            progress.currentItem = blob.id;
            this.emitProgress(progress);

            try {
              // Check if already cached
              if (await this.cache.isCached(blob.id)) {
                progress.skipped++;
                return { success: true, bytes: 0, skipped: true };
              }

              // Request and cache binary data
              const success = await this.cache.requestAndCache(
                blob.id,
                websocketClient
              );

              if (success) {
                // Get cached data to track bytes
                const cachedData = await this.cache.getCachedData(blob.id);
                const bytes = cachedData?.size || 0;

                progress.cached++;
                progress.bytesDownloaded += bytes;

                return { success: true, bytes, skipped: false };
              } else {
                progress.failed++;
                errors.push({ blobId: blob.id, error: "Failed to download" });
                return { success: false, bytes: 0, skipped: false };
              }
            } catch (error) {
              progress.failed++;
              const errorMsg =
                error instanceof Error ? error.message : "Unknown error";
              errors.push({ blobId: blob.id, error: errorMsg });
              return { success: false, bytes: 0, skipped: false };
            } finally {
              progress.processed++;

              // Update estimated time remaining
              if (progress.processed > 0) {
                const elapsed = Date.now() - startTime;
                const avgTimePerItem = elapsed / progress.processed;
                const remaining = progress.total - progress.processed;
                progress.estimatedTimeRemaining = remaining * avgTimePerItem;
              }

              this.emitProgress(progress);
            }
          });
        });

        await Promise.all(batchPromises);

        // Small delay between batches to avoid overwhelming the server
        if (i + this.config.batchSize < blobsToSync.length) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      // Phase 4: Complete
      progress.phase = "complete";
      progress.currentItem = undefined;
      progress.estimatedTimeRemaining = 0;
      this.emitProgress(progress);

      return {
        cached: progress.cached,
        skipped: progress.skipped,
        failed: progress.failed,
        bytesDownloaded: progress.bytesDownloaded,
        duration: Date.now() - startTime,
        errors,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.dispatchEvent(
        new CustomEvent("error", { detail: { error: errorMsg } })
      );
      throw error;
    } finally {
      this.isRunning = false;
      this.abortController = undefined;
    }
  }

  /**
   * Filter media blobs that need binary data sync
   */
  private async filterBlobsForSync(blobs: MediaBlob[]): Promise<MediaBlob[]> {
    const filtered: MediaBlob[] = [];

    for (const blob of blobs) {
      // Skip if size limit exceeded
      if (
        this.config.maxFileSize &&
        blob.size &&
        blob.size > this.config.maxFileSize
      ) {
        continue;
      }

      // Filter by priority MIME types if specified
      if (
        this.config.priorityMimeTypes &&
        this.config.priorityMimeTypes.length > 0
      ) {
        if (
          !blob.mime ||
          !this.config.priorityMimeTypes.some((mime) =>
            blob.mime!.startsWith(mime)
          )
        ) {
          continue;
        }
      }

      // Skip if already cached
      if (await this.cache.isCached(blob.id)) {
        continue;
      }

      filtered.push(blob);
    }

    return filtered;
  }

  /**
   * Sync binary data for specific media blobs
   */
  async syncSpecificBlobs(
    blobIds: string[],
    websocketClient: WebSocketClient
  ): Promise<BinarySyncResult> {
    const startTime = Date.now();
    let cached = 0;
    let skipped = 0;
    let failed = 0;
    let bytesDownloaded = 0;
    const errors: Array<{ blobId: string; error: string }> = [];

    for (const blobId of blobIds) {
      try {
        // Check if already cached
        if (await this.cache.isCached(blobId)) {
          skipped++;
          continue;
        }

        // Request and cache
        const success = await this.cache.requestAndCache(
          blobId,
          websocketClient
        );

        if (success) {
          const cachedData = await this.cache.getCachedData(blobId);
          bytesDownloaded += cachedData?.size || 0;
          cached++;
        } else {
          failed++;
          errors.push({ blobId, error: "Failed to download" });
        }
      } catch (error) {
        failed++;
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        errors.push({ blobId, error: errorMsg });
      }
    }

    return {
      cached,
      skipped,
      failed,
      bytesDownloaded,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Abort current sync operation
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Check if sync is currently running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get binary data URL for a media blob
   */
  async getBlobUrl(blobId: string): Promise<string | null> {
    return this.cache.getBlobUrl(blobId);
  }

  /**
   * Release blob URL to free memory
   */
  releaseBlobUrl(blobId: string): void {
    this.cache.releaseBlobUrl(blobId);
  }

  /**
   * Emit progress event
   */
  private emitProgress(progress: BinarySyncProgress): void {
    this.dispatchEvent(new CustomEvent("progress", { detail: progress }));
  }
}

/**
 * Simple semaphore for controlling concurrency
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tryAcquire = () => {
        if (this.permits > 0) {
          this.permits--;
          fn()
            .then(resolve)
            .catch(reject)
            .finally(() => {
              this.permits++;
              if (this.queue.length > 0) {
                const next = this.queue.shift()!;
                next();
              }
            });
        } else {
          this.queue.push(tryAcquire);
        }
      };

      tryAcquire();
    });
  }
}

/**
 * Create a new binary sync instance
 */
export function createMediaBlobBinarySync(
  cache: IBlobCache,
  storage: SyncStorageManager,
  config?: Partial<BinarySyncConfig>
): MediaBlobBinarySync {
  return new MediaBlobBinarySync(cache, storage, config);
}

/**
 * Utility function to sync binary data for priority media types
 */
export async function syncPriorityMediaBlobs(
  cache: IBlobCache,
  storage: SyncStorageManager,
  websocketClient?: WebSocketClient,
  priorityTypes: string[] = ["image/", "audio/"]
): Promise<BinarySyncResult> {
  const binarySync = createMediaBlobBinarySync(cache, storage, {
    priorityMimeTypes: priorityTypes,
    maxConcurrent: 2,
    batchSize: 5,
  });

  return binarySync.syncAllBinaryData(websocketClient);
}

export default MediaBlobBinarySync;
