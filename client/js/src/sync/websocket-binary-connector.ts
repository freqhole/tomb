//! WebSocket Binary Data Connector
//!
//! This module connects WebSocket thumbnail responses to the binary cache system,
//! enabling automatic caching of binary data received via WebSocket messages.

import type { WebSocketClient } from "../lib/websocket-client.js";
import type { SyncStorageManager } from "./sync-storage.js";
import type { IBlobCache } from "./blob-cache-interface.js";
import type { MediaBlob } from "../lib/websocket-types.js";
import type { StoredMediaBlob } from "./sync-storage.js";

/**
 * Configuration for WebSocket binary connector
 */
export interface WebSocketBinaryConnectorConfig {
  /** Enable automatic caching of thumbnail responses */
  autoCache: boolean;
  /** Enable listening for new media blob notifications */
  autoSync: boolean;
  /** Maximum file size to cache (in bytes) */
  maxFileSize?: number;
  /** Priority MIME types to cache first */
  priorityMimeTypes?: string[];
  /** Batch size for processing multiple thumbnails */
  batchSize: number;
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Binary sync statistics
 */
export interface BinarySyncStats {
  /** Total thumbnails processed */
  thumbnailsProcessed: number;
  /** Total thumbnails cached */
  thumbnailsCached: number;
  /** Total thumbnails skipped */
  thumbnailsSkipped: number;
  /** Total bytes cached */
  bytesCached: number;
  /** Cache hit rate */
  hitRate: number;
}

/**
 * WebSocket Binary Data Connector
 *
 * Bridges WebSocket thumbnail responses with the binary cache system
 */
export class WebSocketBinaryConnector extends EventTarget {
  private websocketClient: WebSocketClient;
  private cache: IBlobCache;
  private storage: SyncStorageManager;
  private config: WebSocketBinaryConnectorConfig;
  private isConnected: boolean = false;
  private stats: BinarySyncStats = {
    thumbnailsProcessed: 0,
    thumbnailsCached: 0,
    thumbnailsSkipped: 0,
    bytesCached: 0,
    hitRate: 0,
  };
  private pendingRequests: Map<string, Promise<boolean>> = new Map();

  constructor(
    websocketClient: WebSocketClient,
    cache: IBlobCache,
    storage: SyncStorageManager,
    config: Partial<WebSocketBinaryConnectorConfig> = {}
  ) {
    super();
    this.websocketClient = websocketClient;
    this.cache = cache;
    this.storage = storage;
    this.config = {
      autoCache: true,
      autoSync: true,
      batchSize: 5,
      debug: false,
      ...config,
    };
  }

  /**
   * Start the connector and set up WebSocket listeners
   */
  async start(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    this.log("Starting WebSocket binary connector...");

    // Set up thumbnail response listener
    if (this.config.autoCache) {
      this.log("🔧 Setting up WebSocket thumbnails listener...");
      this.websocketClient.on("thumbnails", (data) => {
        this.log("🎯 WebSocket thumbnails event received!", data);
        this.handleThumbnailResponse(data).catch((error) => {
          this.log("Error handling thumbnail response:", error);
          this.dispatchEvent(new CustomEvent("error", { detail: { error } }));
        });
      });
      this.log("✅ WebSocket thumbnails listener set up");
    }

    // Set up media blob notification listener for auto-sync
    if (this.config.autoSync) {
      this.websocketClient.on("mediaBlob", (data) => {
        this.handleNewMediaBlob(data).catch((error) => {
          this.log("Error handling new media blob:", error);
          this.dispatchEvent(new CustomEvent("error", { detail: { error } }));
        });
      });
    }

    this.isConnected = true;
    this.log("WebSocket binary connector started");
    this.dispatchEvent(new CustomEvent("connected"));
  }

  /**
   * Stop the connector and clean up listeners
   */
  async stop(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    this.log("Stopping WebSocket binary connector...");

    // Clear listeners
    this.websocketClient.off("thumbnails");
    this.websocketClient.off("mediaBlob");

    // Wait for pending requests to complete
    if (this.pendingRequests.size > 0) {
      this.log(`Waiting for ${this.pendingRequests.size} pending requests...`);
      await Promise.allSettled(this.pendingRequests.values());
      this.pendingRequests.clear();
    }

    this.isConnected = false;
    this.log("WebSocket binary connector stopped");
    this.dispatchEvent(new CustomEvent("disconnected"));
  }

  /**
   * Handle thumbnail response from WebSocket
   */
  private async handleThumbnailResponse(data: {
    media_blob_id: string;
    thumbnails: MediaBlob[];
  }): Promise<void> {
    const { media_blob_id, thumbnails } = data;
    this.log(
      `🎉 RECEIVED WebSocket thumbnail response for ${media_blob_id}: ${thumbnails.length} thumbnails`
    );

    if (thumbnails.length > 0) {
      this.log(
        `Thumbnail details:`,
        thumbnails.map((t) => ({
          id: t.id,
          mime: t.mime,
          size: t.size,
          hasData: !!t.thumbnail_data && t.thumbnail_data.length > 0,
        }))
      );
    }

    if (!thumbnails || thumbnails.length === 0) {
      return;
    }

    // Process thumbnails in batches
    for (let i = 0; i < thumbnails.length; i += this.config.batchSize) {
      const batch = thumbnails.slice(i, i + this.config.batchSize);

      await Promise.all(
        batch.map((thumbnail) =>
          this.processThumbnail(media_blob_id, thumbnail)
        )
      );
    }

    // Update statistics
    this.updateStats();

    // Emit progress event
    this.dispatchEvent(
      new CustomEvent("thumbnails_processed", {
        detail: {
          mediaBlobId: media_blob_id,
          thumbnailCount: thumbnails.length,
          stats: { ...this.stats },
        },
      })
    );
  }

  /**
   * Process a single thumbnail
   */
  private async processThumbnail(
    originalBlobId: string,
    thumbnail: MediaBlob
  ): Promise<void> {
    const thumbnailId = thumbnail.id;

    try {
      this.stats.thumbnailsProcessed++;

      this.log(
        `📸 Processing thumbnail ${thumbnailId} from original blob ${originalBlobId}`
      );

      // Check if already cached
      const isCached = await this.cache.isCached(thumbnailId);
      this.log(
        `🔍 Cache check for ${thumbnailId}: ${isCached ? "CACHED" : "NOT CACHED"}`
      );

      // Temporarily disable cache check to force all thumbnails to be processed
      const forceProcess = true;
      if (isCached && !forceProcess) {
        this.stats.thumbnailsSkipped++;
        this.log(`Thumbnail ${thumbnailId} already cached, skipping`);
        return;
      }

      if (isCached && forceProcess) {
        this.log(
          `🔧 FORCE: Processing cached thumbnail ${thumbnailId} anyway to store in sync storage`
        );
      }

      // Validate file size
      if (
        this.config.maxFileSize &&
        thumbnail.size &&
        thumbnail.size > this.config.maxFileSize
      ) {
        this.stats.thumbnailsSkipped++;
        this.log(
          `Thumbnail ${thumbnailId} too large (${thumbnail.size} bytes), skipping`
        );
        return;
      }

      // Check MIME type priority
      if (
        this.config.priorityMimeTypes &&
        this.config.priorityMimeTypes.length > 0
      ) {
        const mimeType = thumbnail.mime || "";
        const isPriority = this.config.priorityMimeTypes.some((priority) =>
          mimeType.startsWith(priority)
        );
        if (!isPriority) {
          this.stats.thumbnailsSkipped++;
          this.log(
            `Thumbnail ${thumbnailId} MIME type ${mimeType} not priority, skipping`
          );
          return;
        }
      }

      // Extract binary data - check both thumbnail_data and data fields
      let binaryDataArray: number[] | null = null;

      if (thumbnail.thumbnail_data && thumbnail.thumbnail_data.length > 0) {
        binaryDataArray = thumbnail.thumbnail_data;
      } else if (thumbnail.data && thumbnail.data.length > 0) {
        binaryDataArray = thumbnail.data;
      }

      if (!binaryDataArray) {
        this.log(`No binary data found for thumbnail ${thumbnailId}`);
        return;
      }

      // Convert number array to Uint8Array
      const binaryData = new Uint8Array(binaryDataArray);
      const mimeType = thumbnail.mime || "application/octet-stream";

      this.log(
        `💾 Storing ${binaryData.length} bytes of binary data for thumbnail ${thumbnailId}`
      );

      // Cache the binary data
      await this.storage.storeBinaryData(thumbnailId, binaryData, mimeType);

      this.log(
        `✅ Successfully stored binary data for ${thumbnailId} in media_blob_data table`
      );

      this.stats.thumbnailsCached++;
      this.stats.bytesCached += binaryData.length;

      this.log(
        `Cached thumbnail ${thumbnailId} (${binaryData.length} bytes, ${mimeType})`
      );

      // Emit individual thumbnail cached event
      this.dispatchEvent(
        new CustomEvent("thumbnail_cached", {
          detail: {
            thumbnailId,
            originalBlobId,
            size: binaryData.length,
            mimeType,
          },
        })
      );
    } catch (error) {
      this.log(`Error processing thumbnail ${thumbnailId}:`, error);
      this.dispatchEvent(
        new CustomEvent("error", {
          detail: {
            error,
            thumbnailId,
            originalBlobId,
          },
        })
      );
    }
  }

  /**
   * Handle new media blob created notification
   */
  private async handleNewMediaBlob(data: { blob: MediaBlob }): Promise<void> {
    const mediaBlob = data.blob;
    this.log(`New media blob created: ${mediaBlob.id}`);

    // Store the media blob in sync storage
    try {
      const storedBlob: StoredMediaBlob = {
        ...mediaBlob,
        stored_at: new Date().toISOString(),
        synced: true,
        locally_modified: false,
        content_hash: mediaBlob.sha256,
        storage_size: mediaBlob.size || 0,
      };
      await this.storage.storeMediaBlob(storedBlob);

      // Request thumbnails for the new media blob
      if (this.config.autoSync) {
        this.log(`Requesting thumbnails for new media blob ${mediaBlob.id}`);
        this.websocketClient.getThumbnails(mediaBlob.id);
      }

      this.dispatchEvent(
        new CustomEvent("media_blob_added", {
          detail: { mediaBlob },
        })
      );
    } catch (error) {
      this.log(`Error storing new media blob ${mediaBlob.id}:`, error);
      this.dispatchEvent(
        new CustomEvent("error", {
          detail: { error, mediaBlob },
        })
      );
    }
  }

  /**
   * Manually request thumbnails for a media blob
   */
  async requestThumbnails(mediaBlobId: string): Promise<boolean> {
    this.log(`🎯 Requesting thumbnails for media blob: ${mediaBlobId}`);

    if (this.pendingRequests.has(mediaBlobId)) {
      this.log(`Thumbnail request for ${mediaBlobId} already pending`);
      return this.pendingRequests.get(mediaBlobId)!;
    }

    const requestPromise = new Promise<boolean>((resolve) => {
      // Set up one-time listener for this specific request
      const handleResponse = (event: Event) => {
        const customEvent = event as CustomEvent;
        const { mediaBlobId: responseId } = customEvent.detail;
        if (responseId === mediaBlobId) {
          this.removeEventListener("thumbnails_processed", handleResponse);
          this.pendingRequests.delete(mediaBlobId);
          resolve(true);
        }
      };

      const handleError = (_event: Event) => {
        this.removeEventListener("thumbnails_processed", handleResponse);
        this.removeEventListener("error", handleError);
        this.pendingRequests.delete(mediaBlobId);
        resolve(false);
      };

      this.addEventListener("thumbnails_processed", handleResponse);
      this.addEventListener("error", handleError);

      // Send the request
      this.log(
        `📡 Sending WebSocket getThumbnails request for: ${mediaBlobId}`
      );
      const sendResult = this.websocketClient.getThumbnails(mediaBlobId);
      this.log(`📡 WebSocket send result: ${sendResult}`);

      // Timeout after 30 seconds
      setTimeout(() => {
        this.removeEventListener("thumbnails_processed", handleResponse);
        this.removeEventListener("error", handleError);
        this.pendingRequests.delete(mediaBlobId);
        resolve(false);
      }, 30000);
    });

    this.pendingRequests.set(mediaBlobId, requestPromise);
    return requestPromise;
  }

  /**
   * Sync all media blobs by requesting their thumbnails
   */
  async syncAllMediaBlobs(
    progressCallback?: (processed: number, total: number) => void
  ): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    this.log("Starting sync of all media blobs...");

    // Get all media blobs from storage
    const mediaBlobs = await this.storage.queryMediaBlobs();
    this.log(`Found ${mediaBlobs.length} media blobs to sync`);

    // Debug: Log the first few media blob IDs and their thumbnail status
    if (mediaBlobs.length > 0) {
      this.log(
        "First few media blob IDs:",
        mediaBlobs.slice(0, 3).map((b) => b.id)
      );

      // Check blob types and see what we have
      const blobsByType = mediaBlobs.reduce(
        (acc, blob) => {
          const type = blob.blob_type || "unknown";
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      this.log(`📊 Blob types:`, blobsByType);

      const originalBlobs = mediaBlobs.filter(
        (b) => b.blob_type === "original"
      );
      const thumbnailBlobs = mediaBlobs.filter(
        (b) => b.blob_type === "thumbnail"
      );

      this.log(
        `📊 Blob breakdown: ${originalBlobs.length} original, ${thumbnailBlobs.length} thumbnails`
      );

      if (thumbnailBlobs.length > 0) {
        this.log(
          "🖼️ First few thumbnail blobs:",
          thumbnailBlobs.slice(0, 5).map((b) => ({
            id: b.id,
            type: b.blob_type,
            mime: b.mime,
            parent_blob_id: b.parent_blob_id,
            has_data: !!b.data && b.data.length > 0,
            has_thumbnail_data:
              !!b.thumbnail_data && b.thumbnail_data.length > 0,
            metadata_keys: Object.keys(b.metadata || {}),
            size: b.size,
          }))
        );

        // Show ALL thumbnail blob IDs
        this.log("🔍 ALL 4 thumbnail blob IDs:");
        thumbnailBlobs.forEach((thumb, index) => {
          this.log(
            `  ${index + 1}. ${thumb.id} -> parent: ${thumb.parent_blob_id} (${thumb.size} bytes)`
          );
        });

        // Force request thumbnails for ALL parent blobs
        const parentBlobIds = new Set(
          thumbnailBlobs.map((thumb) => thumb.parent_blob_id).filter((id) => id)
        );

        this.log(
          `🧪 Found ${parentBlobIds.size} unique parent blobs, requesting all:`
        );
        parentBlobIds.forEach((parentId) => {
          this.log(`  📡 Requesting thumbnails for parent: ${parentId}`);
          this.websocketClient.getThumbnails(parentId!);
        });
      }

      if (originalBlobs.length > 0) {
        this.log(
          "📁 First few original blobs:",
          originalBlobs.slice(0, 5).map((b) => ({
            id: b.id,
            type: b.blob_type,
            mime: b.mime,
          }))
        );
      }
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    // Process in batches to avoid overwhelming the WebSocket
    for (let i = 0; i < mediaBlobs.length; i += this.config.batchSize) {
      const batch = mediaBlobs.slice(i, i + this.config.batchSize);

      this.log(
        `Processing batch ${Math.floor(i / this.config.batchSize) + 1}: ${batch.map((b) => b.id).join(", ")}`
      );

      const results = await Promise.allSettled(
        batch.map((blob) => this.requestThumbnails(blob.id))
      );

      results.forEach((result) => {
        processed++;
        if (result.status === "fulfilled" && result.value) {
          succeeded++;
        } else {
          failed++;
        }
      });

      if (progressCallback) {
        progressCallback(processed, mediaBlobs.length);
      }

      // Small delay between batches
      if (i + this.config.batchSize < mediaBlobs.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    this.log(
      `Sync complete: ${succeeded}/${processed} succeeded, ${failed} failed`
    );

    return { processed, succeeded, failed };
  }

  /**
   * Get current sync statistics
   */
  getStats(): BinarySyncStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      thumbnailsProcessed: 0,
      thumbnailsCached: 0,
      thumbnailsSkipped: 0,
      bytesCached: 0,
      hitRate: 0,
    };
  }

  /**
   * Update hit rate calculation
   */
  private updateStats(): void {
    if (this.stats.thumbnailsProcessed > 0) {
      this.stats.hitRate =
        this.stats.thumbnailsCached / this.stats.thumbnailsProcessed;
    }
  }

  /**
   * Debug logging
   */
  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log("[WebSocketBinaryConnector]", ...args);
    }
  }

  /**
   * Check if connector is active
   */
  isActive(): boolean {
    return this.isConnected;
  }
}

/**
 * Create a new WebSocket binary connector
 */
export function createWebSocketBinaryConnector(
  websocketClient: WebSocketClient,
  cache: IBlobCache,
  storage: SyncStorageManager,
  config?: Partial<WebSocketBinaryConnectorConfig>
): WebSocketBinaryConnector {
  return new WebSocketBinaryConnector(websocketClient, cache, storage, config);
}

export default WebSocketBinaryConnector;
