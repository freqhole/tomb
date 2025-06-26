//! Sync module exports
//!
//! This module provides a unified interface for all sync-related functionality,
//! including the core sync manager, state management, events, and storage.

// Core sync manager
export { SyncManager, createSyncManager } from "./sync-manager.js";
export type { SyncManagerConfig, SyncOptions } from "./sync-manager.js";

// State management types and classes
export {
  SyncStatus,
  PersistentSyncState,
  SyncSessionState,
} from "./sync-state.js";
export type {
  MediaBlob,
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
} from "./sync-state.js";

// Event system
export {
  SyncEventType,
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
export { SyncStorageManager, OfflineOperationType } from "./sync-storage.js";
export type {
  StoredMediaBlob,
  OfflineOperation,
  StorageStats,
  StorageConfig,
  StorageQueryOptions,
} from "./sync-storage.js";
