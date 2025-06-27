//! Sync module exports
//!
//! This module provides a unified interface for all sync-related functionality,
//! including the core sync manager, state management, events, and storage.

// Phase 4.3 Core Sync Engine
export { CoreSyncEngine, createSyncEngine } from "./core-sync-engine.js";
export type { SyncOptions } from "./core-sync-engine.js";

// Legacy sync manager (deprecated - use CoreSyncEngine instead)
export { SyncManager, createSyncManager } from "./sync-manager.js";
export type { SyncManagerConfig } from "./sync-manager.js";

// Zod schemas and validated types
export {
  validateSyncConfig,
  validateSyncRequest,
  validateSyncProgress,
  safeParseSyncResponse,
  safeParseSyncStatus,
  safeParseSyncRecommendations,
  isSyncError,
  isSyncConflict,
  isSyncProgress,
  SyncStatusEnum,
} from "./sync-schemas.js";
export type {
  SyncRequest,
  SyncResponse,
  SyncProgress,
  SyncError,
  SyncConflict,
  ClientSyncState,
  SyncCapabilities,
  FullSyncRequest,
  SyncAcknowledgment,
  SyncPaginationMetadata,
  SyncConfig,
  SyncRecommendationsResponse,
  SyncStatusResponse,
  IncrementalSyncQuery,
  FullSyncQuery,
  SyncAckRequest,
} from "./sync-schemas.js";

// State management classes
export { PersistentSyncState, SyncSessionState } from "./sync-state.js";

// Constants and enums
export {
  SyncStatus,
  SyncEventType,
  ConflictResolution,
  SyncConflictType,
  SyncPriority,
  OfflineOperationType,
  ConnectionState,
  isActiveSyncStatus,
  isCompletedSyncStatus,
  isErrorSyncStatus,
  canStartSync,
  canPauseSync,
  canResumeSync,
  getSyncStatusDisplayText,
  getSyncStatusClassName,
} from "./sync-constants.js";

// Type exports for component usage - using the names components expect
export type { SyncStatus as SyncStatusType } from "./sync-constants.js";

// Event system
export {
  SyncEventEmitter,
  SyncEventBuilder,
  createSyncEventSystem,
} from "./sync-events.js";
export type {
  SyncEvent,
  SyncEventListener,
  BaseSyncEvent,
  SyncStartedEvent,
  SyncProgressEvent,
  SyncBatchCompletedEvent,
  SyncCompletedEvent,
  SyncFailedEvent,
  SyncPausedEvent,
  SyncResumedEvent,
  SyncConflictEvent,
  SyncConflictResolvedEvent,
  ConnectionChangedEvent,
  ItemsReceivedEvent,
  ItemsProcessedEvent,
} from "./sync-events.js";

// Storage management
export { SyncStorageManager } from "./sync-storage.js";
export type {
  StoredMediaBlob,
  OfflineOperation,
  StorageStats,
  StorageConfig,
  StorageQueryOptions,
} from "./sync-storage.js";

// Schema validation utilities
export * from "./sync-schemas.js";

// Re-export MediaBlob from correct location
export type { MediaBlob } from "../lib/websocket-types.js";
