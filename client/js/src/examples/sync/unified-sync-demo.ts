//! Unified Sync System Demo
//!
//! This demo showcases the new unified sync system in action. It demonstrates
//! the clean, simplified API for syncing multiple domains (music, photos, docs)
//! with a single interface, automatic progress tracking, and efficient storage.

import {
  createConfiguredSyncManager,
  setupUnifiedSync,
  SyncStatus,
  SyncEventType,
  type UnifiedSyncManager,
  type SyncResult,
  type SyncProgress,
  type AnySyncEvent,
} from "../../sync/index.js";

import { WebSocketClient } from "../../lib/websocket-client.js";
import { ApiClient } from "../../lib/api-client.js";

/**
 * Demo configuration
 */
interface DemoConfig {
  apiBaseUrl: string;
  websocketUrl: string;
  clientId: string;
  authToken?: string;
  enabledDomains: Array<"music" | "photos" | "documents" | "videos">;
}

/**
 * Default demo configuration
 */
const DEFAULT_CONFIG: DemoConfig = {
  apiBaseUrl: "http://localhost:8080",
  websocketUrl: "ws://localhost:8080/ws",
  clientId: `demo-client-${Date.now()}`,
  enabledDomains: ["music", "photos"],
};

/**
 * Demo class showcasing the unified sync system
 */
export class UnifiedSyncDemo {
  private syncManager: UnifiedSyncManager | null = null;
  private wsClient: WebSocketClient | null = null;
  private apiClient: ApiClient | null = null;
  private config: DemoConfig;
  private eventLog: string[] = [];

  constructor(config: Partial<DemoConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the demo
   */
  async initialize(): Promise<void> {
    console.log("🚀 Initializing Unified Sync Demo...");
    this.addLog("🚀 Initializing Unified Sync Demo...");

    try {
      // Create WebSocket client
      this.wsClient = new WebSocketClient({
        url: this.config.websocketUrl,
        autoReconnect: true,
        reconnectDelay: 1000,
      });

      // Create API client
      this.apiClient = new ApiClient({
        baseUrl: this.config.apiBaseUrl,
        defaultHeaders: {
          ...(this.config.authToken && {
            Authorization: `Bearer ${this.config.authToken}`,
          }),
        },
      });

      // Create unified sync manager using the simple setup function
      this.syncManager = await setupUnifiedSync(this.wsClient, this.apiClient, {
        apiBaseUrl: this.config.apiBaseUrl,
        clientId: this.config.clientId,
        authToken: this.config.authToken,
      });

      // Set up event listeners
      this.setupEventListeners();

      this.addLog("✅ Unified Sync Demo initialized successfully!");
      console.log("✅ Unified Sync Demo initialized successfully!");
    } catch (error) {
      const errorMessage = `❌ Failed to initialize demo: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.addLog(errorMessage);
      console.error(errorMessage);
      throw error;
    }
  }

  /**
   * Demonstrate syncing all domains
   */
  async demoSyncAll(): Promise<SyncResult> {
    if (!this.syncManager) throw new Error("Demo not initialized");

    console.log("🔄 Demo: Syncing all domains...");
    this.addLog("🔄 Demo: Syncing all domains...");

    try {
      const result = await this.syncManager.syncAll({
        domains: this.config.enabledDomains,
        includeBinaryData: true,
        priorityOrder: ["music", "photos", "documents", "videos"],
      });

      this.addLog(
        `✅ Sync all completed: ${result.itemsSynced} items in ${result.duration}ms`
      );
      console.log("✅ Sync all completed:", result);

      return result;
    } catch (error) {
      const errorMessage = `❌ Sync all failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.addLog(errorMessage);
      console.error(errorMessage);
      throw error;
    }
  }

  /**
   * Demonstrate syncing a specific domain
   */
  async demoSyncDomain(
    domain: "music" | "photos" | "documents" | "videos"
  ): Promise<SyncResult> {
    if (!this.syncManager) throw new Error("Demo not initialized");

    console.log(`🎵 Demo: Syncing ${domain} domain...`);
    this.addLog(`🎵 Demo: Syncing ${domain} domain...`);

    try {
      const result = await this.syncManager.syncDomain(domain, {
        includeBinaryData: true,
        pageSize: 25,
      });

      this.addLog(
        `✅ ${domain} sync completed: ${result.itemsSynced} items in ${result.duration}ms`
      );
      console.log(`✅ ${domain} sync completed:`, result);

      return result;
    } catch (error) {
      const errorMessage = `❌ ${domain} sync failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.addLog(errorMessage);
      console.error(errorMessage);
      throw error;
    }
  }

  /**
   * Demonstrate getting blob URLs
   */
  async demoBlobUrls(): Promise<void> {
    if (!this.syncManager) throw new Error("Demo not initialized");

    console.log("🖼️ Demo: Getting blob URLs...");
    this.addLog("🖼️ Demo: Getting blob URLs...");

    try {
      // Example blob IDs (these would come from actual sync data)
      const exampleBlobIds = [
        "blob-123-audio",
        "blob-456-image",
        "blob-789-document",
      ];

      for (const blobId of exampleBlobIds) {
        const blobUrl = await this.syncManager.getBlobUrl(blobId);
        if (blobUrl) {
          this.addLog(`📦 Blob URL for ${blobId}: ${blobUrl}`);
          console.log(`📦 Blob URL for ${blobId}:`, blobUrl);
        } else {
          this.addLog(`❌ No blob URL available for ${blobId}`);
          console.log(`❌ No blob URL available for ${blobId}`);
        }
      }
    } catch (error) {
      const errorMessage = `❌ Blob URL demo failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.addLog(errorMessage);
      console.error(errorMessage);
    }
  }

  /**
   * Demonstrate auto-sync features
   */
  async demoAutoSync(): Promise<void> {
    if (!this.syncManager) throw new Error("Demo not initialized");

    console.log("🔄 Demo: Auto-sync features...");
    this.addLog("🔄 Demo: Enabling auto-sync...");

    try {
      // Enable auto-sync
      this.syncManager.enableAutoSync(true);
      this.addLog("✅ Auto-sync enabled");

      // Wait a moment, then disable
      setTimeout(() => {
        if (this.syncManager) {
          this.syncManager.enableAutoSync(false);
          this.addLog("⏸️ Auto-sync disabled");
          console.log("⏸️ Auto-sync disabled");
        }
      }, 5000);
    } catch (error) {
      const errorMessage = `❌ Auto-sync demo failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.addLog(errorMessage);
      console.error(errorMessage);
    }
  }

  /**
   * Show current sync status
   */
  showStatus(): void {
    if (!this.syncManager) {
      console.log("❌ Demo not initialized");
      return;
    }

    const status = this.syncManager.getStatus();
    const progress = this.syncManager.getProgress();

    console.log("📊 Current Sync Status:");
    for (const [domain, domainStatus] of Object.entries(status)) {
      const domainProgress = progress[domain as keyof typeof progress];
      console.log(
        `  ${domain}: ${domainStatus} (${domainProgress.progress}% - ${domainProgress.itemsProcessed}/${domainProgress.totalItems})`
      );
      this.addLog(
        `📊 ${domain}: ${domainStatus} (${domainProgress.progress}%)`
      );
    }
  }

  /**
   * Get the event log for display
   */
  getEventLog(): string[] {
    return [...this.eventLog];
  }

  /**
   * Clear the event log
   */
  clearEventLog(): void {
    this.eventLog = [];
  }

  /**
   * Cleanup demo resources
   */
  async cleanup(): Promise<void> {
    console.log("🧹 Cleaning up Unified Sync Demo...");
    this.addLog("🧹 Cleaning up demo...");

    try {
      if (this.syncManager) {
        await this.syncManager.destroy();
        this.syncManager = null;
      }

      if (this.wsClient) {
        await this.wsClient.disconnect();
        this.wsClient = null;
      }

      this.addLog("✅ Demo cleanup completed");
      console.log("✅ Demo cleanup completed");
    } catch (error) {
      const errorMessage = `❌ Cleanup failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.addLog(errorMessage);
      console.error(errorMessage);
    }
  }

  // Private helper methods

  private setupEventListeners(): void {
    if (!this.syncManager) return;

    // Listen for sync events
    this.syncManager.on(SyncEventType.Started, (event: AnySyncEvent) => {
      if (event.type === SyncEventType.Started) {
        this.addLog(
          `🔄 Sync started for ${event.domain} (${
            event.isFullSync ? "full" : "incremental"
          })`
        );
      }
    });

    this.syncManager.on(SyncEventType.Progress, (event: AnySyncEvent) => {
      if (event.type === SyncEventType.Progress) {
        const progress = event.progress;
        this.addLog(
          `📈 ${event.domain}: ${Math.round(progress.progress)}% (${
            progress.itemsProcessed
          }/${progress.totalItems})`
        );
      }
    });

    this.syncManager.on(SyncEventType.DomainCompleted, (event: AnySyncEvent) => {
      if (event.type === SyncEventType.DomainCompleted) {
        this.addLog(
          `✅ ${event.result.domain} completed: ${event.result.itemsSynced} items`
        );
      }
    });

    this.syncManager.on(SyncEventType.AllCompleted, (event: AnySyncEvent) => {
      if (event.type === SyncEventType.AllCompleted) {
        this.addLog(
          `🎉 All domains completed: ${event.result.itemsSynced} total items`
        );
      }
    });

    this.syncManager.on(SyncEventType.Failed, (event: AnySyncEvent) => {
      if (event.type === SyncEventType.Failed) {
        this.addLog(`❌ ${event.domain} sync failed: ${event.error.message}`);
      }
    });

    this.syncManager.on(SyncEventType.AutoSyncTriggered, (event: AnySyncEvent) => {
      if (event.type === SyncEventType.AutoSyncTriggered) {
        this.addLog(
          `🔔 Auto-sync triggered for ${event.domain} (${event.trigger})`
        );
      }
    });

    this.syncManager.on(SyncEventType.ConnectionChanged, (event: AnySyncEvent) => {
      if (event.type === SyncEventType.ConnectionChanged) {
        this.addLog(
          `📡 Connection ${event.isOnline ? "online" : "offline"} (${
            event.connectionType
          })`
        );
      }
    });
  }

  private addLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    this.eventLog.push(logEntry);

    // Keep only last 100 log entries
    if (this.eventLog.length > 100) {
      this.eventLog = this.eventLog.slice(-100);
    }
  }
}

/**
 * Run a complete demo showing all features
 */
export async function runCompleteDemo(
  config: Partial<DemoConfig> = {}
): Promise<void> {
  console.log("🎬 Starting complete Unified Sync Demo...");

  const demo = new UnifiedSyncDemo(config);

  try {
    // Initialize
    await demo.initialize();

    // Show initial status
    demo.showStatus();

    // Demo sync operations
    await demo.demoSyncDomain("music");
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Brief pause

    await demo.demoSyncDomain("photos");
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Brief pause

    await demo.demoSyncAll();
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Brief pause

    // Demo other features
    await demo.demoBlobUrls();
    await demo.demoAutoSync();

    // Show final status
    demo.showStatus();

    console.log("🎉 Complete demo finished successfully!");
    console.log("📝 Event log:", demo.getEventLog());

    // Cleanup after a delay
    setTimeout(async () => {
      await demo.cleanup();
    }, 2000);
  } catch (error) {
    console.error("❌ Demo failed:", error);
    await demo.cleanup();
    throw error;
  }
}

/**
 * Simple demo for quick testing
 */
export async function runQuickDemo(): Promise<void> {
  console.log("⚡ Quick Unified Sync Demo...");

  const demo = new UnifiedSyncDemo({
    enabledDomains: ["music"], // Just music for quick demo
  });

  try {
    await demo.initialize();
    await demo.demoSyncDomain("music");
    demo.showStatus();
    console.log("✅ Quick demo completed!");
  } catch (error) {
    console.error("❌ Quick demo failed:", error);
  } finally {
    await demo.cleanup();
  }
}

// Auto-run demo if this file is executed directly
if (typeof window !== "undefined" && window.location?.search?.includes("demo=unified")) {
  runCompleteDemo().catch(console.error);
}
