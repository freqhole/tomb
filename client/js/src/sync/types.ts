//! Unified Sync System - Core Types
//!
//! This module defines the foundational types for the new unified sync system.
//! It supports multiple domains (music, photos, documents, etc.) with a single
//! consistent interface while maintaining extensibility for future domains.

// Import types that are actually used
import type { NotificationChannel } from "../lib/websocket-types.js";
// import type { MediaBlob, Song, Playlist, PlaylistSong } from "../lib/websocket-types.js";

/**
 * Supported sync domains - extensible for future content types
 */
export type SyncDomain = "music" | "photos" | "documents" | "videos";

/**
 * Sync operation status
 */
export enum SyncStatus {
  Never = "never",
  InProgress = "in_progress",
  Complete = "complete",
  Failed = "failed",
  Paused = "paused",
}

/**
 * Core unified sync manager interface
 */
export interface UnifiedSyncManager {
  /**
   * Sync all domains or specific domains
   */
  syncAll(options?: SyncAllOptions): Promise<SyncResult>;

  /**
   * Sync a specific domain
   */
  syncDomain(
    domain: SyncDomain,
    options?: SyncDomainOptions
  ): Promise<SyncResult>;

  /**
   * Get a blob URL for media content (with caching)
   */
  getBlobUrl(blobId: string): Promise<string | null>;

  /**
   * Get media blobs for image display
   */
  getMediaBlobs(): Promise<any[]>;

  /**
   * Check if binary data exists for a blob ID
   */
  hasBinaryData(blobId: string): Promise<boolean>;

  /**
   * Enable/disable auto-sync based on WebSocket notifications
   */
  enableAutoSync(enabled: boolean): void;

  /**
   * Get current sync status for all domains
   */
  getStatus(): SyncStatusMap;

  /**
   * Get sync progress for active operations
   */
  getProgress(): SyncProgressMap;

  /**
   * Get storage statistics
   */
  getStorageStats(): Promise<StorageStats>;

  /**
   * Get music domain breakdown
   */
  getMusicBreakdown(): Promise<{
    songs: number;
    playlists: number;
    playlistSongs: number;
  }>;

  /**
   * Get photos domain breakdown
   */
  getPhotosBreakdown(): Promise<{
    photos: number;
    galleries: number;
    photoGalleries: number;
  }>;

  /**
   * Event subscription for sync events
   */
  on(event: SyncEventType, listener: SyncEventListener): void;
  off(event: SyncEventType, listener: SyncEventListener): void;

  /**
   * Initialize the sync manager
   */
  initialize(): Promise<void>;

  /**
   * Cleanup resources
   */
  destroy(): Promise<void>;

  /**
   * Service worker integration (if available)
   */
  getServiceWorkerSyncManager?(): Promise<any>;
}

/**
 * Options for syncing all domains
 */
export interface SyncAllOptions {
  /** Specific domains to sync (default: all) */
  domains?: SyncDomain[];
  /** Force full sync instead of incremental */
  forceFullSync?: boolean;
  /** Include binary data sync */
  includeBinaryData?: boolean;
  /** Include media blob metadata sync */
  include_media_blobs?: boolean;
  /** Priority order for domains */
  priorityOrder?: SyncDomain[];
}

/**
 * Options for syncing a specific domain
 */
export interface SyncDomainOptions {
  /** Force full sync instead of incremental */
  forceFullSync?: boolean;
  /** Include binary data sync */
  includeBinaryData?: boolean;
  /** Include media blob metadata sync */
  include_media_blobs?: boolean;
  /** Page size for batch operations */
  pageSize?: number;
  /** Maximum items to sync */
  maxItems?: number;
  /** Last sync timestamp for incremental sync */
  lastSyncTime?: string;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Domain that was synced */
  domain: SyncDomain;
  /** Final status */
  status: SyncStatus;
  /** Items successfully synced */
  itemsSynced: number;
  /** Total items available */
  totalItems: number;
  /** Duration in milliseconds */
  duration: number;
  /** Binary data statistics */
  binaryStats?: BinarySyncStats;
  /** Any errors encountered */
  errors: SyncError[];
  /** Detailed breakdown for music domain */
  breakdown?: MusicSyncBreakdown;
}

/**
 * Music sync breakdown for detailed reporting
 */
export interface MusicSyncBreakdown {
  /** Songs sync results */
  songs: { itemsSynced: number; totalItems: number };
  /** Playlists sync results */
  playlists: { itemsSynced: number; totalItems: number };
  /** Playlist songs sync results */
  playlistSongs: { itemsSynced: number; totalItems: number };
  /** Media blobs sync results */
  mediaBlobs: { itemsSynced: number; totalItems: number };
  /** Total items across all music data types */
  totalAll: number;
}

export interface PhotosSyncBreakdown {
  /** Photos sync results */
  photos: { itemsSynced: number; totalItems: number };
  /** Galleries sync results */
  galleries: { itemsSynced: number; totalItems: number };
  /** Photo galleries sync results */
  photoGalleries: { itemsSynced: number; totalItems: number };
  /** Media blobs sync results */
  mediaBlobs: { itemsSynced: number; totalItems: number };
  /** Total items across all photos data types */
  totalAll: number;
}

/**
 * Binary sync statistics
 */
export interface BinarySyncStats {
  /** Number of blobs cached */
  cached: number;
  /** Number of blobs skipped (already cached) */
  skipped: number;
  /** Number of blobs that failed */
  failed: number;
  /** Total bytes downloaded */
  bytesDownloaded: number;
}

/**
 * Sync error information
 */
export interface SyncError {
  /** Error code */
  code: string;
  /** Human-readable message */
  message: string;
  /** Item ID that caused the error */
  itemId?: string;
  /** Original error details */
  details?: any;
}

/**
 * Map of sync status by domain
 */
export type SyncStatusMap = Record<SyncDomain, SyncStatus>;

/**
 * Map of sync progress by domain
 */
export type SyncProgressMap = Record<SyncDomain, SyncProgress>;

/**
 * Sync progress information
 */
export interface SyncProgress {
  /** Current status */
  status: SyncStatus;
  /** Progress percentage (0-100) */
  progress: number;
  /** Items processed so far */
  itemsProcessed: number;
  /** Total items to process */
  totalItems: number;
  /** Current batch number */
  currentBatch: number;
  /** Total batches */
  totalBatches: number;
  /** Estimated time remaining (seconds) */
  eta?: number;
  /** Current operation description */
  currentOperation?: string;
}

/**
 * Sync event types
 */
export enum SyncEventType {
  Started = "started",
  Progress = "progress",
  DomainCompleted = "domain_completed",
  AllCompleted = "all_completed",
  Failed = "failed",
  Paused = "paused",
  Resumed = "resumed",
  BinaryProgress = "binary_progress",
  AutoSyncTriggered = "auto_sync_triggered",
  ConnectionChanged = "connection_changed",
}

/**
 * Base sync event
 */
export interface SyncEvent {
  type: SyncEventType;
  timestamp: Date;
  domain?: SyncDomain;
}

/**
 * Sync started event
 */
export interface SyncStartedEvent extends SyncEvent {
  type: SyncEventType.Started;
  domain: SyncDomain;
  isFullSync: boolean;
  estimatedItems?: number;
}

/**
 * Sync progress event
 */
export interface SyncProgressEvent extends SyncEvent {
  type: SyncEventType.Progress;
  domain: SyncDomain;
  progress: SyncProgress;
}

/**
 * Sync completed event
 */
export interface SyncCompletedEvent extends SyncEvent {
  type: SyncEventType.DomainCompleted | SyncEventType.AllCompleted;
  result: SyncResult;
}

/**
 * Sync failed event
 */
export interface SyncFailedEvent extends SyncEvent {
  type: SyncEventType.Failed;
  domain: SyncDomain;
  error: SyncError;
}

/**
 * Binary sync progress event
 */
export interface BinarySyncProgressEvent extends SyncEvent {
  type: SyncEventType.BinaryProgress;
  domain: SyncDomain;
  blobId: string;
  progress: number; // 0-100
  currentItem: number;
  totalItems: number;
}

/**
 * Auto-sync triggered event
 */
export interface AutoSyncTriggeredEvent extends SyncEvent {
  type: SyncEventType.AutoSyncTriggered;
  domain: SyncDomain;
  trigger: "new_content" | "periodic" | "manual";
  itemCount?: number;
}

/**
 * Connection changed event
 */
export interface ConnectionChangedEvent extends SyncEvent {
  type: SyncEventType.ConnectionChanged;
  isOnline: boolean;
  connectionType?: "websocket" | "http" | "offline";
}

/**
 * Union of all sync events
 */
export type AnySyncEvent =
  | SyncStartedEvent
  | SyncProgressEvent
  | SyncCompletedEvent
  | SyncFailedEvent
  | BinarySyncProgressEvent
  | AutoSyncTriggeredEvent
  | ConnectionChangedEvent;

/**
 * Sync event listener function
 */
export type SyncEventListener = (event: AnySyncEvent) => void;

/**
 * Domain configuration for sync operations
 */
export interface DomainConfig {
  /** Domain identifier */
  domain: SyncDomain;
  /** API endpoints for this domain */
  endpoints: DomainEndpoints;
  /** Default sync options */
  defaultOptions: SyncDomainOptions;
  /** Binary data configuration */
  binaryConfig?: BinaryConfig;
  /** Data transformation functions */
  transforms: DataTransforms;
}

/**
 * API endpoints for a domain
 */
export interface DomainEndpoints {
  /** List/query endpoint */
  list: string;
  /** Individual item endpoint */
  item: string;
  /** Sync metadata endpoint */
  sync: string;
  /** Binary data endpoint */
  binary?: string;
}

/**
 * Binary data configuration
 */
export interface BinaryConfig {
  /** MIME types to prioritize */
  priorityMimeTypes: string[];
  /** Maximum file size to cache */
  maxFileSize: number;
  /** Batch size for binary operations */
  batchSize: number;
}

/**
 * Data transformation functions for a domain
 */
export interface DataTransforms {
  /** Transform API response to internal format */
  fromApi: (data: any) => any;
  /** Transform internal format to storage format */
  toStorage: (data: any) => any;
  /** Transform storage format to internal format */
  fromStorage: (data: any) => any;
}

/**
 * Legacy WebSocket notification payload
 */
export interface LegacyWebSocketNotification {
  type: "new_content" | "content_updated" | "content_deleted";
  domain: SyncDomain;
  itemIds: string[];
  timestamp: string;
  metadata?: any;
}

/**
 * Unified storage interface
 */
export interface UnifiedStorage {
  /** Initialize storage */
  initialize(): Promise<void>;

  /** Store items for a domain */
  storeItems(domain: SyncDomain, items: any[]): Promise<void>;

  /** Store items directly to a specific table */
  storeItemsToTable(tableName: string, items: any[]): Promise<void>;

  /** Get items from a domain */
  getItems(domain: SyncDomain, options?: StorageQueryOptions): Promise<any[]>;

  /** Get single item */
  getItem(domain: SyncDomain, id: string): Promise<any | null>;

  /** Delete items */
  deleteItems(domain: SyncDomain, ids: string[]): Promise<void>;

  /** Clear all data for a domain */
  clearDomain(domain: SyncDomain): Promise<void>;

  /** Get storage statistics */
  getStats(): Promise<StorageStats>;

  /** Save sync completion state */
  saveSyncCompletion(domain: SyncDomain, itemsSynced: number): Promise<void>;

  /** Get detailed music domain breakdown */
  getMusicBreakdown(): Promise<{
    songs: number;
    playlists: number;
    playlistSongs: number;
  }>;

  /** Get detailed photos domain breakdown */
  getPhotosBreakdown(): Promise<{
    photos: number;
    galleries: number;
    photoGalleries: number;
  }>;

  /** Binary data operations (simple blob ID -> ArrayBuffer storage as per plan) */
  storeBinaryData(blobId: string, data: ArrayBuffer): Promise<void>;
  getBinaryData(blobId: string): Promise<ArrayBuffer | null>;
  deleteBinaryData(blobId: string): Promise<void>;

  /** Cleanup old data */
  cleanup(): Promise<void>;

  /** Completely destroy all data and database */
  destroyAll(): Promise<void>;
}

/**
 * Storage query options
 */
export interface StorageQueryOptions {
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort field */
  sortBy?: string;
  /** Sort direction */
  sortOrder?: "asc" | "desc";
  /** Filter conditions */
  where?: Record<string, any>;
}

/**
 * Storage statistics
 */
export interface StorageStats {
  /** Total items by domain */
  itemCounts: Record<SyncDomain, number>;
  /** Total storage size in bytes */
  totalSize: number;
  /** Binary data size in bytes */
  binarySize: number;
  /** Last sync timestamps by domain */
  lastSyncTimes: Record<SyncDomain, Date | null>;
}

/**
 * Binary data metadata
 */
export interface BinaryMetadata {
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Original filename */
  filename?: string;
  /** Download timestamp */
  downloadedAt: Date;
  /** Associated blob ID */
  blobId: string;
}

/**
 * Service worker configuration
 */
export interface ServiceWorkerConfig {
  /** Enable service worker sync */
  enabled: boolean;
  /** Background sync interval (minutes) */
  backgroundSyncInterval: number;
  /** Maximum background sync duration */
  maxBackgroundSyncDuration: number;
  /** Domains to sync in background */
  backgroundDomains: SyncDomain[];
}

/**
 * Unified sync manager configuration
 */
export interface UnifiedSyncConfig {
  /** API base URL */
  apiBaseUrl: string;
  /** WebSocket URL */
  websocketUrl: string;
  /** Client identifier */
  clientId: string;
  /** Authentication token */
  authToken?: string;
  /** Domain configurations */
  domains: Record<SyncDomain, DomainConfig>;
  /** Storage configuration */
  storage: StorageConfig;
  /** Auto-sync settings */
  autoSync: AutoSyncConfig;
  /** Default sync options */
  defaultSyncOptions: SyncAllOptions;
  /** Service worker configuration */
  serviceWorker?: ServiceWorkerSyncConfig;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Database name */
  databaseName: string;
  /** Database version */
  version: number;
  /** Maximum storage size in bytes */
  maxSize: number;
  /** Maximum age for cached data (days) */
  maxAge: number;
}

/**
 * Auto-sync configuration
 */
export interface AutoSyncConfig {
  /** Enable auto-sync */
  enabled: boolean;
  /** Sync when new content notifications arrive */
  syncOnNewContent: boolean;
  /** Periodic sync interval in minutes */
  periodicInterval: number;
  /** Domains to auto-sync */
  domains: SyncDomain[];
  /** Debounce delay for notification batching (ms) */
  debounceDelay: number;
}

/**
 * Auto-sync trigger types
 */
export type AutoSyncTrigger =
  | "scheduled"
  | "notification-immediate"
  | "notification-batched"
  | "connection-restored"
  | "manual"
  | "periodic";

/**
 * WebSocket notification structure for auto-sync
 */
export interface WebSocketNotification {
  /** Unique notification ID */
  id: string;
  /** Notification channel */
  channel: NotificationChannel;
  /** Event type identifier */
  eventType: string;
  /** Optional payload data */
  payload?: any;
  /** Priority level */
  priority: string;
  /** Timestamp */
  timestamp: string;
}

/**
 * WebSocket notification payload (legacy - kept for backward compatibility)
 */
export interface LegacyWebSocketNotification {
  type: "new_content" | "content_updated" | "content_deleted";
  domain: SyncDomain;
  itemIds: string[];
  timestamp: string;
  metadata?: any;
}

/**
 * Auto-sync rule for advanced scheduling and conditions
 */
export interface AutoSyncRule {
  /** Unique rule identifier */
  id: string;
  /** Human-readable rule name */
  name: string;
  /** Target domains for this rule */
  domains: SyncDomain[];
  /** Rule trigger type */
  trigger?: AutoSyncTrigger;
  /** Schedule configuration */
  schedule?: AutoSyncSchedule;
  /** Rule conditions */
  conditions?: AutoSyncConditions;
  /** Rule priority (0-100) */
  priority: number;
  /** Rule enabled state */
  enabled: boolean;
  /** Rule description */
  description?: string;
}

/**
 * Auto-sync schedule configuration
 */
export interface AutoSyncSchedule {
  /** Schedule type */
  type: "periodic" | "daily" | "weekly" | "cron";
  /** Interval in milliseconds (for periodic) */
  interval?: number;
  /** Time in HH:MM format (for daily/weekly) */
  time?: string;
  /** Day of week 0-6 (for weekly) */
  dayOfWeek?: number;
  /** Cron expression (for cron) */
  cronExpression?: string;
}

/**
 * Auto-sync rule conditions
 */
export interface AutoSyncConditions {
  /** Minimum battery level (0-1) */
  minBatteryLevel?: number;
  /** Allowed connection types */
  allowedConnectionTypes?: string[];
  /** Maximum memory usage percentage */
  maxMemoryUsage?: number;
  /** Notification priorities to match */
  notificationPriorities?: string[];
  /** Prefer background sync */
  preferBackground?: boolean;
}

/**
 * Notification-based sync rule
 */
export interface NotificationSyncRule {
  /** Unique rule identifier */
  id: string;
  /** Rule description */
  description?: string;
  /** Notification channels to monitor */
  channels?: NotificationChannel[];
  /** Event types to match */
  eventTypes?: string[];
  /** Priority levels to match */
  priorities?: string[];
  /** Target domains for sync */
  targetDomains: SyncDomain[];
  /** Payload conditions to match */
  payloadConditions?: Record<string, any>;
}

/**
 * Auto-sync statistics
 */
export interface AutoSyncStats {
  /** Total syncs triggered */
  totalSyncsTriggered: number;
  /** Rule-based triggers */
  ruleBasedTriggers: number;
  /** Scheduled triggers */
  scheduledTriggers: number;
  /** Notification triggers */
  notificationTriggers: number;
  /** Background syncs */
  backgroundSyncs: number;
  /** Failed syncs */
  failedSyncs: number;
  /** Last activity timestamp */
  lastActivity: Date;
  /** Per-domain statistics */
  domainStats: Map<
    SyncDomain,
    {
      syncsTriggered: number;
      lastSync: Date | null;
      averageInterval: number;
      failureCount: number;
    }
  >;
  /** Resource optimizations applied */
  resourceOptimizations: number;
}

/**
 * Service worker sync configuration
 */
export interface ServiceWorkerSyncConfig {
  /** Enable service worker background sync */
  enabled: boolean;
  /** Background sync interval (minutes) */
  backgroundSyncInterval: number;
  /** Maximum background sync duration */
  maxBackgroundSyncDuration: number;
  /** Domains to sync in background */
  backgroundDomains: SyncDomain[];
  /** Enable periodic sync */
  enablePeriodicSync: boolean;
  /** Periodic sync interval (minutes) */
  periodicSyncInterval: number;
}
