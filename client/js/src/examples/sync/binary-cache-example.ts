//! Binary Cache Example
//!
//! This example shows how to use the media blob binary cache to download
//! and cache binary data for offline use, separate from the main sync data.

import { createMediaBlobCache, MediaBlobCache } from "../../sync/media-blob-cache.js";
import { createMediaBlobBinarySync, MediaBlobBinarySync } from "../../sync/media-blob-binary-sync.js";
import { SyncStorageManager } from "../../sync/sync-storage.js";
import { WebSocketClient } from "../../lib/websocket-client.js";

/**
 * Example: Set up binary cache and sync media blob data
 */
export async function setupBinaryCacheExample(): Promise<{
  cache: MediaBlobCache;
  binarySync: MediaBlobBinarySync;
  storage: SyncStorageManager;
}> {
  console.log("🗂️ Setting up binary cache...");

  // Initialize storage
  const storage = new SyncStorageManager({
    database_name: "example_sync_storage",
    version: 4,
    max_storage_size: 100 * 1024 * 1024, // 100MB
    max_cache_age_days: 30,
  });

  await storage.initialize();

  // Initialize binary cache
  const cache = createMediaBlobCache({
    dbName: "example_binary_cache",
    maxCacheSize: 50 * 1024 * 1024, // 50MB
    maxAge: 7, // 7 days
    batchSize: 5,
  });

  await cache.initialize();

  // Create binary sync manager
  const binarySync = createMediaBlobBinarySync(cache, storage, {
    priorityMimeTypes: ["image/", "audio/"], // Prioritize images and audio
    maxConcurrent: 2, // Download 2 files at once
    batchSize: 5,
    maxFileSize: 10 * 1024 * 1024, // Skip files larger than 10MB
  });

  console.log("✅ Binary cache setup complete");

  return { cache, binarySync, storage };
}

/**
 * Example: Sync all binary data for cached media blobs
 */
export async function syncAllBinaryDataExample(
  websocketClient: WebSocketClient
): Promise<void> {
  console.log("📥 Starting binary data sync example...");

  const { cache, binarySync, storage } = await setupBinaryCacheExample();

  try {
    // Set up progress tracking
    binarySync.addEventListener("progress", (event: any) => {
      const progress = event.detail;
      console.log(`📊 Progress: ${progress.phase} - ${progress.processed}/${progress.total}`);

      if (progress.currentItem) {
        console.log(`   📦 Processing: ${progress.currentItem}`);
      }

      if (progress.bytesDownloaded > 0) {
        const mb = (progress.bytesDownloaded / 1024 / 1024).toFixed(2);
        console.log(`   💾 Downloaded: ${mb}MB`);
      }
    });

    // Start the sync
    const result = await binarySync.syncAllBinaryData(websocketClient);

    console.log("🎉 Binary sync complete!");
    console.log(`   ✅ Cached: ${result.cached} items`);
    console.log(`   ⏭️ Skipped: ${result.skipped} items`);
    console.log(`   ❌ Failed: ${result.failed} items`);
    console.log(`   💾 Downloaded: ${(result.bytesDownloaded / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   ⏱️ Duration: ${result.duration}ms`);

    if (result.errors.length > 0) {
      console.log("❌ Errors encountered:");
      result.errors.forEach(error => {
        console.log(`   - ${error.blobId}: ${error.error}`);
      });
    }

  } catch (error) {
    console.error("❌ Binary sync failed:", error);
  } finally {
    await cache.close();
    await storage.close();
  }
}

/**
 * Example: Use cached binary data to create blob URLs
 */
export async function useCachedBinaryDataExample(): Promise<void> {
  console.log("🔗 Using cached binary data example...");

  const { cache, storage } = await setupBinaryCacheExample();

  try {
    // Get some media blobs from storage
    const mediaBlobs = await storage.getAllMediaBlobs();
    console.log(`Found ${mediaBlobs.length} media blobs in storage`);

    for (const blob of mediaBlobs.slice(0, 3)) { // Just first 3 for demo
      // Check if binary data is cached
      const isCached = await cache.isCached(blob.id);
      console.log(`📦 ${blob.id} (${blob.mime}): ${isCached ? "✅ Cached" : "❌ Not cached"}`);

      if (isCached) {
        // Get blob URL for displaying/playing
        const blobUrl = await cache.getBlobUrl(blob.id);

        if (blobUrl) {
          console.log(`   🔗 Blob URL: ${blobUrl.substring(0, 50)}...`);

          // In a real app, you'd use this URL in an <img>, <audio>, or <video> tag
          // Example: imageElement.src = blobUrl;

          // Important: Release the URL when done to free memory
          // cache.releaseBlobUrl(blob.id);
        }
      }
    }

    // Get cache statistics
    const stats = await cache.getStats();
    console.log("📊 Cache Statistics:");
    console.log(`   📁 Total items: ${stats.totalItems}`);
    console.log(`   💾 Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   🔗 Active blob URLs: ${stats.activeBlobUrls}`);
    console.log(`   🎯 Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);

  } catch (error) {
    console.error("❌ Example failed:", error);
  } finally {
    await cache.close();
    await storage.close();
  }
}

/**
 * Example: Priority sync for specific media types
 */
export async function prioritySyncExample(
  websocketClient: WebSocketClient
): Promise<void> {
  console.log("🎯 Priority sync example - images only...");

  const { cache, storage } = await setupBinaryCacheExample();

  try {
    // Create binary sync focused on images only
    const imageBinarySync = createMediaBlobBinarySync(cache, storage, {
      priorityMimeTypes: ["image/"], // Only images
      maxConcurrent: 3,
      batchSize: 10,
      maxFileSize: 5 * 1024 * 1024, // Only files under 5MB
    });

    const result = await imageBinarySync.syncAllBinaryData(websocketClient);

    console.log("🖼️ Image sync complete!");
    console.log(`   ✅ Cached: ${result.cached} images`);
    console.log(`   💾 Downloaded: ${(result.bytesDownloaded / 1024 / 1024).toFixed(2)}MB`);

  } catch (error) {
    console.error("❌ Priority sync failed:", error);
  } finally {
    await cache.close();
    await storage.close();
  }
}

/**
 * Example: Manual binary data management
 */
export async function manualBinaryCacheExample(
  websocketClient: WebSocketClient
): Promise<void> {
  console.log("🔧 Manual binary cache example...");

  const cache = createMediaBlobCache({
    dbName: "manual_cache_example",
    maxCacheSize: 10 * 1024 * 1024, // 10MB
  });

  await cache.initialize();

  try {
    // Manually request and cache specific blob IDs
    const blobIds = ["abc1234", "def5678", "ghi9012"]; // Example IDs

    for (const blobId of blobIds) {
      console.log(`📥 Requesting ${blobId}...`);

      try {
        const success = await cache.requestAndCache(blobId, websocketClient);

        if (success) {
          console.log(`   ✅ Cached ${blobId}`);

          // Get the cached data info
          const cachedData = await cache.getCachedData(blobId);
          if (cachedData) {
            console.log(`   📊 Size: ${cachedData.size} bytes, MIME: ${cachedData.mime}`);
          }
        } else {
          console.log(`   ❌ Failed to cache ${blobId}`);
        }
      } catch (error) {
        console.log(`   ❌ Error caching ${blobId}:`, error);
      }
    }

    // Clean up old entries
    console.log("🧹 Running cache cleanup...");
    const cleanup = await cache.cleanup();
    console.log(`   🗑️ Removed ${cleanup.removed} items, freed ${cleanup.freedBytes} bytes`);

  } catch (error) {
    console.error("❌ Manual cache example failed:", error);
  } finally {
    await cache.close();
  }
}

/**
 * Example: Create a simple media player using cached data
 */
export async function mediaPlayerExample(blobId: string): Promise<HTMLAudioElement | null> {
  console.log(`🎵 Creating media player for ${blobId}...`);

  const cache = createMediaBlobCache();
  await cache.initialize();

  try {
    // Get blob URL for the audio file
    const blobUrl = await cache.getBlobUrl(blobId);

    if (!blobUrl) {
      console.log("❌ Audio not cached");
      return null;
    }

    // Create audio element
    const audio = document.createElement("audio");
    audio.src = blobUrl;
    audio.controls = true;

    // Clean up URL when audio is done
    audio.addEventListener("ended", () => {
      cache.releaseBlobUrl(blobId);
    });

    console.log("✅ Audio player created");
    return audio;

  } catch (error) {
    console.error("❌ Media player creation failed:", error);
    return null;
  }
}

/**
 * Run all binary cache examples
 */
export async function runAllBinaryCacheExamples(
  websocketClient: WebSocketClient
): Promise<void> {
  console.log("🚀 Running all binary cache examples...\n");

  try {
    await useCachedBinaryDataExample();
    console.log("\n" + "=".repeat(50) + "\n");

    await prioritySyncExample(websocketClient);
    console.log("\n" + "=".repeat(50) + "\n");

    await manualBinaryCacheExample(websocketClient);
    console.log("\n" + "=".repeat(50) + "\n");

    // Note: syncAllBinaryDataExample is commented out as it downloads a lot of data
    // await syncAllBinaryDataExample(websocketClient);

    console.log("🎉 All binary cache examples completed!");

  } catch (error) {
    console.error("❌ Examples failed:", error);
  }
}

// Browser global export for testing
if (typeof window !== "undefined") {
  (window as any).binaryCacheExamples = {
    setupBinaryCacheExample,
    syncAllBinaryDataExample,
    useCachedBinaryDataExample,
    prioritySyncExample,
    manualBinaryCacheExample,
    mediaPlayerExample,
    runAllBinaryCacheExamples,
  };
}

export default {
  setupBinaryCacheExample,
  syncAllBinaryDataExample,
  useCachedBinaryDataExample,
  prioritySyncExample,
  manualBinaryCacheExample,
  mediaPlayerExample,
  runAllBinaryCacheExamples,
};
