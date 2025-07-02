//! Service Worker Sync Types
//!
//! This module defines types and interfaces for service worker background sync
//! integration with the unified sync system. It provides type-safe interfaces
//! for background sync registration, event handling, and coordination between
//! the main thread and service worker.

import type {
  SyncDomain,
  SyncDomainOptions,
  SyncResult,
  SyncError,
} from "./types.js";

// Export enums and types that need to be used as values
export { BackgroundSyncStatus, ServiceWorkerMessageType };

/**
 * Service worker sync operation types
 */
export type ServiceWorkerSyncType =
  | "background-sync"
  | "periodic-sync"
  | "push-sync"
  | "offline-sync";

/**
 * Background sync operation status
 */
enum BackgroundSyncStatus {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

/**
 * Background sync operation data
 */
export interface BackgroundSyncOperation {
  /** Unique operation ID */
  id: string;
  /** Sync operation type */
  type: ServiceWorkerSyncType;
  /** Domain to sync */
  domain: SyncDomain;
  /** Sync options */
  options: SyncDomainOptions;
  /** Operation status */
  status: BackgroundSyncStatus;
  /** Priority (1-10, higher = more important) */
  priority: number;
  /** Creation timestamp */
  createdAt: Date;
  /** Started timestamp */
  startedAt?: Date;
  /** Completed timestamp */
  completedAt?: Date;
  /** Last attempt timestamp */
  lastAttempt?: Date;
  /** Number of retry attempts */
  retryCount: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Delay between retries (ms) */
  retryDelay: number;
  /** Result if completed */
  result?: SyncResult;
  /** Error if failed */
  error?: SyncError;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Service worker sync configuration
 */
export interface ServiceWorkerSyncConfig {
  /** Enable background sync */
  backgroundSyncEnabled: boolean;
  /** Enable periodic sync */
  periodicSyncEnabled: boolean;
  /** Periodic sync interval (minutes) */
  periodicSyncInterval: number;
  /** Maximum background sync duration (ms) */
  maxBackgroundSyncDuration: number;
  /** Maximum concurrent background operations */
  maxConcurrentOperations: number;
  /** Domains enabled for background sync */
  backgroundSyncDomains: SyncDomain[];
  /** Default retry configuration */
  defaultRetryConfig: RetryConfig;
  /** Network-aware sync settings */
  networkConfig: NetworkSyncConfig;
  /** Battery-aware sync settings */
  batteryConfig: BatterySyncConfig;
}

/**
 * Retry configuration for failed operations
 */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Base delay between retries (ms) */
  baseDelay: number;
  /** Exponential backoff multiplier */
  backoffMultiplier: number;
  /** Maximum delay between retries (ms) */
  maxDelay: number;
  /** Jitter factor (0-1) to randomize delays */
  jitterFactor: number;
}

/**
 * Network-aware sync configuration
 */
export interface NetworkSyncConfig {
  /** Sync on WiFi only */
  wifiOnly: boolean;
  /** Sync on cellular (if not WiFi only) */
  allowCellular: boolean;
  /** Sync on metered connections */
  allowMetered: boolean;
  /** Minimum connection speed (kbps) */
  minConnectionSpeed?: number;
  /** Pause sync on slow connections */
  pauseOnSlowConnection: boolean;
}

/**
 * Battery-aware sync configuration
 */
export interface BatterySyncConfig {
  /** Minimum battery level (0-1) for background sync */
  minBatteryLevel: number;
  /** Pause sync when battery is low */
  pauseOnLowBattery: boolean;
  /** Pause sync when device is not charging */
  pauseWhenNotCharging: boolean;
  /** Reduce sync frequency on battery */
  reducedFrequencyOnBattery: boolean;
}

/**
 * Service worker sync event data
 */
export interface ServiceWorkerSyncEvent {
  /** Event type */
  type: "sync" | "periodicsync" | "push";
  /** Event tag/identifier */
  tag: string;
  /** Last chance to complete operation */
  lastChance: boolean;
  /** Additional event data */
  data?: any;
}

/**
 * Message types for main thread <-> service worker communication
 */
enum ServiceWorkerMessageType {
  // From main thread to service worker
  RegisterBackgroundSync = "register-background-sync",
  CancelBackgroundSync = "cancel-background-sync",
  GetSyncStatus = "get-sync-status",
  UpdateConfig = "update-config",

  // From service worker to main thread
  SyncStarted = "sync-started",
  SyncProgress = "sync-progress",
  SyncCompleted = "sync-completed",
  SyncFailed = "sync-failed",
  SyncCancelled = "sync-cancelled",
  StatusUpdate = "status-update",
}

/**
 * Base message interface
 */
export interface ServiceWorkerMessage {
  type: ServiceWorkerMessageType;
  id: string;
  timestamp: Date;
}

/**
 * Register background sync message
 */
export interface RegisterBackgroundSyncMessage extends ServiceWorkerMessage {
  type: ServiceWorkerMessageType.RegisterBackgroundSync;
  operation: Omit<
    BackgroundSyncOperation,
    "id" | "status" | "createdAt" | "retryCount"
  >;
}

/**
 * Cancel background sync message
 */
export interface CancelBackgroundSyncMessage extends ServiceWorkerMessage {
  type: ServiceWorkerMessageType.CancelBackgroundSync;
  operationId: string;
}

/**
 * Get sync status message
 */
export interface GetSyncStatusMessage extends ServiceWorkerMessage {
  type: ServiceWorkerMessageType.GetSyncStatus;
  operationId?: string; // If undefined, get all operations
}

/**
 * Update config message
 */
export interface UpdateConfigMessage extends ServiceWorkerMessage {
  type: ServiceWorkerMessageType.UpdateConfig;
  config: Partial<ServiceWorkerSyncConfig>;
}

/**
 * Sync started message
 */
export interface SyncStartedMessage extends ServiceWorkerMessage {
  type: ServiceWorkerMessageType.SyncStarted;
  operationId: string;
  domain: SyncDomain;
}

/**
 * Sync progress message
 */
export interface SyncProgressMessage extends ServiceWorkerMessage {
  type: ServiceWorkerMessageType.SyncProgress;
  operationId: string;
  domain: SyncDomain;
  progress: number; // 0-100
  itemsProcessed: number;
  totalItems: number;
}

/**
 * Sync completed message
 */
export interface SyncCompletedMessage extends ServiceWorkerMessage {
  type: ServiceWorkerMessageType.SyncCompleted;
  operationId: string;
  result: SyncResult;
}

/**
 * Sync failed message
 */
export interface SyncFailedMessage extends ServiceWorkerMessage {
  type: ServiceWorkerMessageType.SyncFailed;
  operationId: string;
  error: SyncError;
  willRetry: boolean;
  retryCount: number;
}

/**
 * Sync cancelled message
 */
export interface SyncCancelledMessage extends ServiceWorkerMessage {
  type: ServiceWorkerMessageType.SyncCancelled;
  operationId: string;
  reason: string;
}

/**
 * Status update message
 */
export interface StatusUpdateMessage extends ServiceWorkerMessage {
  type: ServiceWorkerMessageType.StatusUpdate;
  operations: BackgroundSyncOperation[];
  activeCount: number;
  pendingCount: number;
}

/**
 * Union of all service worker messages
 */
export type AnyServiceWorkerMessage =
  | RegisterBackgroundSyncMessage
  | CancelBackgroundSyncMessage
  | GetSyncStatusMessage
  | UpdateConfigMessage
  | SyncStartedMessage
  | SyncProgressMessage
  | SyncCompletedMessage
  | SyncFailedMessage
  | SyncCancelledMessage
  | StatusUpdateMessage;

/**
 * Service worker sync capabilities
 */
export interface ServiceWorkerCapabilities {
  /** Background sync API available */
  backgroundSync: boolean;
  /** Periodic background sync available */
  periodicBackgroundSync: boolean;
  /** Push API available */
  pushAPI: boolean;
  /** Notifications API available */
  notifications: boolean;
  /** Service worker supported */
  serviceWorker: boolean;
}

/**
 * System resource status
 */
export interface SystemResourceStatus {
  /** Network connection info */
  network: {
    online: boolean;
    type: string;
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
  /** Battery status */
  battery?: {
    level: number;
    charging: boolean;
    chargingTime?: number;
    dischargingTime?: number;
  };
  /** Memory status */
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

/**
 * Background sync queue state
 */
export interface BackgroundSyncQueueState {
  /** All operations in queue */
  operations: BackgroundSyncOperation[];
  /** Currently active operations */
  activeOperations: BackgroundSyncOperation[];
  /** Pending operations */
  pendingOperations: BackgroundSyncOperation[];
  /** Failed operations */
  failedOperations: BackgroundSyncOperation[];
  /** Queue statistics */
  stats: {
    totalOperations: number;
    completedOperations: number;
    failedOperations: number;
    averageCompletionTime: number;
    successRate: number;
  };
}

/**
 * Service worker registration options
 */
export interface ServiceWorkerRegistrationOptions {
  /** Service worker script URL */
  scriptURL: string;
  /** Service worker scope */
  scope?: string;
  /** Update via cache mode */
  updateViaCache?: ServiceWorkerUpdateViaCache;
  /** Registration type */
  type?: WorkerType;
}

/**
 * Periodic sync registration options
 */
export interface PeriodicSyncRegistrationOptions {
  /** Sync tag identifier */
  tag: string;
  /** Minimum interval (ms) */
  minInterval: number;
}

/**
 * Background sync registration options
 */
export interface BackgroundSyncRegistrationOptions {
  /** Sync tag identifier */
  tag: string;
  /** Operation data */
  data?: any;
}

/**
 * Service worker sync manager interface
 */
export interface ServiceWorkerSyncManager {
  /** Initialize service worker sync */
  initialize(): Promise<void>;

  /** Register background sync operation */
  registerBackgroundSync(
    operation: Omit<
      BackgroundSyncOperation,
      "id" | "status" | "createdAt" | "retryCount"
    >
  ): Promise<string>;

  /** Cancel background sync operation */
  cancelBackgroundSync(operationId: string): Promise<void>;

  /** Get sync operation status */
  getSyncStatus(operationId?: string): Promise<BackgroundSyncOperation[]>;

  /** Update service worker configuration */
  updateConfig(config: Partial<ServiceWorkerSyncConfig>): Promise<void>;

  /** Check service worker capabilities */
  getCapabilities(): Promise<ServiceWorkerCapabilities>;

  /** Get system resource status */
  getResourceStatus(): Promise<SystemResourceStatus>;

  /** Get background sync queue state */
  getQueueState(): Promise<BackgroundSyncQueueState>;

  /** Register for periodic sync */
  registerPeriodicSync(options: PeriodicSyncRegistrationOptions): Promise<void>;

  /** Unregister periodic sync */
  unregisterPeriodicSync(tag: string): Promise<void>;

  /** Event subscription */
  addEventListener(
    type: ServiceWorkerMessageType,
    listener: (message: AnyServiceWorkerMessage) => void
  ): void;
  removeEventListener(
    type: ServiceWorkerMessageType,
    listener: (message: AnyServiceWorkerMessage) => void
  ): void;

  /** Cleanup resources */
  destroy(): Promise<void>;
}

/**
 * Default service worker sync configuration
 */
const DEFAULT_SERVICE_WORKER_CONFIG: ServiceWorkerSyncConfig = {
  backgroundSyncEnabled: true,
  periodicSyncEnabled: true,
  periodicSyncInterval: 30, // 30 minutes
  maxBackgroundSyncDuration: 5 * 60 * 1000, // 5 minutes
  maxConcurrentOperations: 3,
  backgroundSyncDomains: ["music", "photos"],
  defaultRetryConfig: {
    maxRetries: 3,
    baseDelay: 1000, // 1 second
    backoffMultiplier: 2,
    maxDelay: 30000, // 30 seconds
    jitterFactor: 0.1,
  },
  networkConfig: {
    wifiOnly: false,
    allowCellular: true,
    allowMetered: false,
    pauseOnSlowConnection: true,
  },
  batteryConfig: {
    minBatteryLevel: 0.15, // 15%
    pauseOnLowBattery: true,
    pauseWhenNotCharging: false,
    reducedFrequencyOnBattery: true,
  },
};

// Export the configuration as a value
export { DEFAULT_SERVICE_WORKER_CONFIG };
