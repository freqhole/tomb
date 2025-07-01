//! Integrated Sync Example
//!
//! This example demonstrates how to use the integrated sync manager that combines
//! music synchronization with WebSocket-based binary data caching.

import {
  createIntegratedSyncManager,
  defaultIntegratedSyncConfig,
} from "../../sync/integrated-sync-manager.js";
import { SyncStorageManager } from "../../sync/sync-storage.js";
import { WebSocketClient } from "../../lib/websocket-client.js";

/**
 * Example: Set up and use the integrated sync manager
 */
export async function integratedSyncExample(): Promise<void> {
  console.log("🚀 Starting integrated sync example...");

  // Set up storage
  const storage = new SyncStorageManager({
    database_name: "webauthn_sync_storage",
    version: 4,
    max_storage_size: 100 * 1024 * 1024, // 100MB
    max_cache_age_days: 30, // 30 days
  });
  await storage.initialize();

  // Set up WebSocket client
  const wsClient = new WebSocketClient({
    url: "ws://localhost:8080/ws",
    autoReconnect: true,
    debug: true,
  });

  // Create integrated sync manager
  const syncManager = createIntegratedSyncManager(wsClient, storage, {
    ...defaultIntegratedSyncConfig,
    apiBaseUrl: "http://localhost:8080",
    authToken: "your-auth-token",
    clientId: "example-client",
    batchSize: 10,
    maxRetryAttempts: 3,
    retryDelay: 1000,
    conflictResolution: "manual",
    enableStorage: true,
    maxStorageSize: 100 * 1024 * 1024,
    maxCacheAge: 30,
    enableWebSocketBinarySync: true,
    autoSyncOnNewBlobs: true,
    binarySync: {
      priorityMimeTypes: ["image/", "audio/"],
      batchSize: 3,
      maxFileSize: 5 * 1024 * 1024, // 5MB max
      debug: true,
    },
  });

  // Set up event listeners
  syncManager.addEventListener("progress", (event: any) => {
    const progress = event.detail;
    console.log("📊 Sync Progress:", {
      overall: progress.overallStatus,
      music: `${progress.musicSync.status} (${progress.musicSync.totalItemsSynced} items)`,
      binary: `${progress.binarySync.status} (${progress.binarySync.thumbnailsCached} cached)`,
      combinedProgress: `${Math.round(progress.combinedProgress || 0)}%`,
    });
  });

  syncManager.addEventListener("complete", (event: any) => {
    const result = event.detail;
    console.log("✅ Sync Complete!", {
      musicItems: result.musicSync.itemsSynced,
      thumbnails: result.binarySync.thumbnailsCached,
      totalBytes: result.binarySync.bytesCached,
      duration: `${result.totalDuration}ms`,
    });
  });

  syncManager.addEventListener("media_blob_added", (event: any) => {
    const { mediaBlob } = event.detail;
    console.log("📸 New media blob detected:", {
      id: mediaBlob.id,
      type: mediaBlob.mime,
      size: mediaBlob.size,
    });
  });

  syncManager.addEventListener("error", (event: any) => {
    console.error("❌ Sync Error:", event.detail);
  });

  try {
    // Initialize the sync manager
    await syncManager.initialize();
    console.log("✅ Sync manager initialized");

    // Connect WebSocket
    await wsClient.connect();
    console.log("🔌 WebSocket connected");

    // Perform initial sync
    console.log("🔄 Starting initial sync...");
    const result = await syncManager.sync({
      force: true,
      syncBinaryData: true,
      pageSize: 50,
    });

    console.log("🎉 Initial sync completed!", result);

    // Demonstrate thumbnail usage
    await demonstrateThumbnailUsage(syncManager, storage);

    // Demonstrate real-time updates
    await demonstrateRealTimeUpdates(syncManager, wsClient);
  } catch (error) {
    console.error("💥 Example failed:", error);
  }
}

/**
 * Demonstrate how to use cached thumbnails
 */
async function demonstrateThumbnailUsage(
  syncManager: any,
  storage: SyncStorageManager
): Promise<void> {
  console.log("\n📸 Demonstrating thumbnail usage...");

  // Get some media blobs
  const mediaBlobs = await storage.queryMediaBlobs({ limit: 5 });
  console.log(`Found ${mediaBlobs.length} media blobs`);

  for (const blob of mediaBlobs) {
    console.log(`\n🎵 Media Blob: ${blob.id} (${blob.mime})`);

    // Check if we have cached binary data
    const hasCached = await storage.hasBinaryData(blob.id);
    console.log(`   Cached: ${hasCached ? "✅" : "❌"}`);

    if (hasCached) {
      // Get cached data
      const cachedData = await storage.getBinaryData(blob.id);
      if (cachedData) {
        console.log(`   Size: ${cachedData.size} bytes`);
        console.log(`   MIME: ${cachedData.mime}`);
        console.log(`   Cached at: ${cachedData.cached_at}`);

        // Create blob URL for use in UI
        const blobUrl = await syncManager.getThumbnailUrl(blob.id);
        if (blobUrl) {
          console.log(`   Blob URL: ${blobUrl.substring(0, 50)}...`);

          // In a real app, you'd use this URL in an <img> tag or audio player
          // <img src={blobUrl} alt="Thumbnail" />

          // Don't forget to release when done!
          syncManager.releaseThumbnailUrl(blob.id);
        }
      }
    } else {
      // Request thumbnails if not cached
      console.log("   Requesting thumbnails...");
      const success = await syncManager.requestThumbnails(blob.id);
      console.log(`   Request result: ${success ? "✅" : "❌"}`);
    }
  }
}

/**
 * Demonstrate real-time sync updates
 */
async function demonstrateRealTimeUpdates(
  syncManager: any,
  wsClient: WebSocketClient
): Promise<void> {
  console.log("\n⚡ Demonstrating real-time updates...");
  console.log(
    "   (This would automatically sync new media blobs as they're created)"
  );

  // The sync manager is already listening for:
  // - "mediaBlob" WebSocket messages (new blobs created)
  // - "thumbnails" WebSocket messages (thumbnail responses)

  // In a real app, these would be triggered by:
  // 1. User uploading new media files
  // 2. Server processing and generating thumbnails
  // 3. WebSocket notifications about new content

  console.log("   ✅ Real-time listeners are active");
  console.log("   📡 Waiting for WebSocket notifications...");
}

/**
 * Example: Show sync statistics
 */
export async function showSyncStats(syncManager: any): Promise<void> {
  console.log("\n📊 Sync Statistics:");

  const stats = await syncManager.getStats();

  console.log("Music Sync:", {
    totalSongs: stats.music?.songs?.total || 0,
    totalPlaylists: stats.music?.playlists?.total || 0,
    lastSync: stats.music?.lastSync,
  });

  if (stats.binary) {
    console.log("Binary Cache:", {
      totalItems: stats.binary.totalItems,
      totalSize: `${Math.round((stats.binary.totalSize / 1024 / 1024) * 100) / 100} MB`,
      hitRate: `${Math.round(stats.binary.hitRate * 100)}%`,
      activeBlobUrls: stats.binary.activeBlobUrls,
    });
  }

  console.log("Storage:", {
    totalSize: `${Math.round((stats.storage.totalSize / 1024 / 1024) * 100) / 100} MB`,
    mediaBlobs: stats.storage.mediaBlobsCount,
    songs: stats.storage.songsCount,
    playlists: stats.storage.playlistsCount,
  });
}

/**
 * Example: Clean up resources
 */
export async function cleanupExample(
  syncManager: any,
  wsClient: WebSocketClient,
  storage: SyncStorageManager
): Promise<void> {
  console.log("\n🧹 Cleaning up resources...");

  // Close sync manager (this also cleans up binary cache and connector)
  await syncManager.close();
  console.log("   ✅ Sync manager closed");

  // Disconnect WebSocket
  wsClient.disconnect();
  console.log("   ✅ WebSocket disconnected");

  // Close storage
  await storage.close();
  console.log("   ✅ Storage closed");

  console.log("🎉 Cleanup complete!");
}

/**
 * Run the complete integrated sync example
 */
export async function runIntegratedSyncExample(): Promise<void> {
  console.log("🎯 Running complete integrated sync example...\n");

  let syncManager: any;
  let wsClient: WebSocketClient;
  let storage: SyncStorageManager;

  try {
    // Run the main example
    await integratedSyncExample();

    // Note: In a real implementation, you'd keep references to these
    // and clean them up when your app shuts down
  } catch (error) {
    console.error("💥 Example failed:", error);
  }

  console.log("\n" + "=".repeat(60));
  console.log("🏁 Integrated sync example completed!");
  console.log("=".repeat(60));
}

// Export for browser console testing
if (typeof window !== "undefined") {
  (window as any).integratedSyncExample = {
    runIntegratedSyncExample,
    integratedSyncExample,
    showSyncStats,
    cleanupExample,
  };
}

export default {
  runIntegratedSyncExample,
  integratedSyncExample,
  showSyncStats,
  cleanupExample,
};
