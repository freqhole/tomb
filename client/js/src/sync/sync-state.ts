//! Sync state management types and interfaces
//!
//! This module provides TypeScript types and classes for managing
//! client-side sync state, cursors, and timestamps that correspond
//! to the server-side sync API.

/**
 * Media blob representation from sync API
 */
export interface MediaBlob {
  id: string;
  sha256: string;
  size: number | null;
  mime: string | null;
  source_client_id: string | null;
  local_path: string | null;
  metadata: Record<string, any>;
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp
  deleted_at: string | null; // ISO 8601 timestamp
  data: string | null; // Base64 encoded binary data (optional)
}

/**
 * Sync request parameters for incremental synchronization
 */
export interface SyncRequest {
  /** Last sync timestamp - only get items modified after this time */
  last_sync_time?: string; // ISO 8601 timestamp
  /** Pagination cursor for continuing a large sync operation */
  cursor?: string;
  /** Maximum number of items to return in this sync batch */
  page_size?: number;
  /** Client ID for tracking sync state per client */
  client_id: string;
  /** Whether to include binary data or just metadata */
  include_data?: boolean;
  /** Filter by specific MIME types */
  mime_types?: string[];
}

/**
 * Pagination metadata specific to sync operations
 */
export interface SyncPaginationMetadata {
  /** Number of items in this batch */
  batch_size: number;
  /** Whether there are more items to sync */
  has_more: boolean;
  /** Cursor for the next batch of sync items */
  next_cursor?: string;
  /** Estimated progress (0.0 to 1.0) if calculable */
  progress?: number;
  /** Suggested delay before next sync request (in seconds) */
  suggested_delay?: number;
}

/**
 * Sync response containing incremental updates
 */
export interface SyncResponse {
  /** Media blobs that have been added or modified since last sync */
  items: MediaBlob[];
  /** Pagination metadata for continuing the sync */
  pagination: SyncPaginationMetadata;
  /** Server timestamp when this sync response was generated */
  sync_timestamp: string; // ISO 8601 timestamp
  /** Whether this is a full sync (true) or incremental (false) */
  is_full_sync: boolean;
  /** Total number of items available for sync (if known) */
  total_items?: number;
}

/**
 * Synchronization status enumeration
 */
export enum SyncStatus {
  /** Client has never synced */
  Never = 'Never',
  /** Sync is currently in progress */
  InProgress = 'InProgress',
  /** Sync completed successfully */
  Complete = 'Complete',
  /** Sync failed with errors */
  Failed = 'Failed',
  /** Sync was paused/interrupted */
  Paused = 'Paused',
}

/**
 * Client synchronization state
 */
export interface ClientSyncState {
  /** Client identifier */
  client_id: string;
  /** Last successful sync timestamp */
  last_sync_time: string; // ISO 8601 timestamp
  /** Total number of items synced by this client */
  total_items_synced: number;
  /** Current sync status */
  status: SyncStatus;
  /** Last sync cursor position (for resuming interrupted syncs) */
  last_cursor?: string;
  /** Timestamp when this state was last updated */
  updated_at: string; // ISO 8601 timestamp
}

/**
 * Sync acknowledgment to confirm successful client sync
 */
export interface SyncAcknowledgment {
  /** Client ID acknowledging the sync */
  client_id: string;
  /** Timestamp of the sync that was successfully processed */
  sync_timestamp: string; // ISO 8601 timestamp
  /** Number of items successfully synced */
  items_synced: number;
  /** Any items that failed to sync (by ID) */
  failed_items: string[];
  /** Client's current sync state */
  client_sync_state: ClientSyncState;
}

/**
 * Server synchronization capabilities
 */
export interface SyncCapabilities {
  /** Maximum batch size supported */
  max_batch_size: number;
  /** Minimum sync interval in seconds */
  min_sync_interval: number;
  /** Supported MIME type filters */
  supported_mime_filters: string[];
  /** Whether incremental sync is supported */
  supports_incremental: boolean;
  /** Whether cursor-based pagination is supported */
  supports_cursors: boolean;
  /** Maximum client sync history retained (in days) */
  sync_history_retention_days: number;
}

/**
 * Sync status response for monitoring sync health
 */
export interface SyncStatusResponse {
  /** Current server timestamp */
  server_time: string; // ISO 8601 timestamp
  /** Number of active sync sessions */
  active_syncs: number;
  /** Total items available for sync */
  total_items: number;
  /** Last modification time in the system */
  last_modification?: string; // ISO 8601 timestamp
  /** Server sync capabilities */
  capabilities: SyncCapabilities;
}

/**
 * Full sync request for initial synchronization
 */
export interface FullSyncRequest {
  /** Client ID requesting full sync */
  client_id: string;
  /** Batch size for paginated full sync */
  batch_size?: number;
  /** Starting cursor (for resuming interrupted full sync) */
  start_cursor?: string;
  /** Whether to include binary data */
  include_data?: boolean;
  /** Filter by MIME types */
  mime_types?: string[];
}

/**
 * Sync progress information for UI updates
 */
export interface SyncProgress {
  /** Current sync status */
  status: SyncStatus;
  /** Items synced in current session */
  items_synced: number;
  /** Total items to sync (if known) */
  total_items?: number;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Current sync cursor */
  current_cursor?: string;
  /** Estimated time remaining in seconds */
  estimated_remaining_seconds?: number;
  /** Current batch being processed */
  current_batch?: number;
  /** Total batches (if known) */
  total_batches?: number;
}

/**
 * Sync error information
 */
export interface SyncError {
  /** Error type/code */
  type: string;
  /** Human-readable error message */
  message: string;
  /** Timestamp when error occurred */
  timestamp: string; // ISO 8601 timestamp
  /** Additional error context */
  context?: Record<string, any>;
  /** Whether this error is recoverable */
  recoverable?: boolean;
  /** Suggested retry delay in seconds */
  retry_delay?: number;
}

/**
 * Sync conflict information
 */
export interface SyncConflict {
  /** Unique identifier for this conflict */
  id: string;
  /** ID of the media blob in conflict */
  media_blob_id: string;
  /** Type of conflict */
  type: 'version' | 'deletion' | 'metadata';
  /** Local version of the item */
  local_version: MediaBlob;
  /** Server version of the item */
  server_version: MediaBlob;
  /** Timestamp when conflict was detected */
  detected_at: string; // ISO 8601 timestamp
  /** Whether conflict has been resolved */
  resolved: boolean;
  /** Resolution strategy if resolved */
  resolution?: 'keep_local' | 'keep_server' | 'merge' | 'skip';
}

/**
 * Persistent sync state that survives browser restarts
 */
export class PersistentSyncState {
  private static readonly STORAGE_KEY = 'webauthn_sync_state';

  constructor(
    public clientId: string,
    public lastSyncTime: Date = new Date(0),
    public totalItemsSynced: number = 0,
    public status: SyncStatus = SyncStatus.Never,
    public lastCursor?: string,
    public updatedAt: Date = new Date()
  ) {}

  /**
   * Load sync state from localStorage
   */
  static load(clientId: string): PersistentSyncState {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.clientId === clientId) {
          return new PersistentSyncState(
            data.clientId,
            new Date(data.lastSyncTime),
            data.totalItemsSynced || 0,
            data.status || SyncStatus.Never,
            data.lastCursor,
            new Date(data.updatedAt)
          );
        }
      }
    } catch (error) {
      console.warn('Failed to load sync state from localStorage:', error);
    }

    return new PersistentSyncState(clientId);
  }

  /**
   * Save sync state to localStorage
   */
  save(): void {
    try {
      const data = {
        clientId: this.clientId,
        lastSyncTime: this.lastSyncTime.toISOString(),
        totalItemsSynced: this.totalItemsSynced,
        status: this.status,
        lastCursor: this.lastCursor,
        updatedAt: this.updatedAt.toISOString(),
      };
      localStorage.setItem(PersistentSyncState.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('Failed to save sync state to localStorage:', error);
    }
  }

  /**
   * Update state after successful sync
   */
  updateAfterSync(
    syncTimestamp: Date,
    itemsSynced: number,
    cursor?: string
  ): void {
    this.lastSyncTime = syncTimestamp;
    this.totalItemsSynced += itemsSynced;
    const hasCursor = cursor !== undefined;
    this.lastCursor = cursor;
    this.status = hasCursor ? SyncStatus.InProgress : SyncStatus.Complete;
    this.updatedAt = new Date();
    this.save();
  }

  /**
   * Mark sync as failed
   */
  markFailed(): void {
    this.status = SyncStatus.Failed;
    this.updatedAt = new Date();
    this.save();
  }

  /**
   * Mark sync as paused
   */
  markPaused(): void {
    this.status = SyncStatus.Paused;
    this.updatedAt = new Date();
    this.save();
  }

  /**
   * Reset sync state (for full resync)
   */
  reset(): void {
    this.lastSyncTime = new Date(0);
    this.totalItemsSynced = 0;
    this.status = SyncStatus.Never;
    this.lastCursor = undefined;
    this.updatedAt = new Date();
    this.save();
  }

  /**
   * Check if sync is currently in progress
   */
  isInProgress(): boolean {
    return this.status === SyncStatus.InProgress;
  }

  /**
   * Get time since last sync in milliseconds
   */
  timeSinceLastSync(): number {
    return Date.now() - this.lastSyncTime.getTime();
  }

  /**
   * Convert to ClientSyncState for API calls
   */
  toClientSyncState(): ClientSyncState {
    return {
      client_id: this.clientId,
      last_sync_time: this.lastSyncTime.toISOString(),
      total_items_synced: this.totalItemsSynced,
      status: this.status,
      last_cursor: this.lastCursor,
      updated_at: this.updatedAt.toISOString(),
    };
  }

  /**
   * Create from ClientSyncState
   */
  static fromClientSyncState(state: ClientSyncState): PersistentSyncState {
    return new PersistentSyncState(
      state.client_id,
      new Date(state.last_sync_time),
      state.total_items_synced,
      state.status,
      state.last_cursor,
      new Date(state.updated_at)
    );
  }
}

/**
 * In-memory sync session state for active sync operations
 */
export class SyncSessionState {
  public startTime: Date = new Date();
  public currentBatch: number = 0;
  public itemsInCurrentSession: number = 0;
  public conflicts: SyncConflict[] = [];
  public errors: SyncError[] = [];

  constructor(
    public sessionId: string,
    public persistentState: PersistentSyncState
  ) {}

  /**
   * Add a conflict to the current session
   */
  addConflict(conflict: SyncConflict): void {
    this.conflicts.push(conflict);
  }

  /**
   * Add an error to the current session
   */
  addError(error: SyncError): void {
    this.errors.push(error);
  }

  /**
   * Get session duration in milliseconds
   */
  getSessionDuration(): number {
    return Date.now() - this.startTime.getTime();
  }

  /**
   * Get unresolved conflicts
   */
  getUnresolvedConflicts(): SyncConflict[] {
    return this.conflicts.filter(c => !c.resolved);
  }

  /**
   * Get recoverable errors
   */
  getRecoverableErrors(): SyncError[] {
    return this.errors.filter(e => e.recoverable !== false);
  }

  /**
   * Clear session state (but keep persistent state)
   */
  clear(): void {
    this.currentBatch = 0;
    this.itemsInCurrentSession = 0;
    this.conflicts = [];
    this.errors = [];
    this.startTime = new Date();
  }
}
