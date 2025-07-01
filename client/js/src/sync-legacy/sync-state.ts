//! Sync state management types and interfaces
//!
//! This module provides TypeScript types and classes for managing
//! client-side sync state, cursors, and timestamps that correspond
//! to the server-side sync API.

import { SyncStatus } from "./sync-constants.js";
import type {
  SyncRequest,
  SyncResponse,
  SyncPaginationMetadata,
  SyncCapabilities,
  SyncStatusResponse,
  FullSyncRequest,
  SyncProgress,
  SyncError,
  SyncConflict,
  ClientSyncState,
  SyncAcknowledgment,
  SyncConfig,
  SyncRecommendationsResponse,
} from "./sync-schemas.js";

// Re-export types for convenience
export type {
  SyncRequest,
  SyncResponse,
  SyncPaginationMetadata,
  SyncCapabilities,
  SyncStatusResponse,
  FullSyncRequest,
  SyncProgress,
  SyncError,
  SyncConflict,
  ClientSyncState,
  SyncAcknowledgment,
  SyncConfig,
  SyncRecommendationsResponse,
};

/**
 * Persistent sync state that survives browser restarts
 */
export class PersistentSyncState {
  private static readonly STORAGE_KEY = "webauthn_sync_state";

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
            data.status || "Never",
            data.lastCursor,
            new Date(data.updatedAt)
          );
        }
      }
    } catch (error) {
      console.warn("Failed to load sync state from localStorage:", error);
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
      localStorage.setItem(
        PersistentSyncState.STORAGE_KEY,
        JSON.stringify(data)
      );
    } catch (error) {
      console.warn("Failed to save sync state to localStorage:", error);
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
      state.last_cursor || undefined,
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
    return this.conflicts.filter((c) => !c.resolved);
  }

  /**
   * Get recoverable errors
   */
  getRecoverableErrors(): SyncError[] {
    return this.errors.filter((e) => e.recoverable !== false);
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
