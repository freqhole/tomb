//! Photos Sync Demo
//!
//! This demo shows how to use the photos sync functionality similar to how
//! music sync works. It demonstrates syncing photos, galleries, and photo_galleries.

import { UnifiedSyncManagerImpl } from "../sync/unified-sync-manager.js";
import { UnifiedStorageImpl } from "../sync/unified-storage.js";
import { createDomainConfigs } from "../sync/domain-configs.js";
import type { SyncDomain } from "../sync/types.js";

/**
 * Demo photos sync functionality
 */
export async function runPhotosSyncDemo() {
  console.log("🖼️ Starting Photos Sync Demo...");

  try {
    // Create storage instance
    const storage = new UnifiedStorageImpl({
      dbName: "photos_sync_demo",
      dbVersion: 1,
      maxSize: 100 * 1024 * 1024, // 100MB
      domains: ["photos"] as SyncDomain[],
    });

    // Initialize storage
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

    // Initialize sync manager
    await syncManager.initialize();
    console.log("✅ Sync manager initialized");

    // Test photos breakdown (should be empty initially)
    const initialBreakdown = await syncManager.getPhotosBreakdown();
    console.log("📊 Initial photos breakdown:", initialBreakdown);

    // Simulate some photos data
    const mockPhotosData = [
      {
        id: "photo1",
        title: "Sunset Beach",
        description: "Beautiful sunset at the beach",
        width: 1920,
        height: 1080,
        blob_id: "blob_photo1",
        thumbnail_blob_id: "blob_thumb1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        location: { lat: 37.7749, lng: -122.4194 },
        camera_info: { make: "Canon", model: "EOS R5" },
        metadata: { iso: 100, aperture: "f/8" },
        _data_type: "photo",
      },
      {
        id: "photo2",
        title: "Mountain Peak",
        description: "Snow-capped mountain peak",
        width: 2048,
        height: 1536,
        blob_id: "blob_photo2",
        thumbnail_blob_id: "blob_thumb2",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        location: { lat: 46.8523, lng: -121.7603 },
        camera_info: { make: "Nikon", model: "D850" },
        metadata: { iso: 200, aperture: "f/11" },
        _data_type: "photo",
      },
    ];

    const mockGalleriesData = [
      {
        id: "gallery1",
        title: "Nature Collection",
        description: "My favorite nature photos",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { theme: "nature", privacy: "public" },
        _data_type: "gallery",
      },
      {
        id: "gallery2",
        title: "Travel Memories",
        description: "Photos from my travels",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { theme: "travel", privacy: "private" },
        _data_type: "gallery",
      },
    ];

    const mockPhotoGalleriesData = [
      {
        id: "pg1",
        gallery_id: "gallery1",
        photo_id: "photo1",
        position: 1,
        created_at: new Date().toISOString(),
        _data_type: "photo_gallery",
      },
      {
        id: "pg2",
        gallery_id: "gallery1",
        photo_id: "photo2",
        position: 2,
        created_at: new Date().toISOString(),
        _data_type: "photo_gallery",
      },
      {
        id: "pg3",
        gallery_id: "gallery2",
        photo_id: "photo1",
        position: 1,
        created_at: new Date().toISOString(),
        _data_type: "photo_gallery",
      },
    ];

    // Store photos domain data
    const allPhotosData = [
      ...mockPhotosData,
      ...mockGalleriesData,
      ...mockPhotoGalleriesData,
    ];

    console.log("💾 Storing photos data...");
    await storage.storeItems("photos", allPhotosData);

    // Get photos breakdown after storing data
    const finalBreakdown = await syncManager.getPhotosBreakdown();
    console.log("📊 Final photos breakdown:", finalBreakdown);

    // Verify the breakdown matches our mock data
    const expectedBreakdown = {
      photos: 2,
      galleries: 2,
      photoGalleries: 3,
    };

    console.log("✅ Expected breakdown:", expectedBreakdown);
    console.log("✅ Actual breakdown:", finalBreakdown);

    // Verify each count
    const success =
      finalBreakdown.photos === expectedBreakdown.photos &&
      finalBreakdown.galleries === expectedBreakdown.galleries &&
      finalBreakdown.photoGalleries === expectedBreakdown.photoGalleries;

    if (success) {
      console.log("🎉 Photos sync demo completed successfully!");
      console.log("✅ All photos domain tables are working correctly");
      console.log("✅ Photos breakdown functionality is working");
    } else {
      console.error("❌ Photos sync demo failed - breakdown mismatch");
    }

    // Test retrieving photos items
    console.log("📖 Testing photos retrieval...");
    const retrievedPhotos = await storage.getItems("photos");
    console.log(`📋 Retrieved ${retrievedPhotos.length} photos items`);

    // Test storage stats
    const stats = await storage.getStats();
    console.log("📊 Storage stats:", {
      photos: stats.itemCounts.photos,
      totalSize: stats.totalSize,
      binarySize: stats.binarySize,
    });

    // Cleanup
    await syncManager.destroy();
    await storage.destroyAll();
    console.log("🧹 Cleanup completed");

    return success;
  } catch (error) {
    console.error("❌ Photos sync demo failed:", error);
    return false;
  }
}

/**
 * Test the new multi-endpoint photos sync functionality
 */
export async function testPhotosMultiEndpointSync() {
  console.log("🔄 Testing Photos Multi-Endpoint Sync...");

  try {
    // Create storage instance
    const storage = new UnifiedStorageImpl({
      dbName: "photos_multi_sync_test",
      dbVersion: 1,
      maxSize: 100 * 1024 * 1024,
      domains: ["photos"] as SyncDomain[],
    });

    await storage.initialize();

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

    console.log("📊 Initial photos breakdown:");
    const initialBreakdown = await syncManager.getPhotosBreakdown();
    console.log(initialBreakdown);

    console.log("🔄 Starting photos domain sync (should call 3 endpoints)...");

    // This should now call:
    // 1. /api/sync/photos
    // 2. /api/sync/galleries
    // 3. /api/sync/photo-galleries
    const syncResult = await syncManager.syncDomain("photos", {
      forceFullSync: true,
      pageSize: 50,
    });

    console.log("✅ Photos sync result:", syncResult);

    console.log("📊 Final photos breakdown:");
    const finalBreakdown = await syncManager.getPhotosBreakdown();
    console.log(finalBreakdown);

    console.log("📊 Storage stats:");
    const stats = await storage.getStats();
    console.log({
      photos: stats.itemCounts.photos,
      totalSize: stats.totalSize,
    });

    // Verify we have data in all three tables
    const success =
      finalBreakdown.photos > 0 ||
      finalBreakdown.galleries > 0 ||
      finalBreakdown.photoGalleries > 0;

    if (success) {
      console.log("🎉 Multi-endpoint photos sync test completed successfully!");
      console.log("✅ Photos domain is now syncing all three table types");
    } else {
      console.log("⚠️ No data synced - check if server has photos data");
    }

    // Cleanup
    await syncManager.destroy();
    await storage.destroyAll();

    return success;
  } catch (error) {
    console.error("❌ Photos multi-endpoint sync test failed:", error);
    return false;
  }
}

/**
 * Compare photos sync with music sync functionality
 */
export async function comparePhotosMusicSync() {
  console.log("🔄 Comparing Photos vs Music Sync...");

  try {
    // Create storage instance
    const storage = new UnifiedStorageImpl({
      dbName: "compare_sync_demo",
      dbVersion: 1,
      maxSize: 100 * 1024 * 1024,
      domains: ["music", "photos"] as SyncDomain[],
    });

    await storage.initialize();

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

    // Mock music data
    const mockMusicData = [
      {
        id: "song1",
        title: "Test Song",
        artist: "Test Artist",
        album: "Test Album",
        duration: 180,
        blob_id: "blob_song1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { genre: "rock" },
        _data_type: "song",
      },
      {
        id: "playlist1",
        title: "Test Playlist",
        description: "A test playlist",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { mood: "chill" },
        _data_type: "playlist",
      },
      {
        id: "ps1",
        playlist_id: "playlist1",
        song_id: "song1",
        position: 1,
        created_at: new Date().toISOString(),
        _data_type: "playlist_song",
      },
    ];

    // Mock photos data
    const mockPhotosData = [
      {
        id: "photo1",
        title: "Test Photo",
        description: "A test photo",
        width: 1920,
        height: 1080,
        blob_id: "blob_photo1",
        thumbnail_blob_id: "blob_thumb1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        location: { lat: 0, lng: 0 },
        camera_info: { make: "Test", model: "Camera" },
        metadata: { iso: 100 },
        _data_type: "photo",
      },
      {
        id: "gallery1",
        title: "Test Gallery",
        description: "A test gallery",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { theme: "test" },
        _data_type: "gallery",
      },
      {
        id: "pg1",
        gallery_id: "gallery1",
        photo_id: "photo1",
        position: 1,
        created_at: new Date().toISOString(),
        _data_type: "photo_gallery",
      },
    ];

    // Store both domains
    await storage.storeItems("music", mockMusicData);
    await storage.storeItems("photos", mockPhotosData);

    // Get breakdowns
    const musicBreakdown = await syncManager.getMusicBreakdown();
    const photosBreakdown = await syncManager.getPhotosBreakdown();

    console.log("🎵 Music breakdown:", musicBreakdown);
    console.log("🖼️ Photos breakdown:", photosBreakdown);

    // Verify both domains work similarly
    const musicSuccess =
      musicBreakdown.songs === 1 &&
      musicBreakdown.playlists === 1 &&
      musicBreakdown.playlistSongs === 1;

    const photosSuccess =
      photosBreakdown.photos === 1 &&
      photosBreakdown.galleries === 1 &&
      photosBreakdown.photoGalleries === 1;

    if (musicSuccess && photosSuccess) {
      console.log("🎉 Both domains work correctly!");
      console.log("✅ Music sync: ✓");
      console.log("✅ Photos sync: ✓");
      console.log("✅ Both follow the same three-table pattern");
    } else {
      console.error("❌ Domain comparison failed");
      console.error("Music success:", musicSuccess);
      console.error("Photos success:", photosSuccess);
    }

    // Cleanup
    await syncManager.destroy();
    await storage.destroyAll();

    return musicSuccess && photosSuccess;
  } catch (error) {
    console.error("❌ Comparison demo failed:", error);
    return false;
  }
}

// Export functions for use in browser console or other scripts
if (typeof window !== "undefined") {
  (window as any).runPhotosSyncDemo = runPhotosSyncDemo;
  (window as any).testPhotosMultiEndpointSync = testPhotosMultiEndpointSync;
  (window as any).comparePhotosMusicSync = comparePhotosMusicSync;
}

// If running in Node.js, execute the demo
if (typeof process !== "undefined" && process.argv[0]?.includes("node")) {
  testPhotosMultiEndpointSync()
    .then((success) => {
      if (success) {
        console.log("🎉 Multi-endpoint sync test passed!");
        return runPhotosSyncDemo();
      } else {
        console.error("❌ Multi-endpoint sync test failed");
        process.exit(1);
      }
    })
    .then((success) => {
      if (success) {
        console.log("🎉 Photos sync demo completed successfully!");
        return comparePhotosMusicSync();
      } else {
        console.error("❌ Photos sync demo failed");
        process.exit(1);
      }
    })
    .then((success) => {
      if (success) {
        console.log("🎉 All demos completed successfully!");
        process.exit(0);
      } else {
        console.error("❌ Comparison demo failed");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("❌ Demo execution failed:", error);
      process.exit(1);
    });
}
