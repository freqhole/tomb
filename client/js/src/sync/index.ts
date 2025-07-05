//! Unified Sync System - Main Exports
//!
//! This is the new, clean sync system that replaces the legacy implementation.
//! It provides a single, unified interface for synchronizing multiple domains
//! (music, photos, documents, videos) with automatic WebSocket updates,
//! service worker support, and efficient binary data caching.

// Core types and interfaces
export type {
  SyncDomain,
  UnifiedSyncManager,
  SyncAllOptions,
  SyncDomainOptions,
  SyncResult,
  SyncStatusMap,
  SyncProgressMap,
  SyncProgress,
  SyncEventListener,
  AnySyncEvent,
  SyncStartedEvent,
  SyncProgressEvent,
  SyncCompletedEvent,
  SyncFailedEvent,
  BinarySyncProgressEvent,
  AutoSyncTriggeredEvent,
  ConnectionChangedEvent,
  DomainConfig,
  WebSocketNotification,
  UnifiedSyncConfig,
  SyncError,
  BinarySyncStats,
  UnifiedStorage,
  StorageQueryOptions,
  StorageStats,
  BinaryMetadata,
  StorageConfig,
  ServiceWorkerConfig,
  AutoSyncConfig,
  DomainEndpoints,
  BinaryConfig,
  DataTransforms,
  ServiceWorkerSyncConfig,
} from "./types.js";

// Core implementations
export {
  UnifiedSyncManagerImpl,
  createUnifiedSyncManager,
} from "./unified-sync-manager.js";

export { UnifiedStorageImpl, createUnifiedStorage } from "./unified-storage.js";

// Domain configurations
export {
  createDomainConfigs,
  getDomainConfig,
  getDefaultSyncOptions,
  getBinaryConfig,
  supportsBinaryData,
  getSupportedDomains,
  validateDomainConfig,
  createCustomDomainConfig,
} from "./domain-configs.js";

// Service worker sync components
export {
  ServiceWorkerSyncManagerImpl,
  createServiceWorkerSyncManager,
  isServiceWorkerSyncSupported,
  isPeriodicBackgroundSyncSupported,
} from "./service-worker-sync-manager.js";

export type {
  ServiceWorkerSyncManager,
  BackgroundSyncOperation,
  BackgroundSyncStatus,
  ServiceWorkerMessageType,
  ServiceWorkerCapabilities,
  SystemResourceStatus,
  BackgroundSyncQueueState,
} from "./service-worker-types.js";

// Auto-sync integration
export { setupAutoSync } from "./auto-sync-integration.js";

// Enums for external use
export { SyncStatus, SyncEventType } from "./types.js";

// Factory function for easy setup
import type { WebSocketClient } from "../lib/websocket-client.js";
import type { ApiClient } from "../lib/api-client.js";
import { createUnifiedSyncManager } from "./unified-sync-manager.js";
import { createUnifiedStorage } from "./unified-storage.js";
import { createDomainConfigs } from "./domain-configs.js";
import type {
  UnifiedSyncManager,
  UnifiedSyncConfig,
  SyncDomain,
  AutoSyncConfig,
  StorageConfig,
} from "./types.js";
import { setupAutoSync } from "./auto-sync-integration.js";
import { enableDebug, disableDebug, configureDebug } from "./debug.js";

/**
 * Default unified sync configuration
 */
export const DEFAULT_UNIFIED_SYNC_CONFIG: Partial<UnifiedSyncConfig> = {
  domains: createDomainConfigs(),
  storage: {
    databaseName: "unified_sync_storage",
    version: 2,
    maxSize: 100 * 1024 * 1024, // 100MB
    maxAge: 30, // 30 days
  },
  autoSync: {
    enabled: true,
    syncOnNewContent: true,
    periodicInterval: 30, // 30 minutes
    domains: ["music", "photos"], // Start with these domains
    debounceDelay: 5000, // 5 seconds
  },
  defaultSyncOptions: {
    domains: ["music", "photos"],
    forceFullSync: false,
    includeBinaryData: true,
    priorityOrder: ["music", "photos", "documents", "videos"],
  },
};

/**
 * Create a fully configured unified sync manager with sensible defaults
 */
export async function createConfiguredSyncManager(
  wsClient: WebSocketClient,
  apiClient: ApiClient,
  options: {
    apiBaseUrl: string;
    websocketUrl: string;
    clientId: string;
    authToken?: string;
    storageConfig?: Partial<StorageConfig>;
    autoSyncConfig?: Partial<AutoSyncConfig>;
    enabledDomains?: SyncDomain[];
  }
): Promise<UnifiedSyncManager> {
  const config: UnifiedSyncConfig = {
    apiBaseUrl: options.apiBaseUrl,
    websocketUrl: options.websocketUrl,
    clientId: options.clientId,
    authToken: options.authToken,
    domains: createDomainConfigs(),
    storage: {
      ...DEFAULT_UNIFIED_SYNC_CONFIG.storage!,
      ...options.storageConfig,
    },
    autoSync: {
      ...DEFAULT_UNIFIED_SYNC_CONFIG.autoSync!,
      domains:
        options.enabledDomains || DEFAULT_UNIFIED_SYNC_CONFIG.autoSync!.domains,
      ...options.autoSyncConfig,
    },
    defaultSyncOptions: {
      ...DEFAULT_UNIFIED_SYNC_CONFIG.defaultSyncOptions!,
      domains:
        options.enabledDomains ||
        DEFAULT_UNIFIED_SYNC_CONFIG.defaultSyncOptions!.domains,
    },
  };

  // Create storage
  const storage = createUnifiedStorage(config.storage);
  await storage.initialize();

  // Create sync manager
  const syncManager = createUnifiedSyncManager(
    storage,
    wsClient,
    apiClient,
    config
  );
  await syncManager.initialize();

  return syncManager;
}

/**
 * Quick setup function for the most common use case
 */
export async function setupUnifiedSync(
  wsClient: WebSocketClient,
  apiClient: ApiClient,
  options: {
    apiBaseUrl: string;
    clientId: string;
    authToken?: string;
  }
): Promise<UnifiedSyncManager> {
  return createConfiguredSyncManager(wsClient, apiClient, {
    ...options,
    websocketUrl: options.apiBaseUrl.replace("http", "ws") + "/ws",
  });
}

/**
 * Version information
 */
export const UNIFIED_SYNC_VERSION = "1.0.0";

/**
 * Feature flags for gradual rollout
 */
export const SYNC_FEATURES = {
  AUTO_SYNC: true,
  BINARY_CACHING: true,
  SERVICE_WORKER: true,
  MULTI_DOMAIN: true,
  REAL_TIME_UPDATES: true,
  SERVICE_WORKER_SYNC: true,
  NOTIFICATION_ROUTING: true,
  ENHANCED_AUTO_SYNC: true,
  USER_NOTIFICATIONS: true,
  RESOURCE_AWARENESS: true,
  SMART_SCHEDULING: true,
} as const;

/**
 * Quick setup function for auto-sync system
 */
export async function setupUnifiedSyncQuick(
  wsClient: WebSocketClient,
  apiClient: ApiClient,
  options: {
    apiBaseUrl: string;
    clientId: string;
    authToken?: string;
    enableUserNotifications?: boolean;
    enableBackgroundSync?: boolean;
  }
): Promise<{ syncManager: UnifiedSyncManager; autoSyncSystem: any }> {
  // Set up basic unified sync
  const syncManager = await setupUnifiedSync(wsClient, apiClient, {
    apiBaseUrl: options.apiBaseUrl,
    clientId: options.clientId,
    authToken: options.authToken,
  });

  // Set up auto-sync system
  const autoSyncSystem = await setupAutoSync(syncManager, wsClient, {
    enableUserNotifications: options.enableUserNotifications ?? true,
    enableBackgroundSync: options.enableBackgroundSync ?? true,
    autoStart: true,
  });

  return { syncManager, autoSyncSystem };
}

/**
 * Expose debug controls on window for easy toggling
 */
if (typeof window !== "undefined") {
  (window as any).unifiedSyncDebug = {
    enable: enableDebug,
    disable: disableDebug,
    configure: configureDebug,
  };
}

// Log system ready message
console.log("🚀 Unified Sync System loaded:", UNIFIED_SYNC_VERSION);
console.log("💡 Use window.unifiedSyncDebug.enable() to enable debug logging");
