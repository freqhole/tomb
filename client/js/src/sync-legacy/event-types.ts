//! Event types for MediaBlobSync client
//!
//! This module provides type-safe event handling interfaces for the sync client.

import { SyncProgress, SyncError, SyncConflict } from "./sync-schemas.js";
import type { MediaBlob } from "../lib/websocket-types.js";

/**
 * Sync status information
 */
export interface SyncStatus {
  /** Current sync state */
  state: "never" | "idle" | "syncing" | "paused" | "failed";
  /** Progress information (if syncing) */
  progress?: SyncProgress;
  /** Last sync timestamp */
  lastSync?: Date;
  /** Number of items synced in total */
  totalItemsSynced: number;
  /** Current conflicts (if any) */
  conflicts: SyncConflict[];
  /** Connection status */
  online: boolean;
}

/**
 * Event map for type-safe event handling
 */
export interface SyncEventMap {
  initialized: (event: CustomEvent) => void;
  "sync-started": (event: CustomEvent) => void;
  "sync-completed": (event: CustomEvent) => void;
  "sync-failed": (event: CustomEvent<Error>) => void;
  "sync-paused": (event: CustomEvent) => void;
  "sync-resumed": (event: CustomEvent) => void;
  progress: (event: CustomEvent<SyncProgress>) => void;
  conflict: (event: CustomEvent<SyncConflict>) => void;
  "conflict-resolved": (
    event: CustomEvent<{ conflictId: string; resolution: string }>
  ) => void;
  error: (event: CustomEvent<SyncError>) => void;
  "items-received": (event: CustomEvent<MediaBlob[]>) => void;
  "realtime-update": (event: CustomEvent<any>) => void;
  "connection-changed": (event: CustomEvent<{ online: boolean }>) => void;
  "status-changed": (event: CustomEvent<SyncStatus>) => void;
}
