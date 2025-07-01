//! Simple demo example of sync functionality
//!
//! This demonstrates the core sync system functionality with mocked data,
//! showing how the state management, events, and sync flow work together
//! without needing a real server connection.

import {
  PersistentSyncState,
  SyncSessionState,
  SyncStatus,
  SyncEventType,
  createSyncEventSystem,
  MediaBlob,
  SyncProgress,
} from "../../sync-legacy/index.js";

/**
 * Mock sync data for demonstration
 */
const mockMediaBlobs: MediaBlob[] = [
  {
    id: "abc1234",
    sha256:
      "abc123def456789abcdef123456789abcdef123456789abcdef123456789abcdef",
    size: 1024,
    mime: "text/plain",
    source_client_id: "demo-client",
    local_path: null,
    metadata: { name: "document1.txt", tags: ["work"] },
    created_at: "2023-10-01T10:00:00Z",
    updated_at: "2023-10-01T10:00:00Z",
    deleted_at: null,
    data: null,
  },
  {
    id: "def5678",
    sha256:
      "def456abc789def123abc456def789abc123def456abc789def123abc456def789",
    size: 2048,
    mime: "image/jpeg",
    source_client_id: "demo-client",
    local_path: null,
    metadata: { name: "photo1.jpg", tags: ["personal"] },
    created_at: "2023-10-01T11:00:00Z",
    updated_at: "2023-10-01T11:00:00Z",
    deleted_at: null,
    data: null,
  },
  {
    id: "abc9def",
    sha256:
      "abc789def012abc345def678abc901def234abc567def890abc123def456abc789",
    size: 512,
    mime: "application/pdf",
    source_client_id: "demo-client",
    local_path: null,
    metadata: { name: "report.pdf", tags: ["work", "important"] },
    created_at: "2023-10-01T12:00:00Z",
    updated_at: "2023-10-01T12:00:00Z",
    deleted_at: null,
    data: null,
  },
];

/**
 * Demo class that simulates sync operations
 */
export class SyncDemo {
  private persistentState: PersistentSyncState;
  private sessionState: SyncSessionState | null = null;
  private eventSystem: ReturnType<typeof createSyncEventSystem>;

  constructor(clientId: string = "demo-client") {
    this.persistentState = PersistentSyncState.load(clientId);
    this.eventSystem = createSyncEventSystem(
      "demo-session-" + Date.now(),
      clientId
    );
  }

  /**
   * Add event listeners to see what's happening
   */
  setupEventListeners(): void {
    console.log("🎧 Setting up event listeners...\n");

    this.eventSystem.on(SyncEventType.SyncStarted, (event) => {
      console.log("🚀 Sync Started:", {
        sessionId: event.sessionId,
        isFullSync: event.isFullSync,
        estimatedItems: event.estimatedItems,
      });
    });

    this.eventSystem.on(SyncEventType.SyncProgress, (event) => {
      const { progress } = event;
      console.log("📊 Sync Progress:", {
        itemsSynced: progress.items_synced,
        totalItems: progress.total_items,
        percentage: progress.progress
          ? `${progress.progress.toFixed(1)}%`
          : "unknown",
        currentBatch: progress.current_batch,
      });
    });

    this.eventSystem.on(SyncEventType.ItemsReceived, (event) => {
      console.log("📦 Items Received:", {
        itemCount: event.items.length,
        batchNumber: event.batchNumber,
        totalReceived: event.totalReceived,
        itemIds: event.items.map((item) => item.id),
      });
    });

    this.eventSystem.on(SyncEventType.SyncBatchCompleted, (event) => {
      console.log("✅ Batch Completed:", {
        batchNumber: event.batchNumber,
        itemsInBatch: event.itemsInBatch,
        hasMore: event.hasMore,
        cursor: event.cursor?.substring(0, 20) + "...",
      });
    });

    this.eventSystem.on(SyncEventType.SyncCompleted, (event) => {
      console.log("🎉 Sync Completed:", {
        totalItems: event.totalItems,
        duration: `${(event.duration / 1000).toFixed(1)}s`,
        conflictsResolved: event.conflictsResolved,
      });
    });

    this.eventSystem.on(SyncEventType.SyncFailed, (event) => {
      console.error("❌ Sync Failed:", {
        error: event.error.message,
        canRetry: event.canRetry,
        retryDelay: event.retryDelay,
      });
    });
  }

  /**
   * Simulate a sync operation with mock data
   */
  async performMockSync(): Promise<void> {
    console.log("🔄 Starting mock sync operation...\n");

    const sessionId = "demo-session-" + Date.now();
    this.sessionState = new SyncSessionState(sessionId, this.persistentState);

    // Emit sync started event
    const isFullSync = this.persistentState.status === SyncStatus.Never;
    this.eventSystem.emit(
      this.eventSystem.builder.syncStarted(isFullSync, mockMediaBlobs.length)
    );

    try {
      // Simulate processing batches
      const batchSize = 2;
      let totalProcessed = 0;

      for (let i = 0; i < mockMediaBlobs.length; i += batchSize) {
        const batch = mockMediaBlobs.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const hasMore = i + batchSize < mockMediaBlobs.length;

        // Emit items received
        totalProcessed += batch.length;
        this.eventSystem.emit(
          this.eventSystem.builder.itemsReceived(
            batch,
            batchNumber,
            totalProcessed
          )
        );

        // Simulate processing delay
        await this.delay(100);

        // Process each item in the batch
        for (const item of batch) {
          await this.processMockItem(item);
        }

        // Update session state
        this.sessionState.currentBatch = batchNumber;
        this.sessionState.itemsInCurrentSession = totalProcessed;

        // Emit progress
        const progress: SyncProgress = {
          status: SyncStatus.InProgress,
          items_synced: totalProcessed,
          total_items: mockMediaBlobs.length,
          progress: (totalProcessed / mockMediaBlobs.length) * 100,
          current_batch: batchNumber,
          total_batches: Math.ceil(mockMediaBlobs.length / batchSize),
        };

        this.eventSystem.emit(this.eventSystem.builder.syncProgress(progress));

        // Emit batch completed
        const cursor = hasMore ? `cursor-batch-${batchNumber + 1}` : undefined;
        this.eventSystem.emit(
          this.eventSystem.builder.syncBatchCompleted(
            batchNumber,
            batch.length,
            cursor,
            hasMore
          )
        );

        // Simulate network delay between batches
        if (hasMore) {
          await this.delay(200);
        }
      }

      // Update persistent state
      this.persistentState.updateAfterSync(new Date(), totalProcessed);

      // Emit completion
      const duration = this.sessionState.getSessionDuration();
      this.eventSystem.emit(
        this.eventSystem.builder.syncCompleted(totalProcessed, duration, 0)
      );

      console.log("\n✨ Mock sync completed successfully!");
    } catch (error) {
      const syncError = {
        type: "demo_error",
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
        recoverable: true,
      };

      this.persistentState.markFailed();
      this.eventSystem.emit(
        this.eventSystem.builder.syncFailed(syncError, true, 5000)
      );

      console.error("\n💥 Mock sync failed:", error);
    }
  }

  /**
   * Process a single mock item
   */
  private async processMockItem(item: MediaBlob): Promise<void> {
    // Simulate processing time based on file size
    const processingTime = Math.min(item.size ? item.size / 10000 : 50, 200);
    await this.delay(processingTime);

    console.log(
      `   📄 Processed: ${item.metadata?.name || item.id} (${item.mime})`
    );
  }

  /**
   * Show current sync state
   */
  showSyncState(): void {
    console.log("\n📋 Current Sync State:");
    console.log("  Client ID:", this.persistentState.clientId);
    console.log("  Status:", this.persistentState.status);
    console.log(
      "  Last Sync:",
      this.persistentState.lastSyncTime.toISOString()
    );
    console.log("  Items Synced:", this.persistentState.totalItemsSynced);
    console.log("  Last Cursor:", this.persistentState.lastCursor || "none");

    if (this.sessionState) {
      console.log("  Session Active:", true);
      console.log("  Current Batch:", this.sessionState.currentBatch);
      console.log("  Session Items:", this.sessionState.itemsInCurrentSession);
      console.log(
        "  Session Duration:",
        `${this.sessionState.getSessionDuration()}ms`
      );
    } else {
      console.log("  Session Active:", false);
    }
  }

  /**
   * Demonstrate state persistence
   */
  demonstrateStatePersistence(): void {
    console.log("\n💾 Demonstrating State Persistence:");

    // Show current state
    console.log("Before save:");
    this.showSyncState();

    // Save state
    this.persistentState.save();
    console.log("✅ State saved to localStorage");

    // Create new instance and load
    const newState = PersistentSyncState.load(this.persistentState.clientId);
    console.log("\nAfter loading new instance:");
    console.log("  Status:", newState.status);
    console.log("  Items Synced:", newState.totalItemsSynced);
    console.log("  Last Sync:", newState.lastSyncTime.toISOString());
  }

  /**
   * Reset sync state for testing
   */
  reset(): void {
    console.log("\n🔄 Resetting sync state...");
    this.persistentState.reset();
    this.sessionState = null;
    console.log("✅ State reset complete");
  }

  /**
   * Get event history for analysis
   */
  getEventHistory(): readonly any[] {
    return this.eventSystem.emitter.getEventHistory();
  }

  /**
   * Utility delay function
   */
  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Run a complete demo of sync functionality
 */
export async function runSyncDemo(): Promise<void> {
  console.log("🚀 Starting Sync System Demo\n");
  console.log("=".repeat(50));

  const demo = new SyncDemo("demo-client-123");

  // Setup event listeners
  demo.setupEventListeners();

  // Show initial state
  console.log("\n📊 Initial State:");
  demo.showSyncState();

  // Perform mock sync
  console.log("\n" + "=".repeat(50));
  await demo.performMockSync();

  // Show final state
  console.log("\n📊 Final State:");
  demo.showSyncState();

  // Demonstrate persistence
  console.log("\n" + "=".repeat(50));
  demo.demonstrateStatePersistence();

  // Show event history
  console.log("\n" + "=".repeat(50));
  console.log("📚 Event History:");
  const events = demo.getEventHistory();
  events.forEach((event, index) => {
    console.log(
      `  ${index + 1}. ${event.type} at ${event.timestamp.toISOString()}`
    );
  });

  console.log("\n✨ Demo completed successfully!");
  console.log("=".repeat(50));
}

/**
 * Interactive demo with multiple scenarios
 */
export async function runInteractiveDemo(): Promise<void> {
  console.log("🎮 Interactive Sync Demo\n");

  const demo = new SyncDemo("interactive-client");
  demo.setupEventListeners();

  // Scenario 1: First sync
  console.log("\n🎬 Scenario 1: First-time sync");
  console.log("-".repeat(30));
  await demo.performMockSync();

  await demo.delay(1000);

  // Scenario 2: Incremental sync
  console.log("\n🎬 Scenario 2: Incremental sync (no changes)");
  console.log("-".repeat(30));
  // Reset session but keep persistent state
  await demo.performMockSync();

  await demo.delay(1000);

  // Scenario 3: Reset and sync again
  console.log("\n🎬 Scenario 3: Reset and full sync");
  console.log("-".repeat(30));
  demo.reset();
  await demo.performMockSync();

  console.log("\n🎉 Interactive demo complete!");
}

// Example usage functions
export const demoExamples = {
  basic: runSyncDemo,
  interactive: runInteractiveDemo,
  createDemo: (clientId: string) => new SyncDemo(clientId),
};

// Auto-run demo if this file is executed directly
if (typeof window !== "undefined" && (window as any).runSyncDemo) {
  (window as any).runSyncDemo = runSyncDemo;
  (window as any).runInteractiveDemo = runInteractiveDemo;
  (window as any).SyncDemo = SyncDemo;
}
