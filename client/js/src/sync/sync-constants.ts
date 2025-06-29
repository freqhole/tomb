//! Sync constants and enums
//!
//! This module provides runtime constants that work with both TypeScript
//! type checking and Zod validation. This replaces the problematic mixing
//! of Zod enums with TypeScript enum usage patterns.

import { z } from "zod";

/**
 * Sync status values as a const object - provides both runtime access
 * and type inference without the complexity of TypeScript enums
 */
export const SyncStatus = {
  Never: "Never",
  Idle: "Idle",
  InProgress: "InProgress",
  Syncing: "Syncing",
  Complete: "Complete",
  Failed: "Failed",
  Error: "Error",
  Paused: "Paused",
} as const;

/**
 * Type-safe sync status type derived from the const object
 */
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

/**
 * Zod schema for sync status validation - uses the same values
 */
export const SyncStatusSchema = z.enum([
  SyncStatus.Never,
  SyncStatus.Idle,
  SyncStatus.InProgress,
  SyncStatus.Syncing,
  SyncStatus.Complete,
  SyncStatus.Failed,
  SyncStatus.Error,
  SyncStatus.Paused,
]);

/**
 * Sync event types as constants
 */
export const SyncEventType = {
  Started: "sync:started",
  Progress: "sync:progress",
  BatchCompleted: "sync:batch-completed",
  Completed: "sync:completed",
  Failed: "sync:failed",
  Paused: "sync:paused",
  Resumed: "sync:resumed",
  ConflictDetected: "sync:conflict-detected",
  ConflictResolved: "sync:conflict-resolved",
  ConnectionChanged: "sync:connection-changed",
  ItemsReceived: "sync:items-received",
  ItemsProcessed: "sync:items-processed",
} as const;

export type SyncEventType = (typeof SyncEventType)[keyof typeof SyncEventType];

/**
 * Conflict resolution strategies
 */
export const ConflictResolution = {
  Manual: "manual",
  LocalWins: "keep_local",
  RemoteWins: "keep_server",
  Merge: "merge",
  Skip: "skip",
} as const;

export type ConflictResolution =
  (typeof ConflictResolution)[keyof typeof ConflictResolution];

/**
 * Sync conflict types
 */
export const SyncConflictType = {
  Version: "version",
  Deletion: "deletion",
  Metadata: "metadata",
} as const;

export type SyncConflictType =
  (typeof SyncConflictType)[keyof typeof SyncConflictType];

/**
 * Sync priority levels
 */
export const SyncPriority = {
  Low: "low",
  Normal: "normal",
  High: "high",
  Urgent: "urgent",
} as const;

export type SyncPriority = (typeof SyncPriority)[keyof typeof SyncPriority];

/**
 * Offline operation types
 */
export const OfflineOperationType = {
  Create: "create",
  Update: "update",
  Delete: "delete",
} as const;

export type OfflineOperationType =
  (typeof OfflineOperationType)[keyof typeof OfflineOperationType];

/**
 * Connection states
 */
export const ConnectionState = {
  Disconnected: "disconnected",
  Connecting: "connecting",
  Connected: "connected",
  Reconnecting: "reconnecting",
  Failed: "failed",
} as const;

export type ConnectionState =
  (typeof ConnectionState)[keyof typeof ConnectionState];

/**
 * Utility functions for working with sync constants
 */

/**
 * Check if a sync status indicates an active operation
 */
export function isActiveSyncStatus(status: SyncStatus): boolean {
  return status === SyncStatus.InProgress || status === SyncStatus.Syncing;
}

/**
 * Check if a sync status indicates completion
 */
export function isCompletedSyncStatus(status: SyncStatus): boolean {
  return status === SyncStatus.Complete;
}

/**
 * Check if a sync status indicates an error state
 */
export function isErrorSyncStatus(status: SyncStatus): boolean {
  return status === SyncStatus.Failed || status === SyncStatus.Error;
}

/**
 * Check if a sync status allows starting a new sync
 */
export function canStartSync(status: SyncStatus): boolean {
  return status !== SyncStatus.InProgress && status !== SyncStatus.Syncing;
}

/**
 * Check if a sync can be paused
 */
export function canPauseSync(status: SyncStatus): boolean {
  return status === SyncStatus.InProgress || status === SyncStatus.Syncing;
}

/**
 * Check if a sync can be resumed
 */
export function canResumeSync(status: SyncStatus): boolean {
  return status === SyncStatus.Paused;
}

/**
 * Get user-friendly display text for sync status
 */
export function getSyncStatusDisplayText(status: SyncStatus): string {
  switch (status) {
    case SyncStatus.Never:
      return "Not synced";
    case SyncStatus.Idle:
      return "Ready";
    case SyncStatus.InProgress:
      return "Syncing...";
    case SyncStatus.Syncing:
      return "Syncing...";
    case SyncStatus.Complete:
      return "Up to date";
    case SyncStatus.Failed:
      return "Sync failed";
    case SyncStatus.Error:
      return "Error";
    case SyncStatus.Paused:
      return "Sync paused";
    default:
      return "Unknown";
  }
}

/**
 * Get CSS class name for sync status styling
 */
export function getSyncStatusClassName(status: SyncStatus): string {
  switch (status) {
    case SyncStatus.Never:
      return "sync-status-never";
    case SyncStatus.Idle:
      return "sync-status-idle";
    case SyncStatus.InProgress:
      return "sync-status-in-progress";
    case SyncStatus.Syncing:
      return "sync-status-syncing";
    case SyncStatus.Complete:
      return "sync-status-complete";
    case SyncStatus.Failed:
      return "sync-status-failed";
    case SyncStatus.Error:
      return "sync-status-error";
    case SyncStatus.Paused:
      return "sync-status-paused";
    default:
      return "sync-status-unknown";
  }
}
