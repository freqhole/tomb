//! Sync events system for progress tracking and UI updates
//!
//! This module provides a comprehensive event system for sync operations,
//! allowing UI components and other parts of the application to react
//! to sync state changes, progress updates, and errors.

import {
  SyncProgress,
  SyncError,
  SyncConflict,
  MediaBlob,
} from "./sync-state.js";

/**
 * Event types for sync operations
 */
export enum SyncEventType {
  /** Sync operation started */
  SyncStarted = "sync:started",
  /** Sync progress updated */
  SyncProgress = "sync:progress",
  /** Sync batch completed */
  SyncBatchCompleted = "sync:batch-completed",
  /** Sync operation completed successfully */
  SyncCompleted = "sync:completed",
  /** Sync operation failed */
  SyncFailed = "sync:failed",
  /** Sync operation paused */
  SyncPaused = "sync:paused",
  /** Sync operation resumed */
  SyncResumed = "sync:resumed",
  /** Sync conflict detected */
  SyncConflict = "sync:conflict",
  /** Sync conflict resolved */
  SyncConflictResolved = "sync:conflict-resolved",
  /** Connection status changed */
  ConnectionChanged = "sync:connection-changed",
  /** Items received from sync */
  ItemsReceived = "sync:items-received",
  /** Items processed locally */
  ItemsProcessed = "sync:items-processed",
}

/**
 * Base sync event interface
 */
export interface BaseSyncEvent {
  type: SyncEventType;
  timestamp: Date;
  sessionId: string;
  clientId: string;
}

/**
 * Sync started event
 */
export interface SyncStartedEvent extends BaseSyncEvent {
  type: SyncEventType.SyncStarted;
  isFullSync: boolean;
  estimatedItems?: number;
}

/**
 * Sync progress event
 */
export interface SyncProgressEvent extends BaseSyncEvent {
  type: SyncEventType.SyncProgress;
  progress: SyncProgress;
}

/**
 * Sync batch completed event
 */
export interface SyncBatchCompletedEvent extends BaseSyncEvent {
  type: SyncEventType.SyncBatchCompleted;
  batchNumber: number;
  itemsInBatch: number;
  cursor?: string;
  hasMore: boolean;
}

/**
 * Sync completed event
 */
export interface SyncCompletedEvent extends BaseSyncEvent {
  type: SyncEventType.SyncCompleted;
  totalItems: number;
  duration: number; // milliseconds
  conflictsResolved: number;
}

/**
 * Sync failed event
 */
export interface SyncFailedEvent extends BaseSyncEvent {
  type: SyncEventType.SyncFailed;
  error: SyncError;
  canRetry: boolean;
  retryDelay?: number; // seconds
}

/**
 * Sync paused event
 */
export interface SyncPausedEvent extends BaseSyncEvent {
  type: SyncEventType.SyncPaused;
  reason: "user" | "error" | "network" | "rate-limit";
  canResume: boolean;
}

/**
 * Sync resumed event
 */
export interface SyncResumedEvent extends BaseSyncEvent {
  type: SyncEventType.SyncResumed;
  resumeFromCursor?: string;
}

/**
 * Sync conflict event
 */
export interface SyncConflictEvent extends BaseSyncEvent {
  type: SyncEventType.SyncConflict;
  conflict: SyncConflict;
}

/**
 * Sync conflict resolved event
 */
export interface SyncConflictResolvedEvent extends BaseSyncEvent {
  type: SyncEventType.SyncConflictResolved;
  conflictId: string;
  resolution: "keep_local" | "keep_server" | "merge" | "skip";
}

/**
 * Connection status changed event
 */
export interface ConnectionChangedEvent extends BaseSyncEvent {
  type: SyncEventType.ConnectionChanged;
  isOnline: boolean;
  canSync: boolean;
}

/**
 * Items received event
 */
export interface ItemsReceivedEvent extends BaseSyncEvent {
  type: SyncEventType.ItemsReceived;
  items: MediaBlob[];
  batchNumber: number;
  totalReceived: number;
}

/**
 * Items processed event
 */
export interface ItemsProcessedEvent extends BaseSyncEvent {
  type: SyncEventType.ItemsProcessed;
  processedCount: number;
  failedCount: number;
  totalProcessed: number;
}

/**
 * Union type for all sync events
 */
export type SyncEvent =
  | SyncStartedEvent
  | SyncProgressEvent
  | SyncBatchCompletedEvent
  | SyncCompletedEvent
  | SyncFailedEvent
  | SyncPausedEvent
  | SyncResumedEvent
  | SyncConflictEvent
  | SyncConflictResolvedEvent
  | ConnectionChangedEvent
  | ItemsReceivedEvent
  | ItemsProcessedEvent;

/**
 * Event listener function type
 */
export type SyncEventListener<T extends SyncEvent = SyncEvent> = (
  event: T
) => void;

/**
 * Event listener with type filtering
 */
export interface TypedSyncEventListener<T extends SyncEventType> {
  type: T;
  listener: SyncEventListener<Extract<SyncEvent, { type: T }>>;
}

/**
 * Sync event emitter for managing sync-related events
 */
export class SyncEventEmitter {
  private listeners: Map<SyncEventType, Set<SyncEventListener>> = new Map();
  private globalListeners: Set<SyncEventListener> = new Set();
  private eventHistory: SyncEvent[] = [];
  private maxHistorySize: number = 100;

  /**
   * Add event listener for specific event type
   */
  on<T extends SyncEventType>(
    eventType: T,
    listener: SyncEventListener<Extract<SyncEvent, { type: T }>>
  ): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener as SyncEventListener);
  }

  /**
   * Add one-time event listener
   */
  once<T extends SyncEventType>(
    eventType: T,
    listener: SyncEventListener<Extract<SyncEvent, { type: T }>>
  ): void {
    const onceListener = (event: SyncEvent) => {
      if (event.type === eventType) {
        listener(event as Extract<SyncEvent, { type: T }>);
        this.off(eventType, onceListener);
      }
    };
    this.on(eventType, onceListener as any);
  }

  /**
   * Remove event listener
   */
  off<T extends SyncEventType>(
    eventType: T,
    listener: SyncEventListener<Extract<SyncEvent, { type: T }>>
  ): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(listener as SyncEventListener);
      if (listeners.size === 0) {
        this.listeners.delete(eventType);
      }
    }
  }

  /**
   * Add global event listener (receives all events)
   */
  onAny(listener: SyncEventListener): void {
    this.globalListeners.add(listener);
  }

  /**
   * Remove global event listener
   */
  offAny(listener: SyncEventListener): void {
    this.globalListeners.delete(listener);
  }

  /**
   * Emit an event to all relevant listeners
   */
  emit(event: SyncEvent): void {
    // Add to history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Emit to type-specific listeners
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      typeListeners.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          console.error(
            `Error in sync event listener for ${event.type}:`,
            error
          );
        }
      });
    }

    // Emit to global listeners
    this.globalListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error(`Error in global sync event listener:`, error);
      }
    });
  }

  /**
   * Get event history
   */
  getEventHistory(): readonly SyncEvent[] {
    return [...this.eventHistory];
  }

  /**
   * Get recent events of specific type
   */
  getRecentEvents<T extends SyncEventType>(
    eventType: T,
    limit: number = 10
  ): Extract<SyncEvent, { type: T }>[] {
    return this.eventHistory
      .filter(
        (event): event is Extract<SyncEvent, { type: T }> =>
          event.type === eventType
      )
      .slice(-limit);
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(): void {
    this.listeners.clear();
    this.globalListeners.clear();
  }

  /**
   * Get listener count for event type
   */
  listenerCount(eventType: SyncEventType): number {
    return this.listeners.get(eventType)?.size || 0;
  }

  /**
   * Get total listener count (including global)
   */
  totalListenerCount(): number {
    let count = this.globalListeners.size;
    this.listeners.forEach((listeners) => {
      count += listeners.size;
    });
    return count;
  }
}

/**
 * Event builder utilities for creating sync events
 */
export class SyncEventBuilder {
  constructor(
    private sessionId: string,
    private clientId: string
  ) {}

  /**
   * Create base event properties
   */
  private createBase<T extends SyncEventType>(
    type: T
  ): BaseSyncEvent & { type: T } {
    return {
      type,
      timestamp: new Date(),
      sessionId: this.sessionId,
      clientId: this.clientId,
    };
  }

  /**
   * Create sync started event
   */
  syncStarted(isFullSync: boolean, estimatedItems?: number): SyncStartedEvent {
    return {
      ...this.createBase(SyncEventType.SyncStarted),
      isFullSync,
      estimatedItems,
    };
  }

  /**
   * Create sync progress event
   */
  syncProgress(progress: SyncProgress): SyncProgressEvent {
    return {
      ...this.createBase(SyncEventType.SyncProgress),
      progress,
    };
  }

  /**
   * Create sync batch completed event
   */
  syncBatchCompleted(
    batchNumber: number,
    itemsInBatch: number,
    cursor?: string,
    hasMore: boolean = false
  ): SyncBatchCompletedEvent {
    return {
      ...this.createBase(SyncEventType.SyncBatchCompleted),
      batchNumber,
      itemsInBatch,
      cursor,
      hasMore,
    };
  }

  /**
   * Create sync completed event
   */
  syncCompleted(
    totalItems: number,
    duration: number,
    conflictsResolved: number = 0
  ): SyncCompletedEvent {
    return {
      ...this.createBase(SyncEventType.SyncCompleted),
      totalItems,
      duration,
      conflictsResolved,
    };
  }

  /**
   * Create sync failed event
   */
  syncFailed(
    error: SyncError,
    canRetry: boolean = true,
    retryDelay?: number
  ): SyncFailedEvent {
    return {
      ...this.createBase(SyncEventType.SyncFailed),
      error,
      canRetry,
      retryDelay,
    };
  }

  /**
   * Create sync paused event
   */
  syncPaused(
    reason: "user" | "error" | "network" | "rate-limit",
    canResume: boolean = true
  ): SyncPausedEvent {
    return {
      ...this.createBase(SyncEventType.SyncPaused),
      reason,
      canResume,
    };
  }

  /**
   * Create sync resumed event
   */
  syncResumed(resumeFromCursor?: string): SyncResumedEvent {
    return {
      ...this.createBase(SyncEventType.SyncResumed),
      resumeFromCursor,
    };
  }

  /**
   * Create sync conflict event
   */
  syncConflict(conflict: SyncConflict): SyncConflictEvent {
    return {
      ...this.createBase(SyncEventType.SyncConflict),
      conflict,
    };
  }

  /**
   * Create sync conflict resolved event
   */
  syncConflictResolved(
    conflictId: string,
    resolution: "keep_local" | "keep_server" | "merge" | "skip"
  ): SyncConflictResolvedEvent {
    return {
      ...this.createBase(SyncEventType.SyncConflictResolved),
      conflictId,
      resolution,
    };
  }

  /**
   * Create connection changed event
   */
  connectionChanged(
    isOnline: boolean,
    canSync: boolean = isOnline
  ): ConnectionChangedEvent {
    return {
      ...this.createBase(SyncEventType.ConnectionChanged),
      isOnline,
      canSync,
    };
  }

  /**
   * Create items received event
   */
  itemsReceived(
    items: MediaBlob[],
    batchNumber: number,
    totalReceived: number
  ): ItemsReceivedEvent {
    return {
      ...this.createBase(SyncEventType.ItemsReceived),
      items,
      batchNumber,
      totalReceived,
    };
  }

  /**
   * Create items processed event
   */
  itemsProcessed(
    processedCount: number,
    failedCount: number,
    totalProcessed: number
  ): ItemsProcessedEvent {
    return {
      ...this.createBase(SyncEventType.ItemsProcessed),
      processedCount,
      failedCount,
      totalProcessed,
    };
  }
}

/**
 * Convenience function to create a sync event emitter with builder
 */
export function createSyncEventSystem(sessionId: string, clientId: string) {
  const emitter = new SyncEventEmitter();
  const builder = new SyncEventBuilder(sessionId, clientId);

  return {
    emitter,
    builder,
    // Convenience methods that emit events directly
    emit: (event: SyncEvent) => emitter.emit(event),
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    onAny: emitter.onAny.bind(emitter),
    offAny: emitter.offAny.bind(emitter),
  };
}
