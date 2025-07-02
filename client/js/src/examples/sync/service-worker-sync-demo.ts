//! Service Worker Sync Demo
//!
//! This demo showcases the service worker background sync capabilities of the
//! unified sync system. It demonstrates background sync registration, periodic
//! sync, resource-aware scheduling, and coordination between main thread and
//! service worker.

import {
  createConfiguredSyncManager,
  createServiceWorkerSyncManager,
  isServiceWorkerSyncSupported,
  isPeriodicBackgroundSyncSupported,
  type UnifiedSyncManager,
  type ServiceWorkerSyncManager,
  type BackgroundSyncOperation,
  type ServiceWorkerCapabilities,
  type SystemResourceStatus,
  type BackgroundSyncQueueState,
  ServiceWorkerMessageType,
} from "../../sync/index.js";

import { WebSocketClient } from "../../lib/websocket-client.js";
import { ApiClient } from "../../lib/api-client.js";

/**
 * Service worker sync demo configuration
 */
interface ServiceWorkerDemoConfig {
  apiBaseUrl: string;
  websocketUrl: string;
  clientId: string;
  authToken?: string;
  enabledDomains: Array<"music" | "photos" | "documents" | "videos">;
  backgroundSyncEnabled: boolean;
  periodicSyncEnabled: boolean;
}

/**
 * Default demo configuration
 */
const DEFAULT_SW_CONFIG: ServiceWorkerDemoConfig = {
  apiBaseUrl: "http://localhost:8080",
  websocketUrl: "ws://localhost:8080/ws",
  clientId: `sw-demo-client-${Date.now()}`,
  enabledDomains: ["music", "photos"],
  backgroundSyncEnabled: true,
  periodicSyncEnabled: true,
};

/**
 * Service Worker Sync Demo Class
 */
export class ServiceWorkerSyncDemo {
  private syncManager: UnifiedSyncManager | null = null;
  private serviceWorkerSyncManager: ServiceWorkerSyncManager | null = null;
  private wsClient: WebSocketClient | null = null;
  private apiClient: ApiClient | null = null;
  private config: ServiceWorkerDemoConfig;
  private eventLog: string[] = [];
  private capabilities: ServiceWorkerCapabilities | null = null;

  constructor(config: Partial<ServiceWorkerDemoConfig> = {}) {
    this.config = { ...DEFAULT_SW_CONFIG, ...config };
  }

  /**
   * Initialize the service worker sync demo
   */
  async initialize(): Promise<void> {
    console.log("🔧 Initializing Service Worker Sync Demo...");
    this.addLog("🔧 Initializing Service Worker Sync Demo...");

    try {
      // Check service worker support
      this.capabilities = await this.checkCapabilities();
      this.logCapabilities();

      if (!this.capabilities.serviceWorker) {
        throw new Error("Service Workers not supported in this browser");
      }

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

      // Create unified sync manager with service worker support
      this.syncManager = await createConfiguredSyncManager(
        this.wsClient,
        this.apiClient,
        {
          apiBaseUrl: this.config.apiBaseUrl,
          websocketUrl: this.config.websocketUrl,
          clientId: this.config.clientId,
          authToken: this.config.authToken,
          enabledDomains: this.config.enabledDomains,
          serviceWorkerConfig: {
            enabled: this.config.backgroundSyncEnabled,
            backgroundSyncInterval: 30,
            maxBackgroundSyncDuration: 300000, // 5 minutes
            backgroundDomains: this.config.enabledDomains,
            enablePeriodicSync: this.config.periodicSyncEnabled,
            periodicSyncInterval: 30, // 30 minutes
          },
        }
      );

      // Get service worker sync manager
      this.serviceWorkerSyncManager = await this.syncManager.getServiceWorkerSyncManager();

      if (this.serviceWorkerSyncManager) {
        this.setupServiceWorkerEventListeners();
        this.addLog("✅ Service Worker Sync Manager initialized");
      } else {
        this.addLog("⚠️ Service Worker Sync Manager not available");
      }

      this.addLog("✅ Service Worker Sync Demo initialized successfully!");
      console.log("✅ Service Worker Sync Demo initialized successfully!");
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
   * Demo: Register background sync operations
   */
  async demoBackgroundSync(): Promise<void> {
    if (!this.serviceWorkerSyncManager) {
      throw new Error("Service Worker Sync Manager not available");
    }

    console.log("📱 Demo: Registering background sync operations...");
    this.addLog("📱 Demo: Registering background sync operations...");

    try {
      const operations: Array<{
        domain: "music" | "photos" | "documents" | "videos";
        priority: number;
        description: string;
      }> = [
        { domain: "music", priority: 7, description: "High priority music sync" },
        { domain: "photos", priority: 5, description: "Medium priority photo sync" },
        { domain: "documents", priority: 3, description: "Low priority document sync" },
      ];

      const operationIds: string[] = [];

      for (const op of operations) {
        if (this.config.enabledDomains.includes(op.domain)) {
          const operationId = await this.serviceWorkerSyncManager.registerBackgroundSync({
            type: "background-sync",
            domain: op.domain,
            options: {
              includeBinaryData: op.domain === "photos", // Include binary for photos
              pageSize: 25,
              maxItems: 100,
            },
            priority: op.priority,
            maxRetries: 3,
            retryDelay: 2000,
            metadata: { description: op.description },
          });

          operationIds.push(operationId);
          this.addLog(`📝 Registered ${op.domain} sync: ${operationId} (priority: ${op.priority})`);
        }
      }

      // Wait a moment, then check status
      setTimeout(async () => {
        await this.showQueueStatus();
      }, 2000);

      this.addLog(`✅ Registered ${operationIds.length} background sync operations`);
      console.log("✅ Background sync operations registered");

    } catch (error) {
      const errorMessage = `❌ Background sync registration failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.addLog(errorMessage);
      console.error(errorMessage);
      throw error;
    }
  }

  /**
   * Demo: Show system resource status
   */
  async demoResourceStatus(): Promise<void> {
    if (!this.serviceWorkerSyncManager) {
      throw new Error("Service Worker Sync Manager not available");
    }

    console.log("🔋 Demo: Checking system resource status...");
    this.addLog("🔋 Demo: Checking system resource status...");

    try {
      const resourceStatus = await this.serviceWorkerSyncManager.getResourceStatus();
      this.logResourceStatus(resourceStatus);

      console.log("✅ Resource status checked");
    } catch (error) {
      const errorMessage = `❌ Resource status check failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.addLog(errorMessage);
      console.error(errorMessage);
    }
  }

  /**
   * Demo: Show background sync queue status
   */
  async showQueueStatus(): Promise<void> {
    if (!this.serviceWorkerSyncManager) {
      throw new Error("Service Worker Sync Manager not available");
    }

    console.log("📊 Demo: Checking background sync queue status...");
    this.addLog("📊 Demo: Checking background sync queue status...");

    try {
      const queueState = await this.serviceWorkerSyncManager.getQueueState();
      this.logQueueState(queueState);

      console.log("✅ Queue status retrieved");
    } catch (error) {
      const errorMessage = `❌ Queue status check failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.addLog(errorMessage);
      console.error(errorMessage);
    }
  }

  /**
   * Demo: Test periodic sync registration
   */
  async demoPeriodicSync(): Promise<void> {
    if (!this.serviceWorkerSyncManager) {
      throw new Error("Service Worker Sync Manager not available");
    }

    if (!this.capabilities?.periodicBackgroundSync) {
      this.addLog("⚠️ Periodic background sync not supported");
      return;
    }

    console.log("⏰ Demo: Setting up periodic sync...");
    this.addLog("⏰ Demo: Setting up periodic sync...");

    try {
      await this.serviceWorkerSyncManager.registerPeriodicSync({
        tag: "demo-periodic-sync",
        minInterval: 60000, // 1 minute for demo
      });

      this.addLog("✅ Periodic sync registered (1 minute interval)");
      console.log("✅ Periodic sync registered");

      // Set up cleanup
      setTimeout(async () => {
        if (this.serviceWorkerSyncManager) {
          await this.serviceWorkerSyncManager.unregisterPeriodicSync("demo-periodic-sync");
          this.addLog("🧹 Periodic sync unregistered");
        }
      }, 10000); // Cleanup after 10 seconds

    } catch (error) {
      const errorMessage = `❌ Periodic sync setup failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.addLog(errorMessage);
      console.error(errorMessage);
    }
  }

  /**
   * Demo: Cancel a background sync operation
   */
  async demoCancelSync(): Promise<void> {
    if (!this.serviceWorkerSyncManager) {
      throw new Error("Service Worker Sync Manager not available");
    }

    console.log("🚫 Demo: Cancelling background sync operations...");
    this.addLog("🚫 Demo: Testing sync cancellation...");

    try {
      // Register an operation to cancel
      const operationId = await this.serviceWorkerSyncManager.registerBackgroundSync({
        type: "background-sync",
        domain: "documents",
        options: { pageSize: 10 },
        priority: 1,
        maxRetries: 1,
        retryDelay: 1000,
        metadata: { description: "Operation to be cancelled" },
      });

      this.addLog(`📝 Registered operation for cancellation: ${operationId}`);

      // Wait a moment, then cancel
      setTimeout(async () => {
        if (this.serviceWorkerSyncManager) {
          await this.serviceWorkerSyncManager.cancelBackgroundSync(operationId);
          this.addLog(`🚫 Cancelled operation: ${operationId}`);
        }
      }, 1000);

      console.log("✅ Cancellation demo completed");
    } catch (error) {
      const errorMessage = `❌ Cancellation demo failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.addLog(errorMessage);
      console.error(errorMessage);
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
   * Get service worker capabilities
   */
  getCapabilities(): ServiceWorkerCapabilities | null {
    return this.capabilities;
  }

  /**
   * Cleanup demo resources
   */
  async cleanup(): Promise<void> {
    console.log("🧹 Cleaning up Service Worker Sync Demo...");
    this.addLog("🧹 Cleaning up demo...");

    try {
      if (this.serviceWorkerSyncManager) {
        await this.serviceWorkerSyncManager.destroy();
        this.serviceWorkerSyncManager = null;
      }

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

  private async checkCapabilities(): Promise<ServiceWorkerCapabilities> {
    const capabilities: ServiceWorkerCapabilities = {
      serviceWorker: 'serviceWorker' in navigator,
      backgroundSync: false,
      periodicBackgroundSync: false,
      pushAPI: 'PushManager' in window,
      notifications: 'Notification' in window,
    };

    if (capabilities.serviceWorker) {
      capabilities.backgroundSync = isServiceWorkerSyncSupported();
      capabilities.periodicBackgroundSync = isPeriodicBackgroundSyncSupported();
    }

    return capabilities;
  }

  private logCapabilities(): void {
    if (!this.capabilities) return;

    this.addLog("🔍 Service Worker Capabilities:");
    this.addLog(`  • Service Worker: ${this.capabilities.serviceWorker ? "✅" : "❌"}`);
    this.addLog(`  • Background Sync: ${this.capabilities.backgroundSync ? "✅" : "❌"}`);
    this.addLog(`  • Periodic Sync: ${this.capabilities.periodicBackgroundSync ? "✅" : "❌"}`);
    this.addLog(`  • Push API: ${this.capabilities.pushAPI ? "✅" : "❌"}`);
    this.addLog(`  • Notifications: ${this.capabilities.notifications ? "✅" : "❌"}`);
  }

  private logResourceStatus(status: SystemResourceStatus): void {
    this.addLog("🔋 System Resource Status:");
    this.addLog(`  • Network: ${status.network.online ? "Online" : "Offline"} (${status.network.type})`);

    if (status.network.effectiveType) {
      this.addLog(`  • Connection: ${status.network.effectiveType}`);
    }

    if (status.network.downlink) {
      this.addLog(`  • Bandwidth: ${status.network.downlink} Mbps`);
    }

    if (status.network.saveData) {
      this.addLog(`  • Data Saver: Enabled`);
    }

    if (status.battery) {
      this.addLog(`  • Battery: ${Math.round(status.battery.level * 100)}% ${status.battery.charging ? "(Charging)" : "(Not charging)"}`);
    }

    if (status.memory) {
      const usedMB = Math.round(status.memory.usedJSHeapSize / 1024 / 1024);
      const totalMB = Math.round(status.memory.totalJSHeapSize / 1024 / 1024);
      this.addLog(`  • Memory: ${usedMB}MB / ${totalMB}MB`);
    }
  }

  private logQueueState(state: BackgroundSyncQueueState): void {
    this.addLog("📊 Background Sync Queue Status:");
    this.addLog(`  • Total Operations: ${state.stats.totalOperations}`);
    this.addLog(`  • Active: ${state.activeOperations.length}`);
    this.addLog(`  • Pending: ${state.pendingOperations.length}`);
    this.addLog(`  • Failed: ${state.failedOperations.length}`);
    this.addLog(`  • Completed: ${state.stats.completedOperations}`);
    this.addLog(`  • Success Rate: ${Math.round(state.stats.successRate * 100)}%`);

    if (state.stats.averageCompletionTime > 0) {
      this.addLog(`  • Avg Completion: ${Math.round(state.stats.averageCompletionTime / 1000)}s`);
    }

    // Log recent operations
    const recentOps = state.operations.slice(-3);
    if (recentOps.length > 0) {
      this.addLog("  📋 Recent Operations:");
      recentOps.forEach(op => {
        const duration = op.completedAt && op.startedAt
          ? Math.round((op.completedAt.getTime() - op.startedAt.getTime()) / 1000)
          : "N/A";
        this.addLog(`    • ${op.domain} (${op.status}) - ${duration}s`);
      });
    }
  }

  private setupServiceWorkerEventListeners(): void {
    if (!this.serviceWorkerSyncManager) return;

    // Listen for sync events
    this.serviceWorkerSyncManager.addEventListener(
      ServiceWorkerMessageType.SyncStarted,
      (message) => {
        this.addLog(`🔄 Background sync started: ${message.domain} (${message.operationId})`);
      }
    );

    this.serviceWorkerSyncManager.addEventListener(
      ServiceWorkerMessageType.SyncProgress,
      (message) => {
        this.addLog(`📈 Background sync progress: ${message.domain} ${message.progress}% (${message.itemsProcessed}/${message.totalItems})`);
      }
    );

    this.serviceWorkerSyncManager.addEventListener(
      ServiceWorkerMessageType.SyncCompleted,
      (message) => {
        this.addLog(`✅ Background sync completed: ${message.result.domain} - ${message.result.itemsSynced} items`);
      }
    );

    this.serviceWorkerSyncManager.addEventListener(
      ServiceWorkerMessageType.SyncFailed,
      (message) => {
        this.addLog(`❌ Background sync failed: ${message.error.message} (retry: ${message.willRetry})`);
      }
    );

    this.serviceWorkerSyncManager.addEventListener(
      ServiceWorkerMessageType.SyncCancelled,
      (message) => {
        this.addLog(`🚫 Background sync cancelled: ${message.operationId} - ${message.reason}`);
      }
    );
  }

  private addLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    this.eventLog.push(logEntry);

    // Keep only last 150 log entries
    if (this.eventLog.length > 150) {
      this.eventLog = this.eventLog.slice(-150);
    }
  }
}

/**
 * Run a complete service worker sync demo
 */
export async function runCompleteServiceWorkerDemo(
  config: Partial<ServiceWorkerDemoConfig> = {}
): Promise<void> {
  console.log("🚀 Starting Complete Service Worker Sync Demo...");

  const demo = new ServiceWorkerSyncDemo(config);

  try {
    // Initialize
    await demo.initialize();

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Demo various features
    await demo.demoResourceStatus();
    await new Promise(resolve => setTimeout(resolve, 1000));

    await demo.demoBackgroundSync();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await demo.demoPeriodicSync();
    await new Promise(resolve => setTimeout(resolve, 1000));

    await demo.demoCancelSync();
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Final status check
    await demo.showQueueStatus();

    console.log("🎉 Complete service worker demo finished successfully!");
    console.log("📝 Event log:", demo.getEventLog());

    // Cleanup after delay
    setTimeout(async () => {
      await demo.cleanup();
    }, 3000);

  } catch (error) {
    console.error("❌ Service worker demo failed:", error);
    await demo.cleanup();
    throw error;
  }
}

/**
 * Run a quick service worker capability check
 */
export async function runServiceWorkerCapabilityCheck(): Promise<ServiceWorkerCapabilities> {
  console.log("🔍 Checking Service Worker Capabilities...");

  const demo = new ServiceWorkerSyncDemo();

  try {
    await demo.initialize();
    const capabilities = demo.getCapabilities();

    if (capabilities) {
      console.log("Service Worker Capabilities:", capabilities);
      return capabilities;
    } else {
      throw new Error("Could not determine capabilities");
    }
  } catch (error) {
    console.error("❌ Capability check failed:", error);
    throw error;
  } finally {
    await demo.cleanup();
  }
}

// Auto-run demo if this file is executed directly
if (typeof window !== "undefined" && window.location?.search?.includes("demo=service-worker")) {
  runCompleteServiceWorkerDemo().catch(console.error);
}
