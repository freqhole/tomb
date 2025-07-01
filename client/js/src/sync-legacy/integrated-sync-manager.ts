//! Integrated Sync Manager
//!
//! This module provides a unified sync manager that combines the existing music sync
//! capabilities with WebSocket-based binary data synchronization for media blobs.

import {
  MusicSyncManager,
  type MusicSyncManagerConfig,
} from "./music-sync-manager.js";
import {
  WebSocketBinaryConnector,
  createWebSocketBinaryConnector,
} from "./websocket-binary-connector.js";
import {
  IntegratedMediaBlobCache,
  createIntegratedMediaBlobCache,
} from "./integrated-media-blob-cache.js";
import { SyncStorageManager } from "./sync-storage.js";
import type { WebSocketClient } from "../lib/websocket-client.js";
import type { SyncStatus } from "./sync-constants.js";

/**
 * Configuration for the integrated sync manager
 */
export interface IntegratedSyncManagerConfig
  extends Omit<MusicSyncManagerConfig, "syncBinaryData"> {
  /** Enable WebSocket-based binary data sync */
  enableWebSocketBinarySync: boolean;
  /** Enable automatic binary sync when new media blobs are detected */
  autoSyncOnNewBlobs: boolean;
  /** WebSocket binary sync configuration */
  binarySync?: {
    /** Maximum file size to cache via WebSocket */
    maxFileSize?: number;
    /** Priority MIME types for WebSocket sync */
    priorityMimeTypes?: string[];
    /** Batch size for WebSocket processing */
    batchSize?: number;
    /** Enable debug logging for binary sync */
    debug?: boolean;
  };
  /** Binary cache configuration */
  binaryCache?: {
    /** Maximum cache size in bytes */
    maxCacheSize?: number;
    /** Maximum cache age in days */
    maxAge?: number;
    /** Enable automatic cleanup */
    autoCleanup?: boolean;
  };
}

/**
 * Extended sync progress including binary data
 */
export interface IntegratedSyncProgress {
  /** Music sync progress */
  musicSync: {
    status: SyncStatus;
    totalItemsSynced: number;
    estimatedTotalItems?: number;
    overallProgress?: number;
  };
  /** Binary sync progress */
  binarySync: {
    status: "idle" | "scanning" | "downloading" | "complete" | "error";
    thumbnailsProcessed: number;
    thumbnailsCached: number;
    thumbnailsSkipped: number;
    bytesCached: number;
    currentItem?: string;
  };
  /** Overall status */
  overallStatus: SyncStatus;
  /** Combined progress percentage */
  combinedProgress?: number;
}

/**
 * Sync result summary
 */
export interface IntegratedSyncResult {
  /** Music sync results */
  musicSync: {
    success: boolean;
    itemsSynced: number;
    duration: number;
    errors: string[];
  };
  /** Binary sync results */
  binarySync: {
    success: boolean;
    thumbnailsCached: number;
    thumbnailsSkipped: number;
    bytesCached: number;
    duration: number;
    errors: string[];
  };
  /** Overall result */
  success: boolean;
  totalDuration: number;
}

/**
 * Integrated Sync Manager
 *
 * Combines music sync with WebSocket-based binary data synchronization
 */
export class IntegratedSyncManager extends EventTarget {
  private musicSyncManager: MusicSyncManager;
  private binaryConnector?: WebSocketBinaryConnector;
  private binaryCache?: IntegratedMediaBlobCache;
  private storage: SyncStorageManager;
  private websocketClient: WebSocketClient;
  private config: IntegratedSyncManagerConfig;
  private isInitialized: boolean = false;
  private currentProgress: IntegratedSyncProgress;

  constructor(
    websocketClient: WebSocketClient,
    storage: SyncStorageManager,
    config: IntegratedSyncManagerConfig
  ) {
    super();
    this.websocketClient = websocketClient;
    this.storage = storage;
    this.config = config;

    // Initialize progress state
    this.currentProgress = {
      musicSync: {
        status: "idle" as SyncStatus,
        totalItemsSynced: 0,
      },
      binarySync: {
        status: "idle",
        thumbnailsProcessed: 0,
        thumbnailsCached: 0,
        thumbnailsSkipped: 0,
        bytesCached: 0,
      },
      overallStatus: "idle" as SyncStatus,
    };

    // Create music sync manager with metadata sync enabled
    const musicConfig: MusicSyncManagerConfig = {
      ...config,
      syncBinaryData: true, // Enable metadata sync but we override binary handling
    };
    this.musicSyncManager = new MusicSyncManager(musicConfig);
  }

  /**
   * Initialize the integrated sync manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Initialize storage and music sync
    await this.storage.initialize();
    await this.musicSyncManager.initialize();

    // Set up binary cache and connector if enabled
    if (this.config.enableWebSocketBinarySync) {
      await this.initializeBinarySync();
    }

    // Set up event forwarding from music sync
    this.musicSyncManager.on("progress", (event: any) => {
      this.updateMusicSyncProgress(event);
    });

    this.musicSyncManager.on("complete", (event: any) => {
      this.handleMusicSyncComplete(event);
    });

    this.musicSyncManager.on("error", (event: any) => {
      this.handleMusicSyncError(event);
    });

    this.isInitialized = true;
    this.log("Integrated sync manager initialized");
  }

  /**
   * Initialize binary sync components
   */
  private async initializeBinarySync(): Promise<void> {
    // Create binary cache
    this.binaryCache = createIntegratedMediaBlobCache(
      this.storage,
      this.config.binaryCache,
      this.config.apiBaseUrl
    );
    await this.binaryCache.initialize();

    // Create binary connector
    this.binaryConnector = createWebSocketBinaryConnector(
      this.websocketClient,
      this.binaryCache,
      this.storage,
      {
        autoCache: true,
        autoSync: this.config.autoSyncOnNewBlobs,
        ...this.config.binarySync,
      }
    );

    // Set up binary sync event listeners
    this.binaryConnector.addEventListener(
      "thumbnails_processed",
      (event: any) => {
        this.updateBinarySyncProgress(event.detail);
      }
    );

    this.binaryConnector.addEventListener("thumbnail_cached", (event: any) => {
      this.handleThumbnailCached(event.detail);
    });

    this.binaryConnector.addEventListener("media_blob_added", (event: any) => {
      this.handleNewMediaBlob(event.detail);
    });

    this.binaryConnector.addEventListener("error", (event: any) => {
      this.handleBinarySyncError(event.detail);
    });

    // Start the binary connector
    await this.binaryConnector.start();
  }

  /**
   * Perform a complete synchronization
   */
  async sync(options?: {
    force?: boolean;
    syncBinaryData?: boolean;
    pageSize?: number;
  }): Promise<IntegratedSyncResult> {
    if (!this.isInitialized) {
      throw new Error("Sync manager not initialized");
    }

    const syncBinaryData =
      options?.syncBinaryData ?? this.config.enableWebSocketBinarySync;
    const startTime = Date.now();

    this.log("Starting integrated sync...", { syncBinaryData, options });

    // Reset progress
    this.resetProgress();
    this.emitProgress();

    const result: IntegratedSyncResult = {
      musicSync: {
        success: false,
        itemsSynced: 0,
        duration: 0,
        errors: [],
      },
      binarySync: {
        success: false,
        thumbnailsCached: 0,
        thumbnailsSkipped: 0,
        bytesCached: 0,
        duration: 0,
        errors: [],
      },
      success: false,
      totalDuration: 0,
    };

    try {
      // Phase 1: Music sync
      this.currentProgress.overallStatus = "syncing" as SyncStatus;
      this.currentProgress.musicSync.status = "syncing" as SyncStatus;
      this.emitProgress();

      const musicSyncStart = Date.now();

      try {
        this.log("Starting music sync (songs, playlists, playlist_songs)...");
        await this.musicSyncManager.syncAll();
        this.log("Music sync completed, checking media blobs...");

        // Manually sync media blob metadata to ensure we have blob records
        try {
          this.log("Starting manual media blob metadata sync...");
          await this.musicSyncManager.syncMediaBlobs();

          // Check how many media blobs we now have
          const mediaBlobCount = await this.storage.queryMediaBlobs();
          this.log(`Found ${mediaBlobCount.length} media blobs after sync`);
        } catch (error) {
          this.log("Media blob metadata sync failed:", error);
        }

        result.musicSync = {
          success: true,
          itemsSynced: this.currentProgress.musicSync.totalItemsSynced,
          duration: Date.now() - musicSyncStart,
          errors: [],
        };

        this.currentProgress.musicSync.status = "complete" as SyncStatus;
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Music sync failed";
        result.musicSync = {
          success: false,
          itemsSynced: this.currentProgress.musicSync.totalItemsSynced,
          duration: Date.now() - musicSyncStart,
          errors: [errorMsg],
        };

        this.currentProgress.musicSync.status = "error" as SyncStatus;
      }

      this.emitProgress();

      // Phase 2: Binary sync (if enabled)
      if (syncBinaryData && this.binaryConnector) {
        this.currentProgress.binarySync.status = "scanning";
        this.emitProgress();

        const binarySyncStart = Date.now();

        try {
          await this.binaryConnector.syncAllMediaBlobs((processed) => {
            // Update progress during binary sync
            this.currentProgress.binarySync.thumbnailsProcessed = processed;
            this.emitProgress();
          });

          const binaryStats = this.binaryConnector.getStats();

          result.binarySync = {
            success: true,
            thumbnailsCached: binaryStats.thumbnailsCached,
            thumbnailsSkipped: binaryStats.thumbnailsSkipped,
            bytesCached: binaryStats.bytesCached,
            duration: Date.now() - binarySyncStart,
            errors: [],
          };

          this.currentProgress.binarySync.status = "complete";
        } catch (error) {
          result.binarySync = {
            success: false,
            thumbnailsCached: 0,
            thumbnailsSkipped: 0,
            bytesCached: 0,
            duration: Date.now() - binarySyncStart,
            errors: [
              error instanceof Error
                ? error.message
                : "Unknown binary sync error",
            ],
          };

          this.currentProgress.binarySync.status = "error";
        }

        this.emitProgress();
      } else {
        // Mark binary sync as skipped
        result.binarySync.success = true;
      }

      // Overall result
      result.success = result.musicSync.success && result.binarySync.success;
      result.totalDuration = Date.now() - startTime;

      this.currentProgress.overallStatus = result.success
        ? ("complete" as SyncStatus)
        : ("error" as SyncStatus);
      this.calculateCombinedProgress();
      this.emitProgress();

      this.log("Integrated sync complete", result);

      // Emit completion event
      this.dispatchEvent(new CustomEvent("complete", { detail: result }));

      return result;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Unknown sync error";

      result.musicSync.errors.push(errorMsg);
      result.totalDuration = Date.now() - startTime;

      this.currentProgress.overallStatus = "error" as SyncStatus;
      this.emitProgress();

      this.log("Integrated sync failed:", error);

      // Emit error event
      this.dispatchEvent(
        new CustomEvent("error", { detail: { error, result } })
      );

      throw error;
    }
  }

  /**
   * Request thumbnails for a specific media blob
   */
  async requestThumbnails(mediaBlobId: string): Promise<boolean> {
    if (!this.binaryConnector) {
      throw new Error("Binary sync not enabled");
    }

    return this.binaryConnector.requestThumbnails(mediaBlobId);
  }

  /**
   * Get cached thumbnail URL for a media blob
   */
  async getThumbnailUrl(mediaBlobId: string): Promise<string | null> {
    if (!this.binaryCache) {
      return null;
    }

    return this.binaryCache.getBlobUrl(mediaBlobId);
  }

  /**
   * Release thumbnail URL to free memory
   */
  releaseThumbnailUrl(mediaBlobId: string): void {
    if (this.binaryCache) {
      this.binaryCache.releaseBlobUrl(mediaBlobId);
    }
  }

  /**
   * Get current sync progress
   */
  getProgress(): IntegratedSyncProgress {
    return { ...this.currentProgress };
  }

  /**
   * Get sync statistics
   */
  async getStats(): Promise<{
    music: any;
    binary?: any;
    storage: any;
  }> {
    const stats: any = {
      music: await this.musicSyncManager.getStats(),
      storage: await this.storage.getStorageStats(),
    };

    if (this.binaryCache) {
      stats.binary = await this.binaryCache.getStats();
    }

    return stats;
  }

  /**
   * Close the sync manager and clean up resources
   */
  async close(): Promise<void> {
    if (this.binaryConnector) {
      await this.binaryConnector.stop();
    }

    if (this.binaryCache) {
      await this.binaryCache.close();
    }

    // Note: MusicSyncManager doesn't have a close method, cleanup is automatic

    this.isInitialized = false;
    this.log("Integrated sync manager closed");
  }

  /**
   * Update music sync progress
   */
  private updateMusicSyncProgress(progress: any): void {
    this.currentProgress.musicSync = {
      status: progress.status,
      totalItemsSynced: progress.totalItemsSynced,
      estimatedTotalItems: progress.estimatedTotalItems,
      overallProgress: progress.overallProgress,
    };

    this.calculateCombinedProgress();
    this.emitProgress();
  }

  /**
   * Update binary sync progress
   */
  private updateBinarySyncProgress(progress: any): void {
    this.currentProgress.binarySync = {
      ...this.currentProgress.binarySync,
      thumbnailsProcessed: progress.stats?.thumbnailsProcessed || 0,
      thumbnailsCached: progress.stats?.thumbnailsCached || 0,
      thumbnailsSkipped: progress.stats?.thumbnailsSkipped || 0,
      bytesCached: progress.stats?.bytesCached || 0,
    };

    this.calculateCombinedProgress();
    this.emitProgress();
  }

  /**
   * Handle music sync completion
   */
  private handleMusicSyncComplete(result: any): void {
    this.log("Music sync completed", result);
  }

  /**
   * Handle music sync error
   */
  private handleMusicSyncError(error: any): void {
    this.log("Music sync error:", error);
  }

  /**
   * Handle thumbnail cached event
   */
  private handleThumbnailCached(detail: any): void {
    this.log(`Thumbnail cached: ${detail.thumbnailId} (${detail.size} bytes)`);
  }

  /**
   * Handle new media blob detected
   */
  private handleNewMediaBlob(detail: any): void {
    this.log(`New media blob detected: ${detail.mediaBlob.id}`);

    // Emit event for UI
    this.dispatchEvent(new CustomEvent("media_blob_added", { detail }));
  }

  /**
   * Handle binary sync error
   */
  private handleBinarySyncError(error: any): void {
    this.log("Binary sync error:", error);
  }

  /**
   * Reset progress state
   */
  private resetProgress(): void {
    this.currentProgress = {
      musicSync: {
        status: "idle" as SyncStatus,
        totalItemsSynced: 0,
      },
      binarySync: {
        status: "idle",
        thumbnailsProcessed: 0,
        thumbnailsCached: 0,
        thumbnailsSkipped: 0,
        bytesCached: 0,
      },
      overallStatus: "idle" as SyncStatus,
    };
  }

  /**
   * Calculate combined progress percentage
   */
  private calculateCombinedProgress(): void {
    const musicProgress = this.currentProgress.musicSync.overallProgress || 0;
    const binaryEnabled = this.config.enableWebSocketBinarySync;

    if (!binaryEnabled) {
      this.currentProgress.combinedProgress = musicProgress;
      return;
    }

    // Binary progress is harder to calculate without knowing total items
    // For now, just weight music sync as 70% and binary as 30%
    const musicWeight = 0.7;
    const binaryWeight = 0.3;

    let binaryProgress = 0;
    if (this.currentProgress.binarySync.status === "complete") {
      binaryProgress = 100;
    } else if (this.currentProgress.binarySync.status === "downloading") {
      // Rough estimation based on processed items
      binaryProgress = Math.min(
        50,
        this.currentProgress.binarySync.thumbnailsProcessed * 2
      );
    }

    this.currentProgress.combinedProgress =
      musicProgress * musicWeight + binaryProgress * binaryWeight;
  }

  /**
   * Emit progress event
   */
  private emitProgress(): void {
    this.dispatchEvent(
      new CustomEvent("progress", {
        detail: { ...this.currentProgress },
      })
    );
  }

  /**
   * Debug logging
   */
  private log(...args: any[]): void {
    if (this.config.musicOptions?.enableBackgroundSync) {
      console.log("[IntegratedSyncManager]", ...args);
    }
  }
}

/**
 * Create a new integrated sync manager
 */
export function createIntegratedSyncManager(
  websocketClient: WebSocketClient,
  storage: SyncStorageManager,
  config: IntegratedSyncManagerConfig
): IntegratedSyncManager {
  return new IntegratedSyncManager(websocketClient, storage, config);
}

/**
 * Default configuration for integrated sync
 */
export const defaultIntegratedSyncConfig: Partial<IntegratedSyncManagerConfig> =
  {
    enableWebSocketBinarySync: true,
    autoSyncOnNewBlobs: true,
    binarySync: {
      priorityMimeTypes: ["image/", "audio/"],
      batchSize: 5,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      debug: false,
    },
    binaryCache: {
      maxCacheSize: 500 * 1024 * 1024, // 500MB
      maxAge: 30, // 30 days
      autoCleanup: true,
    },
    musicOptions: {
      enableBinaryCache: true,
      enableBackgroundSync: true,
      autoSyncInterval: 5 * 60 * 1000, // 5 minutes
    },
  };

export default IntegratedSyncManager;
