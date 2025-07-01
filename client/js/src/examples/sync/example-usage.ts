//! Example usage of the sync system
//!
//! This file demonstrates how to use the sync system in a simple application.
//! It shows initialization, basic sync operations, event handling, and cleanup.

import { ApiClient } from "../../lib/api-client.js";
import { createSyncManager, SyncEventType } from "../../sync-legacy/index.js";

/**
 * Simple example showing basic sync usage
 */
export async function basicSyncExample() {
  console.log("=== Basic Sync Example ===");

  // 1. Create API client
  const apiClient = new ApiClient({
    baseUrl: "http://localhost:8080",
  });

  // 2. Create sync manager
  const syncManager = createSyncManager(apiClient, "example-client-id", {
    defaultPageSize: 25,
    includeBinaryData: false,
    storage: {
      enabled: true,
      maxSize: 50 * 1024 * 1024, // 50MB
      maxCacheAge: 7, // 7 days
    },
    conflictResolution: {
      defaultStrategy: "manual",
      autoResolveSimple: false,
    },
  });

  // 3. Set up event listeners
  syncManager.on(SyncEventType.SyncStarted, (event) => {
    console.log("🚀 Sync started:", {
      isFullSync: event.isFullSync,
      estimatedItems: event.estimatedItems,
    });
  });

  syncManager.on(SyncEventType.SyncProgress, (event) => {
    const { progress } = event;
    console.log("📊 Sync progress:", {
      itemsSynced: progress.items_synced,
      totalItems: progress.total_items,
      percentage: progress.progress
        ? `${progress.progress.toFixed(1)}%`
        : "unknown",
      currentBatch: progress.current_batch,
    });
  });

  syncManager.on(SyncEventType.SyncCompleted, (event) => {
    console.log("✅ Sync completed:", {
      totalItems: event.totalItems,
      duration: `${(event.duration / 1000).toFixed(1)}s`,
      conflictsResolved: event.conflictsResolved,
    });
  });

  syncManager.on(SyncEventType.SyncFailed, (event) => {
    console.error("❌ Sync failed:", {
      error: event.error.message,
      canRetry: event.canRetry,
      retryDelay: event.retryDelay,
    });
  });

  syncManager.on(SyncEventType.SyncConflict, (event) => {
    console.warn("⚠️ Sync conflict detected:", {
      conflictId: event.conflict.id,
      mediaBlobId: event.conflict.media_blob_id,
      type: event.conflict.type,
    });
  });

  syncManager.on(SyncEventType.ConnectionChanged, (event) => {
    console.log("🌐 Connection status:", {
      isOnline: event.isOnline,
      canSync: event.canSync,
    });
  });

  try {
    // 4. Initialize the sync manager
    console.log("Initializing sync manager...");
    await syncManager.initialize();

    // 5. Check current sync status
    const initialStatus = syncManager.getSyncStatus();
    console.log("Initial sync status:", {
      status: initialStatus.status,
      itemsSynced: initialStatus.items_synced,
      lastCursor: initialStatus.current_cursor,
    });

    // 6. Perform a sync operation
    console.log("Starting sync...");
    await syncManager.sync({
      force: true, // Force sync even if recently synced
      pageSize: 20,
      includeBinaryData: false,
    });

    // 7. Check final status
    const finalStatus = syncManager.getSyncStatus();
    console.log("Final sync status:", {
      status: finalStatus.status,
      itemsSynced: finalStatus.items_synced,
    });

    // 8. Check for any conflicts
    const conflicts = await syncManager.getConflicts();
    if (conflicts.length > 0) {
      console.log(`Found ${conflicts.length} conflicts to resolve`);
      for (const conflict of conflicts) {
        console.log(`- Conflict ${conflict.id}: ${conflict.type}`);

        // Example: auto-resolve by keeping server version
        await syncManager.resolveConflict(conflict.id, "keep_server");
        console.log(`  Resolved by keeping server version`);
      }
    }

    console.log("✅ Basic sync example completed successfully!");
  } catch (error) {
    console.error("❌ Sync example failed:", error);
  } finally {
    // 9. Clean up resources
    await syncManager.cleanup();
    console.log("🧹 Cleanup completed");
  }
}

/**
 * Example showing how to monitor sync progress in real-time
 */
export async function syncProgressMonitoringExample() {
  console.log("\n=== Sync Progress Monitoring Example ===");

  const apiClient = new ApiClient();
  const syncManager = createSyncManager(apiClient, "progress-monitor-client");

  // Track progress with more detailed logging
  let startTime: Date;
  let lastProgressTime: Date;

  syncManager.on(SyncEventType.SyncStarted, (event) => {
    startTime = event.timestamp;
    lastProgressTime = event.timestamp;
    console.log(`🚀 [${event.timestamp.toISOString()}] Sync started`);
    console.log(`   Type: ${event.isFullSync ? "Full" : "Incremental"} sync`);
    if (event.estimatedItems) {
      console.log(`   Estimated items: ${event.estimatedItems}`);
    }
  });

  syncManager.on(SyncEventType.SyncProgress, (event) => {
    const now = event.timestamp;
    const totalElapsed = now.getTime() - startTime.getTime();
    const stepElapsed = now.getTime() - lastProgressTime.getTime();

    console.log(`📊 [+${totalElapsed}ms] Progress update:`);
    console.log(`   Items synced: ${event.progress.items_synced}`);
    console.log(`   Batch: ${event.progress.current_batch}`);
    console.log(`   Step duration: ${stepElapsed}ms`);

    if (event.progress.progress) {
      const remaining = event.progress.estimated_remaining_seconds;
      console.log(`   Progress: ${event.progress.progress.toFixed(1)}%`);
      if (remaining) {
        console.log(`   ETA: ${remaining}s`);
      }
    }

    lastProgressTime = now;
  });

  syncManager.on(SyncEventType.SyncBatchCompleted, (event) => {
    console.log(`📦 Batch ${event.batchNumber} completed:`);
    console.log(`   Items in batch: ${event.itemsInBatch}`);
    console.log(`   Has more: ${event.hasMore}`);
    if (event.cursor) {
      console.log(`   Next cursor: ${event.cursor.substring(0, 20)}...`);
    }
  });

  try {
    await syncManager.initialize();
    await syncManager.sync({ force: true });
  } catch (error) {
    console.error("Progress monitoring example failed:", error);
  } finally {
    await syncManager.cleanup();
  }
}

/**
 * Example showing how to handle offline scenarios
 */
export async function offlineSyncExample() {
  console.log("\n=== Offline Sync Example ===");

  const apiClient = new ApiClient();
  const syncManager = createSyncManager(apiClient, "offline-client", {
    storage: {
      enabled: true,
      maxSize: 100 * 1024 * 1024, // 100MB for offline storage
      maxCacheAge: 30,
    },
  });

  // Monitor connection changes
  syncManager.on(SyncEventType.ConnectionChanged, async (event) => {
    console.log(
      `🌐 Connection changed: ${event.isOnline ? "ONLINE" : "OFFLINE"}`
    );

    if (event.isOnline && event.canSync) {
      console.log("📡 Back online - attempting to sync...");
      try {
        await syncManager.sync();
      } catch (error) {
        console.error("Failed to sync after coming online:", error);
      }
    }
  });

  try {
    await syncManager.initialize();

    // Get cached items (works offline)
    const cachedItems = await syncManager.getCachedItems({
      limit: 10,
      include_data: false,
    });
    console.log(`📦 Found ${cachedItems.length} cached items`);

    // Try to sync (may fail if offline)
    try {
      await syncManager.sync();
    } catch (error) {
      console.log("🔄 Sync failed (possibly offline), will retry when online");
    }
  } finally {
    await syncManager.cleanup();
  }
}

/**
 * Example showing conflict resolution strategies
 */
export async function conflictResolutionExample() {
  console.log("\n=== Conflict Resolution Example ===");

  const apiClient = new ApiClient();
  const syncManager = createSyncManager(apiClient, "conflict-client", {
    conflictResolution: {
      defaultStrategy: "manual",
      autoResolveSimple: false,
    },
  });

  // Handle conflicts
  syncManager.on(SyncEventType.SyncConflict, async (event) => {
    const { conflict } = event;
    console.log(`⚠️ Conflict detected: ${conflict.id}`);
    console.log(`   Media blob: ${conflict.media_blob_id}`);
    console.log(`   Type: ${conflict.type}`);
    console.log(`   Local updated: ${conflict.local_version.updated_at}`);
    console.log(`   Server updated: ${conflict.server_version.updated_at}`);

    // Example resolution strategy: keep the newer version
    const localTime = new Date(conflict.local_version.updated_at);
    const serverTime = new Date(conflict.server_version.updated_at);

    const resolution = serverTime > localTime ? "keep_server" : "keep_local";

    console.log(`   🔧 Auto-resolving: ${resolution}`);
    await syncManager.resolveConflict(conflict.id, resolution);
  });

  syncManager.on(SyncEventType.SyncConflictResolved, (event) => {
    console.log(
      `✅ Conflict resolved: ${event.conflictId} -> ${event.resolution}`
    );
  });

  try {
    await syncManager.initialize();
    await syncManager.sync();

    // Check for any remaining unresolved conflicts
    const remainingConflicts = await syncManager.getConflicts();
    console.log(`📊 Remaining conflicts: ${remainingConflicts.length}`);
  } finally {
    await syncManager.cleanup();
  }
}

/**
 * Example showing pause/resume functionality
 */
export async function pauseResumeSyncExample() {
  console.log("\n=== Pause/Resume Sync Example ===");

  const apiClient = new ApiClient();
  const syncManager = createSyncManager(apiClient, "pause-resume-client");

  let batchCount = 0;

  syncManager.on(SyncEventType.SyncBatchCompleted, (_event) => {
    batchCount++;
    console.log(`📦 Completed batch ${batchCount}`);

    // Pause after 2 batches
    if (batchCount === 2) {
      console.log("⏸️ Pausing sync after 2 batches...");
      syncManager.pauseSync();
    }
  });

  syncManager.on(SyncEventType.SyncPaused, (event) => {
    console.log(`⏸️ Sync paused: ${event.reason}`);
    console.log(`   Can resume: ${event.canResume}`);

    if (event.canResume) {
      // Resume after a short delay
      setTimeout(async () => {
        console.log("▶️ Resuming sync...");
        try {
          await syncManager.resumeSync();
        } catch (error) {
          console.error("Failed to resume sync:", error);
        }
      }, 2000);
    }
  });

  syncManager.on(SyncEventType.SyncResumed, (event) => {
    console.log(
      `▶️ Sync resumed from cursor: ${event.resumeFromCursor?.substring(0, 20)}...`
    );
  });

  try {
    await syncManager.initialize();
    await syncManager.sync({ force: true });
  } finally {
    await syncManager.cleanup();
  }
}

/**
 * Run all examples
 */
export async function runAllExamples() {
  console.log("🚀 Running all sync examples...\n");

  try {
    await basicSyncExample();
    await syncProgressMonitoringExample();
    await offlineSyncExample();
    await conflictResolutionExample();
    await pauseResumeSyncExample();

    console.log("\n✅ All examples completed successfully!");
  } catch (error) {
    console.error("\n❌ Examples failed:", error);
  }
}

// Export individual examples for selective testing
export const examples = {
  basic: basicSyncExample,
  progressMonitoring: syncProgressMonitoringExample,
  offline: offlineSyncExample,
  conflictResolution: conflictResolutionExample,
  pauseResume: pauseResumeSyncExample,
  all: runAllExamples,
};

// For direct execution: node -e "import('./example-usage.js').then(m => m.runAllExamples())"
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().catch(console.error);
}
