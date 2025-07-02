//! Service Worker for Unified Sync System
//!
//! This service worker handles background synchronization, periodic sync,
//! and push notifications for the unified sync system. It runs independently
//! of the main application and can perform sync operations even when the
//! main app is closed.

declare const self: any;

import {
  BackgroundSyncStatus,
  ServiceWorkerMessageType,
  DEFAULT_SERVICE_WORKER_CONFIG,
} from "./service-worker-types.js";

import type {
  ServiceWorkerSyncConfig,
  BackgroundSyncOperation,
  AnyServiceWorkerMessage,
  SystemResourceStatus,
} from "./service-worker-types.js";

import type { UnifiedSyncManager } from "./types.js";

/**
 * Service worker state management
 */
class ServiceWorkerSyncState {
  private config: ServiceWorkerSyncConfig = DEFAULT_SERVICE_WORKER_CONFIG;
  private operationQueue = new Map<string, BackgroundSyncOperation>();
  private activeOperations = new Set<string>();
  private port: MessagePort | null = null;
  // @ts-ignore - Will be used for sync operations in future
  private syncManager: UnifiedSyncManager | null = null;

  /**
   * Initialize service worker state
   */
  async initialize(): Promise<void> {
    console.log("🔧 Service Worker: Initializing unified sync...");

    // Set up event listeners
    this.setupEventListeners();

    console.log("✅ Service Worker: Unified sync initialized");
  }

  /**
   * Set up event listeners for service worker events
   */
  private setupEventListeners(): void {
    // Background sync event
    self.addEventListener("sync", (event: any) => {
      console.log(
        "🔄 Service Worker: Background sync event received:",
        event.tag
      );

      if (event.tag.startsWith("unified-sync-")) {
        const operationId = event.tag.replace("unified-sync-", "");
        event.waitUntil(this.handleBackgroundSync(operationId));
      }
    });

    // Periodic sync event (if supported)
    self.addEventListener("periodicsync", (event: any) => {
      console.log(
        "⏰ Service Worker: Periodic sync event received:",
        event.tag
      );

      if (event.tag === "unified-sync-periodic") {
        event.waitUntil(this.handlePeriodicSync());
      }
    });

    // Push notification event
    self.addEventListener("push", (event: any) => {
      console.log("📧 Service Worker: Push notification received");

      if (event.data) {
        try {
          const data = event.data.json();
          if (data.type === "sync-trigger") {
            event.waitUntil(this.handlePushSync(data));
          }
        } catch (error) {
          console.error("Failed to parse push data:", error);
        }
      }
    });

    // Message event for communication with main thread
    self.addEventListener("message", (event: any) => {
      if (event.data?.type === "INIT_PORT" && event.ports?.[0]) {
        this.port = event.ports[0];
        this.port!.onmessage = (messageEvent) => {
          this.handleMainThreadMessage(messageEvent.data);
        };
        console.log("📡 Service Worker: Message port established");
      }
    });
  }

  /**
   * Handle background sync operation
   */
  private async handleBackgroundSync(operationId: string): Promise<void> {
    console.log(
      `🔄 Service Worker: Handling background sync for operation ${operationId}`
    );

    const operation = this.operationQueue.get(operationId);
    if (!operation) {
      console.warn(`Operation ${operationId} not found in queue`);
      return;
    }

    // Check if operation is already running
    if (this.activeOperations.has(operationId)) {
      console.log(`Operation ${operationId} already running`);
      return;
    }

    try {
      // Check system resources before starting
      const resourceStatus = await this.getResourceStatus();
      if (!this.shouldRunSync(resourceStatus)) {
        console.log(
          "🔋 Service Worker: Deferring sync due to resource constraints"
        );
        return;
      }

      // Mark operation as active
      this.activeOperations.add(operationId);
      operation.status = BackgroundSyncStatus.Running;
      operation.startedAt = new Date();

      // Notify main thread
      this.sendMessageToMainThread({
        type: ServiceWorkerMessageType.SyncStarted,
        id: this.generateMessageId(),
        timestamp: new Date(),
        operationId,
        domain: operation.domain,
      });

      // Perform the actual sync operation
      const result = await this.performSyncOperation(operation);

      // Update operation status
      operation.status = BackgroundSyncStatus.Completed;
      operation.completedAt = new Date();
      operation.result = result;

      // Notify main thread of completion
      this.sendMessageToMainThread({
        type: ServiceWorkerMessageType.SyncCompleted,
        id: this.generateMessageId(),
        timestamp: new Date(),
        operationId,
        result,
      });

      console.log(
        `✅ Service Worker: Background sync completed for ${operationId}`
      );
    } catch (error) {
      console.error(
        `❌ Service Worker: Background sync failed for ${operationId}:`,
        error
      );

      // Update operation status
      operation.status = BackgroundSyncStatus.Failed;
      operation.error = {
        code: "BACKGROUND_SYNC_FAILED",
        message: error instanceof Error ? error.message : String(error),
        details: error,
      };
      operation.retryCount++;
      operation.lastAttempt = new Date();

      // Determine if we should retry
      const willRetry = operation.retryCount < operation.maxRetries;

      // Notify main thread of failure
      this.sendMessageToMainThread({
        type: ServiceWorkerMessageType.SyncFailed,
        id: this.generateMessageId(),
        timestamp: new Date(),
        operationId,
        error: operation.error,
        willRetry,
        retryCount: operation.retryCount,
      });

      // Schedule retry if applicable
      if (willRetry) {
        const retryDelay = this.calculateRetryDelay(operation);
        setTimeout(() => {
          // Re-register background sync for retry
          if ("sync" in (self as any).registration) {
            (self as any).registration.sync.register(
              `unified-sync-${operationId}`
            );
          }
        }, retryDelay);
      }
    } finally {
      // Remove from active operations
      this.activeOperations.delete(operationId);

      // Update operation in queue
      this.operationQueue.set(operationId, operation);
    }
  }

  /**
   * Handle periodic sync
   */
  private async handlePeriodicSync(): Promise<void> {
    console.log("⏰ Service Worker: Handling periodic sync");

    try {
      // Check system resources
      const resourceStatus = await this.getResourceStatus();
      if (!this.shouldRunSync(resourceStatus)) {
        console.log(
          "🔋 Service Worker: Skipping periodic sync due to resource constraints"
        );
        return;
      }

      // Trigger sync for enabled domains
      for (const domain of this.config.backgroundSyncDomains) {
        const operationId = this.generateOperationId();

        const operation: BackgroundSyncOperation = {
          id: operationId,
          type: "periodic-sync",
          domain,
          options: {
            includeBinaryData: false, // Keep periodic sync lightweight
            pageSize: 25,
          },
          status: BackgroundSyncStatus.Pending,
          priority: 5, // Medium priority
          createdAt: new Date(),
          retryCount: 0,
          maxRetries: this.config.defaultRetryConfig.maxRetries,
          retryDelay: this.config.defaultRetryConfig.baseDelay,
        };

        this.operationQueue.set(operationId, operation);
        await this.handleBackgroundSync(operationId);
      }

      console.log("✅ Service Worker: Periodic sync completed");
    } catch (error) {
      console.error("❌ Service Worker: Periodic sync failed:", error);
    }
  }

  /**
   * Handle push-triggered sync
   */
  private async handlePushSync(data: any): Promise<void> {
    console.log("📧 Service Worker: Handling push-triggered sync:", data);

    try {
      const { domain, itemIds } = data;

      if (!this.config.backgroundSyncDomains.includes(domain)) {
        console.log(`Domain ${domain} not enabled for background sync`);
        return;
      }

      const operationId = this.generateOperationId();

      const operation: BackgroundSyncOperation = {
        id: operationId,
        type: "push-sync",
        domain,
        options: {
          includeBinaryData: true,
          pageSize: 50,
        },
        status: BackgroundSyncStatus.Pending,
        priority: 8, // High priority for push-triggered sync
        createdAt: new Date(),
        retryCount: 0,
        maxRetries: this.config.defaultRetryConfig.maxRetries,
        retryDelay: this.config.defaultRetryConfig.baseDelay,
        metadata: { itemIds },
      };

      this.operationQueue.set(operationId, operation);

      // Show notification if enabled
      if (
        "Notification" in self &&
        (self as any).Notification.permission === "granted"
      ) {
        (self as any).registration.showNotification("New Content Available", {
          body: `New ${domain} content is being synced in the background.`,
          icon: "/icon-192.png",
          badge: "/badge-72.png",
          tag: "sync-notification",
          requireInteraction: false,
        });
      }

      // Perform sync
      await this.handleBackgroundSync(operationId);
    } catch (error) {
      console.error("❌ Service Worker: Push sync failed:", error);
    }
  }

  /**
   * Handle messages from main thread
   */
  private async handleMainThreadMessage(
    message: AnyServiceWorkerMessage
  ): Promise<void> {
    console.log(
      "📨 Service Worker: Received message from main thread:",
      message.type
    );

    switch (message.type) {
      case ServiceWorkerMessageType.RegisterBackgroundSync:
        await this.registerOperation(message.operation);
        break;

      case ServiceWorkerMessageType.CancelBackgroundSync:
        await this.cancelOperation(message.operationId);
        break;

      case ServiceWorkerMessageType.GetSyncStatus:
        await this.sendSyncStatus(message.operationId);
        break;

      case ServiceWorkerMessageType.UpdateConfig:
        this.updateConfig(message.config);
        break;

      default:
        console.warn("Unknown message type:", message.type);
    }
  }

  /**
   * Register a new sync operation
   */
  private async registerOperation(
    operation: Omit<
      BackgroundSyncOperation,
      "id" | "status" | "createdAt" | "retryCount"
    >
  ): Promise<void> {
    const operationId = this.generateOperationId();

    const fullOperation: BackgroundSyncOperation = {
      ...operation,
      id: operationId,
      status: BackgroundSyncStatus.Pending,
      createdAt: new Date(),
      retryCount: 0,
    };

    this.operationQueue.set(operationId, fullOperation);

    console.log(
      `📝 Service Worker: Registered operation ${operationId} for ${operation.domain}`
    );
  }

  /**
   * Cancel a sync operation
   */
  private async cancelOperation(operationId: string): Promise<void> {
    const operation = this.operationQueue.get(operationId);
    if (operation) {
      operation.status = BackgroundSyncStatus.Cancelled;
      this.operationQueue.set(operationId, operation);
      this.activeOperations.delete(operationId);

      console.log(`🚫 Service Worker: Cancelled operation ${operationId}`);
    }
  }

  /**
   * Send sync status to main thread
   */
  private async sendSyncStatus(operationId?: string): Promise<void> {
    const operations = operationId
      ? ([this.operationQueue.get(operationId)].filter(
          Boolean
        ) as BackgroundSyncOperation[])
      : Array.from(this.operationQueue.values());

    this.sendMessageToMainThread({
      type: ServiceWorkerMessageType.StatusUpdate,
      id: this.generateMessageId(),
      timestamp: new Date(),
      operations,
      activeCount: this.activeOperations.size,
      pendingCount: operations.filter(
        (op) => op.status === BackgroundSyncStatus.Pending
      ).length,
    });
  }

  /**
   * Update configuration
   */
  private updateConfig(config: Partial<ServiceWorkerSyncConfig>): void {
    this.config = { ...this.config, ...config };
    console.log("⚙️ Service Worker: Configuration updated");
  }

  /**
   * Perform actual sync operation
   */
  private async performSyncOperation(
    operation: BackgroundSyncOperation
  ): Promise<any> {
    // This is a simplified implementation
    // In a real implementation, this would create and use the sync manager
    console.log(
      `🔄 Service Worker: Performing sync for ${operation.domain}...`
    );

    // Simulate API call
    const response = await fetch(`/api/sync/${operation.domain}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Sync API failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // Return mock result
    return {
      domain: operation.domain,
      status: "complete",
      itemsSynced: data.items?.length || 0,
      totalItems: data.total_count || 0,
      duration: 1000, // Mock duration
      errors: [],
    };
  }

  /**
   * Check if sync should run based on resource constraints
   */
  private shouldRunSync(resourceStatus: SystemResourceStatus): boolean {
    // Check network constraints
    if (
      this.config.networkConfig.wifiOnly &&
      resourceStatus.network.type !== "wifi"
    ) {
      return false;
    }

    if (
      !this.config.networkConfig.allowCellular &&
      resourceStatus.network.type === "cellular"
    ) {
      return false;
    }

    if (
      !this.config.networkConfig.allowMetered &&
      resourceStatus.network.saveData
    ) {
      return false;
    }

    // Check battery constraints
    if (resourceStatus.battery) {
      if (
        resourceStatus.battery.level < this.config.batteryConfig.minBatteryLevel
      ) {
        return false;
      }

      if (
        this.config.batteryConfig.pauseOnLowBattery &&
        resourceStatus.battery.level < 0.2
      ) {
        return false;
      }

      if (
        this.config.batteryConfig.pauseWhenNotCharging &&
        !resourceStatus.battery.charging
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get system resource status
   */
  private async getResourceStatus(): Promise<SystemResourceStatus> {
    const status: SystemResourceStatus = {
      network: {
        online: navigator.onLine,
        type: "unknown",
      },
    };

    // Get network information if available
    if ("connection" in navigator) {
      const connection = (navigator as any).connection;
      status.network = {
        online: navigator.onLine,
        type: connection.type || "unknown",
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        rtt: connection.rtt,
        saveData: connection.saveData,
      };
    }

    // Get battery information if available
    if ("getBattery" in navigator) {
      try {
        const battery = await (navigator as any).getBattery();
        status.battery = {
          level: battery.level,
          charging: battery.charging,
          chargingTime: battery.chargingTime,
          dischargingTime: battery.dischargingTime,
        };
      } catch (error) {
        // Battery API not available
      }
    }

    return status;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(operation: BackgroundSyncOperation): number {
    const config = this.config.defaultRetryConfig;
    const delay = Math.min(
      config.baseDelay *
        Math.pow(config.backoffMultiplier, operation.retryCount),
      config.maxDelay
    );

    // Add jitter
    const jitter = delay * config.jitterFactor * Math.random();
    return delay + jitter;
  }

  /**
   * Send message to main thread
   */
  private sendMessageToMainThread(message: AnyServiceWorkerMessage): void {
    if (this.port) {
      this.port.postMessage(message);
    }
  }

  /**
   * Generate unique operation ID
   */
  private generateOperationId(): string {
    return `sw-op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `sw-msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Initialize service worker state
const syncState = new ServiceWorkerSyncState();

// Service worker installation
self.addEventListener("install", (event: any) => {
  console.log("🔧 Service Worker: Installing...");

  event.waitUntil(
    syncState.initialize().then(() => {
      console.log("✅ Service Worker: Installed successfully");
      // Skip waiting to activate immediately
      return self.skipWaiting();
    })
  );
});

// Service worker activation
self.addEventListener("activate", (event: any) => {
  console.log("🔧 Service Worker: Activating...");

  event.waitUntil(
    self.clients.claim().then(() => {
      console.log("✅ Service Worker: Activated and claimed clients");
    })
  );
});

// Export for type checking (not used at runtime)
export { syncState };
