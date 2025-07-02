//! Service Worker Sync Manager Implementation
//!
//! This module provides the main implementation for service worker background sync
//! integration. It handles background sync registration, coordination between main
//! thread and service worker, queue management, and resource-aware scheduling.

import {
  BackgroundSyncStatus,
  ServiceWorkerMessageType,
  DEFAULT_SERVICE_WORKER_CONFIG,
} from "./service-worker-types.js";

import type {
  ServiceWorkerSyncManager,
  ServiceWorkerSyncConfig,
  BackgroundSyncOperation,
  AnyServiceWorkerMessage,
  RegisterBackgroundSyncMessage,
  CancelBackgroundSyncMessage,
  GetSyncStatusMessage,
  UpdateConfigMessage,
  ServiceWorkerCapabilities,
  SystemResourceStatus,
  BackgroundSyncQueueState,
  PeriodicSyncRegistrationOptions,
  ServiceWorkerRegistrationOptions,
} from "./service-worker-types.js";

import type { UnifiedSyncManager } from "./types.js";

/**
 * Main service worker sync manager implementation
 */
export class ServiceWorkerSyncManagerImpl implements ServiceWorkerSyncManager {
  private config: ServiceWorkerSyncConfig;
  // @ts-ignore - Will be used for sync operations
  private syncManager: UnifiedSyncManager;
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
  private messageChannel: MessageChannel | null = null;
  private eventListeners = new Map<
    ServiceWorkerMessageType,
    Set<(message: AnyServiceWorkerMessage) => void>
  >();
  private operationQueue = new Map<string, BackgroundSyncOperation>();
  private capabilities: ServiceWorkerCapabilities | null = null;

  constructor(
    syncManager: UnifiedSyncManager,
    config: Partial<ServiceWorkerSyncConfig> = {}
  ) {
    this.syncManager = syncManager;
    this.config = { ...DEFAULT_SERVICE_WORKER_CONFIG, ...config };
  }

  /**
   * Initialize service worker sync
   */
  async initialize(): Promise<void> {
    console.log("🔧 Initializing Service Worker Sync Manager...");

    try {
      // Check capabilities first
      this.capabilities = await this.getCapabilities();

      if (!this.capabilities.serviceWorker) {
        console.warn(
          "⚠️ Service Workers not supported, background sync disabled"
        );
        return;
      }

      // Register service worker
      await this.registerServiceWorker({
        scriptURL: "/service-worker.js",
        scope: "/",
      });

      // Set up message channel for communication
      await this.setupMessageChannel();

      // Send initial configuration
      await this.updateConfig(this.config);

      // Set up periodic sync if supported
      if (
        this.capabilities.periodicBackgroundSync &&
        this.config.periodicSyncEnabled
      ) {
        await this.setupPeriodicSync();
      }

      console.log("✅ Service Worker Sync Manager initialized");
    } catch (error) {
      console.error(
        "❌ Failed to initialize Service Worker Sync Manager:",
        error
      );
      throw error;
    }
  }

  /**
   * Register background sync operation
   */
  async registerBackgroundSync(
    operation: Omit<
      BackgroundSyncOperation,
      "id" | "status" | "createdAt" | "retryCount"
    >
  ): Promise<string> {
    if (!this.capabilities?.backgroundSync) {
      throw new Error("Background sync not supported");
    }

    // Check if domain is enabled for background sync
    if (!this.config.backgroundSyncDomains.includes(operation.domain)) {
      throw new Error(
        `Domain ${operation.domain} not enabled for background sync`
      );
    }

    // Generate operation ID
    const operationId = this.generateOperationId();

    // Create full operation object
    const fullOperation: BackgroundSyncOperation = {
      ...operation,
      id: operationId,
      status: BackgroundSyncStatus.Pending,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries:
        operation.maxRetries || this.config.defaultRetryConfig.maxRetries,
      retryDelay:
        operation.retryDelay || this.config.defaultRetryConfig.baseDelay,
    };

    // Add to local queue
    this.operationQueue.set(operationId, fullOperation);

    // Send message to service worker
    const message: RegisterBackgroundSyncMessage = {
      type: ServiceWorkerMessageType.RegisterBackgroundSync,
      id: this.generateMessageId(),
      timestamp: new Date(),
      operation: operation,
    };

    await this.sendMessageToServiceWorker(message);

    // Register with browser's background sync API
    if ("sync" in this.serviceWorkerRegistration!) {
      await (this.serviceWorkerRegistration as any).sync.register(
        `unified-sync-${operationId}`
      );
    }

    console.log(
      `📝 Registered background sync operation: ${operationId} (${operation.domain})`
    );
    return operationId;
  }

  /**
   * Cancel background sync operation
   */
  async cancelBackgroundSync(operationId: string): Promise<void> {
    const operation = this.operationQueue.get(operationId);
    if (!operation) {
      throw new Error(`Operation ${operationId} not found`);
    }

    // Update local status
    operation.status = BackgroundSyncStatus.Cancelled;
    this.operationQueue.set(operationId, operation);

    // Send cancellation message to service worker
    const message: CancelBackgroundSyncMessage = {
      type: ServiceWorkerMessageType.CancelBackgroundSync,
      id: this.generateMessageId(),
      timestamp: new Date(),
      operationId,
    };

    await this.sendMessageToServiceWorker(message);

    console.log(`🚫 Cancelled background sync operation: ${operationId}`);
  }

  /**
   * Get sync operation status
   */
  async getSyncStatus(
    operationId?: string
  ): Promise<BackgroundSyncOperation[]> {
    const message: GetSyncStatusMessage = {
      type: ServiceWorkerMessageType.GetSyncStatus,
      id: this.generateMessageId(),
      timestamp: new Date(),
      operationId,
    };

    // Send request to service worker
    await this.sendMessageToServiceWorker(message);

    // For now, return local queue status
    // In a real implementation, we'd wait for the service worker response
    if (operationId) {
      const operation = this.operationQueue.get(operationId);
      return operation ? [operation] : [];
    }

    return Array.from(this.operationQueue.values());
  }

  /**
   * Update service worker configuration
   */
  async updateConfig(config: Partial<ServiceWorkerSyncConfig>): Promise<void> {
    // Update local config
    this.config = { ...this.config, ...config };

    // Send updated config to service worker
    const message: UpdateConfigMessage = {
      type: ServiceWorkerMessageType.UpdateConfig,
      id: this.generateMessageId(),
      timestamp: new Date(),
      config,
    };

    await this.sendMessageToServiceWorker(message);
    console.log("⚙️ Service worker configuration updated");
  }

  /**
   * Check service worker capabilities
   */
  async getCapabilities(): Promise<ServiceWorkerCapabilities> {
    const capabilities: ServiceWorkerCapabilities = {
      serviceWorker: "serviceWorker" in navigator,
      backgroundSync: false,
      periodicBackgroundSync: false,
      pushAPI: "PushManager" in window,
      notifications: "Notification" in window,
    };

    if (capabilities.serviceWorker) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        capabilities.backgroundSync = !!("sync" in (registration || {}));
        capabilities.periodicBackgroundSync = !!(
          "periodicSync" in (registration || {})
        );
      } catch (error) {
        console.warn("Could not check background sync capabilities:", error);
      }
    }

    return capabilities;
  }

  /**
   * Get system resource status
   */
  async getResourceStatus(): Promise<SystemResourceStatus> {
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
        console.warn("Could not get battery information:", error);
      }
    }

    // Get memory information if available
    if ("memory" in performance) {
      const memory = (performance as any).memory;
      status.memory = {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
      };
    }

    return status;
  }

  /**
   * Get background sync queue state
   */
  async getQueueState(): Promise<BackgroundSyncQueueState> {
    const operations = Array.from(this.operationQueue.values());

    const activeOperations = operations.filter(
      (op) => op.status === BackgroundSyncStatus.Running
    );
    const pendingOperations = operations.filter(
      (op) => op.status === BackgroundSyncStatus.Pending
    );
    const failedOperations = operations.filter(
      (op) => op.status === BackgroundSyncStatus.Failed
    );
    const completedOperations = operations.filter(
      (op) => op.status === BackgroundSyncStatus.Completed
    );

    // Calculate statistics
    const totalOperations = operations.length;
    const completedCount = completedOperations.length;
    const failedCount = failedOperations.length;

    const averageCompletionTime =
      completedOperations.length > 0
        ? completedOperations.reduce((sum, op) => {
            if (op.startedAt && op.completedAt) {
              return sum + (op.completedAt.getTime() - op.startedAt.getTime());
            }
            return sum;
          }, 0) / completedOperations.length
        : 0;

    const successRate =
      totalOperations > 0 ? completedCount / (completedCount + failedCount) : 0;

    return {
      operations,
      activeOperations,
      pendingOperations,
      failedOperations,
      stats: {
        totalOperations,
        completedOperations: completedCount,
        failedOperations: failedCount,
        averageCompletionTime,
        successRate,
      },
    };
  }

  /**
   * Register for periodic sync
   */
  async registerPeriodicSync(
    options: PeriodicSyncRegistrationOptions
  ): Promise<void> {
    if (!this.capabilities?.periodicBackgroundSync) {
      throw new Error("Periodic background sync not supported");
    }

    if (!("periodicSync" in this.serviceWorkerRegistration!)) {
      throw new Error("Periodic sync not available on registration");
    }

    await (this.serviceWorkerRegistration as any).periodicSync.register(
      options.tag,
      {
        minInterval: options.minInterval,
      }
    );

    console.log(
      `⏰ Registered periodic sync: ${options.tag} (${options.minInterval}ms)`
    );
  }

  /**
   * Unregister periodic sync
   */
  async unregisterPeriodicSync(tag: string): Promise<void> {
    if (!("periodicSync" in this.serviceWorkerRegistration!)) {
      throw new Error("Periodic sync not available");
    }

    await (this.serviceWorkerRegistration as any).periodicSync.unregister(tag);
    console.log(`🚫 Unregistered periodic sync: ${tag}`);
  }

  /**
   * Add event listener
   */
  addEventListener(
    type: ServiceWorkerMessageType,
    listener: (message: AnyServiceWorkerMessage) => void
  ): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(
    type: ServiceWorkerMessageType,
    listener: (message: AnyServiceWorkerMessage) => void
  ): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    console.log("🧹 Destroying Service Worker Sync Manager...");

    // Cancel all pending operations
    const pendingOperations = Array.from(this.operationQueue.values()).filter(
      (op) => op.status === BackgroundSyncStatus.Pending
    );

    for (const operation of pendingOperations) {
      try {
        await this.cancelBackgroundSync(operation.id);
      } catch (error) {
        console.warn(`Failed to cancel operation ${operation.id}:`, error);
      }
    }

    // Clear event listeners
    this.eventListeners.clear();

    // Close message channel
    if (this.messageChannel) {
      this.messageChannel.port1.close();
      this.messageChannel.port2.close();
      this.messageChannel = null;
    }

    console.log("✅ Service Worker Sync Manager destroyed");
  }

  // Private helper methods

  private async registerServiceWorker(
    options: ServiceWorkerRegistrationOptions
  ): Promise<void> {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service Workers not supported");
    }

    try {
      this.serviceWorkerRegistration = await navigator.serviceWorker.register(
        options.scriptURL,
        {
          scope: options.scope,
          updateViaCache: options.updateViaCache,
          type: options.type,
        }
      );

      console.log(
        "✅ Service Worker registered:",
        this.serviceWorkerRegistration.scope
      );

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;
    } catch (error) {
      console.error("❌ Service Worker registration failed:", error);
      throw error;
    }
  }

  private async setupMessageChannel(): Promise<void> {
    if (!this.serviceWorkerRegistration) {
      throw new Error("Service Worker not registered");
    }

    this.messageChannel = new MessageChannel();

    // Set up message handler
    this.messageChannel.port1.onmessage = (event) => {
      this.handleServiceWorkerMessage(event.data);
    };

    // Send port to service worker
    const serviceWorker = this.serviceWorkerRegistration.active;
    if (serviceWorker) {
      serviceWorker.postMessage({ type: "INIT_PORT" }, [
        this.messageChannel.port2,
      ]);
    }

    console.log("📡 Message channel established with service worker");
  }

  private async setupPeriodicSync(): Promise<void> {
    try {
      await this.registerPeriodicSync({
        tag: "unified-sync-periodic",
        minInterval: this.config.periodicSyncInterval * 60 * 1000, // Convert minutes to ms
      });

      console.log("⏰ Periodic sync configured");
    } catch (error) {
      console.warn("⚠️ Could not set up periodic sync:", error);
    }
  }

  private async sendMessageToServiceWorker(
    message: AnyServiceWorkerMessage
  ): Promise<void> {
    if (!this.messageChannel) {
      throw new Error("Message channel not established");
    }

    this.messageChannel.port1.postMessage(message);
  }

  private handleServiceWorkerMessage(message: AnyServiceWorkerMessage): void {
    console.log("📨 Received message from service worker:", message.type);

    // Update local operation state based on message
    this.updateOperationFromMessage(message);

    // Emit to listeners
    const listeners = this.eventListeners.get(message.type);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(message);
        } catch (error) {
          console.error("Error in service worker message listener:", error);
        }
      });
    }
  }

  private updateOperationFromMessage(message: AnyServiceWorkerMessage): void {
    let operationId: string | undefined;

    switch (message.type) {
      case ServiceWorkerMessageType.SyncStarted:
        operationId = message.operationId;
        break;
      case ServiceWorkerMessageType.SyncProgress:
        operationId = message.operationId;
        break;
      case ServiceWorkerMessageType.SyncCompleted:
        operationId = message.operationId;
        break;
      case ServiceWorkerMessageType.SyncFailed:
        operationId = message.operationId;
        break;
      case ServiceWorkerMessageType.SyncCancelled:
        operationId = message.operationId;
        break;
    }

    if (operationId) {
      const operation = this.operationQueue.get(operationId);
      if (operation) {
        // Update operation status based on message type
        switch (message.type) {
          case ServiceWorkerMessageType.SyncStarted:
            operation.status = BackgroundSyncStatus.Running;
            operation.startedAt = new Date();
            break;
          case ServiceWorkerMessageType.SyncCompleted:
            operation.status = BackgroundSyncStatus.Completed;
            operation.completedAt = new Date();
            operation.result = message.result;
            break;
          case ServiceWorkerMessageType.SyncFailed:
            operation.status = BackgroundSyncStatus.Failed;
            operation.error = message.error;
            operation.retryCount = message.retryCount;
            operation.lastAttempt = new Date();
            break;
          case ServiceWorkerMessageType.SyncCancelled:
            operation.status = BackgroundSyncStatus.Cancelled;
            break;
        }

        this.operationQueue.set(operationId, operation);
      }
    }
  }

  private generateOperationId(): string {
    return `sw-sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Factory function to create service worker sync manager
 */
export function createServiceWorkerSyncManager(
  syncManager: UnifiedSyncManager,
  config?: Partial<ServiceWorkerSyncConfig>
): ServiceWorkerSyncManager {
  return new ServiceWorkerSyncManagerImpl(syncManager, config);
}

/**
 * Check if service worker sync is supported
 */
export function isServiceWorkerSyncSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "ServiceWorkerRegistration" in window &&
    "sync" in (window as any).ServiceWorkerRegistration.prototype
  );
}

/**
 * Check if periodic background sync is supported
 */
export function isPeriodicBackgroundSyncSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "ServiceWorkerRegistration" in window &&
    "periodicSync" in (window as any).ServiceWorkerRegistration.prototype
  );
}
