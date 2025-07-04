//! Photos Binary Sync Test
//!
//! This test demonstrates photo thumbnail binary data syncing via WebSocket.
//! It shows how photos domain now supports binary data fetching for both
//! main photo files and thumbnail images.

import { UnifiedSyncManagerImpl } from "../sync/unified-sync-manager.js";
import { UnifiedStorageImpl } from "../sync/unified-storage.js";
import { createDomainConfigs } from "../sync/domain-configs.js";

/**
 * Test photos binary sync functionality
 */
async function testPhotosBinarySync() {
  console.log("🖼️ Testing Photos Binary Sync...");

  try {
    // Create storage instance
    const storage = new UnifiedStorageImpl({
      maxSize: 100 * 1024 * 1024,
      domains: ["photos"],
    });

    await storage.initialize();
    console.log("✅ Storage initialized");

    // Create sync manager
    const syncManager = new UnifiedSyncManagerImpl(
      storage,
      createDomainConfigs(),
      {
        apiBaseUrl: "http://localhost:3000",
        clientId: crypto.randomUUID(),
        enableServiceWorker: false,
        enableAutoSync: false,
        binaryConfig: {
          enabled: true,
          maxConcurrent: 3,
          chunkSize: 64 * 1024,
        },
      }
    );

    await syncManager.initialize();
    console.log("✅ Sync manager initialized");

    // Check initial state
    console.log("📊 Initial photos breakdown:");
    const initialBreakdown = await syncManager.getPhotosBreakdown();
    console.log(initialBreakdown);

    // Step 1: Sync photos metadata (without binary data)
    console.log("🔄 Step 1: Syncing photos metadata...");
    const metadataResult = await syncManager.syncDomain("photos", {
      forceFullSync: true,
      includeBinaryData: false, // Metadata only
      pageSize: 50,
    });

    console.log("✅ Metadata sync result:", metadataResult);

    // Check what photos we have
    const photosBreakdown = await syncManager.getPhotosBreakdown();
    console.log("📊 Photos breakdown after metadata sync:", photosBreakdown);

    if (photosBreakdown.photos === 0) {
      console.log("⚠️ No photos found - make sure server has photo data");
      return false;
    }

    // Step 2: Sync photos with binary data (thumbnails)
    console.log("🔄 Step 2: Syncing photos with binary data...");
    console.log("📡 This should fetch photo thumbnails via WebSocket...");

    const binaryResult = await syncManager.syncDomain("photos", {
      forceFullSync: true,
      includeBinaryData: true, // Enable binary sync!
      pageSize: 50,
    });

    console.log("✅ Binary sync result:", binaryResult);

    // Step 3: Test binary data access
    console.log("🔍 Step 3: Testing binary data access...");

    // Get photos and check if we can access their thumbnails
    const photos = await storage.getItems("photos");
    console.log(`📋 Found ${photos.length} photos`);

    let thumbnailsFound = 0;
    let photosFound = 0;

    for (const photo of photos.slice(0, 3)) { // Test first 3 photos
      console.log(`🖼️ Testing photo: ${photo.title || photo.id}`);

      // Test main photo blob
      if (photo.media_blob_id) {
        const hasBinary = await syncManager.hasBinaryData(photo.media_blob_id);
        console.log(`  📄 Main photo binary: ${hasBinary ? '✅' : '❌'}`);
        if (hasBinary) photosFound++;

        // Try to get blob URL
        if (hasBinary) {
          const blobUrl = await syncManager.getBlobUrl(photo.media_blob_id);
          console.log(`  🔗 Photo blob URL: ${blobUrl ? '✅' : '❌'}`);
        }
      }

      // Test thumbnail blob
      if (photo.thumbnail_blob_id) {
        const hasThumbnail = await syncManager.hasBinaryData(photo.thumbnail_blob_id);
        console.log(`  🖼️ Thumbnail binary: ${hasThumbnail ? '✅' : '❌'}`);
        if (hasThumbnail) thumbnailsFound++;

        // Try to get thumbnail blob URL
        if (hasThumbnail) {
          const thumbnailUrl = await syncManager.getBlobUrl(photo.thumbnail_blob_id);
          console.log(`  🔗 Thumbnail URL: ${thumbnailUrl ? '✅' : '❌'}`);
        }
      }
    }

    // Summary
    console.log("\n📊 Binary Sync Test Results:");
    console.log(`  Photos with binary data: ${photosFound}`);
    console.log(`  Thumbnails with binary data: ${thumbnailsFound}`);
    console.log(`  Total binary items: ${photosFound + thumbnailsFound}`);

    const success = photosFound > 0 || thumbnailsFound > 0;

    if (success) {
      console.log("🎉 Photos binary sync test PASSED!");
      console.log("✅ Photo thumbnails are now syncing via WebSocket");
      console.log("✅ Binary data can be accessed via getBlobUrl()");
    } else {
      console.log("❌ Photos binary sync test FAILED");
      console.log("⚠️ No binary data was synced - check WebSocket connection");
    }

    // Cleanup
    await syncManager.destroy();
    await storage.destroyAll();

    return success;

  } catch (error) {
    console.error("❌ Photos binary sync test failed:", error);
    return false;
  }
}

/**
 * Compare binary sync between music and photos
 */
async function compareMusicPhotosBindySync() {
  console.log("🔄 Comparing Music vs Photos Binary Sync...");

  try {
    const storage = new UnifiedStorageImpl({
      maxSize: 200 * 1024 * 1024,
      domains: ["music", "photos"],
    });

    await storage.initialize();

    const syncManager = new UnifiedSyncManagerImpl(
      storage,
      createDomainConfigs(),
      {
        apiBaseUrl: "http://localhost:3000",
        clientId: crypto.randomUUID(),
        enableServiceWorker: false,
        enableAutoSync: false,
        binaryConfig: {
          enabled: true,
          maxConcurrent: 5,
          chunkSize: 64 * 1024,
        },
      }
    );

    await syncManager.initialize();

    // Test music binary sync
    console.log("🎵 Testing music binary sync...");
    const musicResult = await syncManager.syncDomain("music", {
      includeBinaryData: true,
      pageSize: 10,
    });
    console.log("🎵 Music result:", musicResult);

    // Test photos binary sync
    console.log("🖼️ Testing photos binary sync...");
    const photosResult = await syncManager.syncDomain("photos", {
      includeBinaryData: true,
      pageSize: 10,
    });
    console.log("🖼️ Photos result:", photosResult);

    console.log("\n📊 Comparison Results:");
    console.log(`🎵 Music domain: ${musicResult.binaryStats ? 'Binary sync enabled' : 'No binary sync'}`);
    console.log(`🖼️ Photos domain: ${photosResult.binaryStats ? 'Binary sync enabled' : 'No binary sync'}`);

    const bothWork = musicResult.binaryStats && photosResult.binaryStats;

    if (bothWork) {
      console.log("🎉 Both domains support binary sync!");
    } else {
      console.log("⚠️ Binary sync support differs between domains");
    }

    await syncManager.destroy();
    await storage.destroyAll();

    return bothWork;

  } catch (error) {
    console.error("❌ Comparison test failed:", error);
    return false;
  }
}

// Export for browser console use
if (typeof window !== "undefined") {
  window.testPhotosBinarySync = testPhotosBinarySync;
  window.compareMusicPhotosBindySync = compareMusicPhotosBindySync;

  // Auto-run test
  console.log("🚀 Photos binary sync test available!");
  console.log("Run: testPhotosBinarySync() or compareMusicPhotosBindySync()");
}

// Node.js execution
if (typeof process !== "undefined" && process.argv[0]?.includes("node")) {
  testPhotosBinarySync()
    .then(success => {
      if (success) {
        console.log("🎉 Basic test passed! Running comparison...");
        return compareMusicPhotosBindySync();
      } else {
        console.error("❌ Basic test failed");
        process.exit(1);
      }
    })
    .then(success => {
      if (success) {
        console.log("🎉 All binary sync tests passed!");
        process.exit(0);
      } else {
        console.error("❌ Comparison test failed");
        process.exit(1);
      }
    })
    .catch(error => {
      console.error("❌ Test execution failed:", error);
      process.exit(1);
    });
}
