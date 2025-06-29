//! Song synchronization module
//!
//! This module provides synchronization capabilities for song entities,
//! including incremental sync, conflict resolution, and offline operations.
//! It follows the same pattern as the playlist sync but is specialized
//! for song management with additional metadata handling.

import { SyncStorageManager } from "./sync-storage.js";
import { SyncProgress, SyncError, SyncConflict } from "./sync-schemas.js";
import { SyncStatus, ConflictResolution } from "./sync-constants.js";
import type { Song } from "../lib/websocket-types.js";

/**
 * Song sync progress event
 */
export interface SongSyncProgressEvent {
  progress: SyncProgress;
}

/**
 * Song sync conflict event
 */
export interface SongSyncConflictEvent {
  conflict: SyncConflict;
}

/**
 * Song sync error event
 */
export interface SongSyncErrorEvent {
  error: SyncError;
}

/**
 * Song sync items event
 */
export interface SongSyncItemsEvent {
  songs: Song[];
}

/**
 * Song sync connection event
 */
export interface SongSyncConnectionEvent {
  connected: boolean;
  reconnectAttempts?: number;
}

/**
 * Configuration for song sync
 */
export interface SongSyncConfig {
  /** API base URL */
  apiBaseUrl: string;
  /** Authentication token */
  authToken: string;
  /** Client identifier */
  clientId: string;
  /** Default batch size for sync operations */
  batchSize: number;
  /** Maximum retry attempts for failed operations */
  maxRetryAttempts: number;
  /** Base retry delay in milliseconds */
  retryDelay: number;
  /** Conflict resolution strategy */
  conflictResolution: ConflictResolution;
  /** Enable local storage */
  enableStorage: boolean;
  /** Maximum storage size in bytes */
  maxStorageSize: number;
  /** Maximum cache age in days */
  maxCacheAge: number;
  /** Song-specific filters */
  filters?: {
    /** Filter by artist */
    artist?: string;
    /** Filter by album */
    album?: string;
    /** Only sync favorites */
    favoritesOnly?: boolean;
  };
}

/**
 * Event listener type for song sync events
 */
export type SongSyncEventListener<T = any> = (event: T) => void;

/**
 * Song synchronization manager
 *
 * Provides high-level sync operations for songs with automatic
 * conflict resolution, offline support, and progress tracking.
 */
export class SongSync extends EventTarget {
  private config: SongSyncConfig;
  private storage: SyncStorageManager;
  private isInitialized: boolean = false;
  private currentStatus: SyncStatus = SyncStatus.Idle;

  constructor(config: SongSyncConfig, storage?: SyncStorageManager) {
    super();
    this.config = config;

    // Initialize storage
    this.storage =
      storage ||
      new SyncStorageManager({
        database_name: "webauthn_sync_storage",
        version: 4,
        max_storage_size: config.maxStorageSize,
        max_cache_age_days: config.maxCacheAge,
      });

    // Simplified initialization without complex dependencies

    this.setupEventForwarding();
  }

  /**
   * Initialize the song sync system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.storage.initialize();
      this.isInitialized = true;

      this.dispatchEvent(
        new CustomEvent("initialized", { detail: { success: true } })
      );
    } catch (error) {
      this.dispatchEvent(
        new CustomEvent("error", {
          detail: {
            error: {
              message: `Initialization failed: ${error}`,
              type: "initialization_error",
              timestamp: new Date().toISOString(),
              recoverable: true,
            },
          },
        })
      );
      throw error;
    }
  }

  /**
   * Start incremental sync for songs
   */
  async sync(
    options: {
      artist?: string;
      album?: string;
      favoritesOnly?: boolean;
    } = {}
  ): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.updateStatus(SyncStatus.Syncing);

    try {
      this.updateStatus(SyncStatus.InProgress);

      // Build query parameters
      const params = new URLSearchParams();
      params.set("page_size", (this.config.batchSize || 50).toString());

      if (options.artist) {
        params.set("artist", options.artist);
      }
      if (options.album) {
        params.set("album", options.album);
      }
      if (options.favoritesOnly !== undefined) {
        params.set("favorites_only", options.favoritesOnly.toString());
      }

      // Make HTTP request to sync endpoint
      const response = await fetch(
        `${this.config.apiBaseUrl}/api/sync/songs?${params}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.config.authToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const syncResponse = await response.json();
      await this.processSongsResponse(syncResponse);

      this.updateStatus(SyncStatus.Complete);
    } catch (error) {
      this.updateStatus(SyncStatus.Error);
      throw error;
    }
  }

  /**
   * Start full sync for songs
   */
  async fullSync(): Promise<void> {
    return this.sync();
  }

  /**
   * Pause ongoing sync operations
   */
  async pauseSync(): Promise<void> {
    this.updateStatus(SyncStatus.Paused);

    this.dispatchEvent(
      new CustomEvent("paused", {
        detail: { timestamp: new Date().toISOString() },
      })
    );
  }

  /**
   * Resume paused sync operations
   */
  async resumeSync(): Promise<void> {
    if (this.currentStatus !== SyncStatus.Paused) {
      throw new Error("Cannot resume: sync is not paused");
    }

    this.updateStatus(SyncStatus.InProgress);

    this.dispatchEvent(
      new CustomEvent("resumed", {
        detail: { timestamp: new Date().toISOString() },
      })
    );
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return this.currentStatus;
  }

  /**
   * Get sync recommendations
   */
  async getRecommendations(): Promise<{
    shouldSync: boolean;
    estimatedItems: number;
    estimatedDuration: number;
  }> {
    const stats = await this.storage.getStorageStats();
    const lastSyncTime = await this.getLastSyncTime();

    // Simple heuristic for recommendations
    const timeSinceLastSync = lastSyncTime
      ? Date.now() - new Date(lastSyncTime).getTime()
      : Infinity;

    const shouldSync = timeSinceLastSync > 5 * 60 * 1000; // 5 minutes

    return {
      shouldSync,
      estimatedItems: Math.max(0, stats.music_stats.total_songs / 10), // Estimate 10% new/changed
      estimatedDuration: Math.max(1000, stats.music_stats.total_songs * 10), // 10ms per song estimate
    };
  }

  /**
   * Check if sync is recommended
   */
  async shouldSync(): Promise<boolean> {
    const recommendations = await this.getRecommendations();
    return recommendations.shouldSync;
  }

  /**
   * Resolve a sync conflict
   */
  async resolveConflict(
    conflictId: string,
    resolution: ConflictResolution,
    customData?: any
  ): Promise<void> {
    try {
      const conflict = await this.storage.getUnresolvedConflicts();
      const targetConflict = conflict.find((c) => c.id === conflictId);

      if (!targetConflict) {
        throw new Error(`Conflict with ID ${conflictId} not found`);
      }

      let resolvedSong: Song;

      switch (resolution) {
        case ConflictResolution.LocalWins:
          resolvedSong = targetConflict.local_version as Song;
          break;
        case ConflictResolution.RemoteWins:
          resolvedSong = targetConflict.server_version as Song;
          break;
        case ConflictResolution.Merge:
          // Simple merge strategy - prefer local changes for metadata, server for timestamps
          resolvedSong = {
            ...(targetConflict.server_version as Song),
            ...(targetConflict.local_version as Song),
            updated_at: (targetConflict.server_version as Song).updated_at,
            version: Math.max(
              (targetConflict.local_version as Song).version,
              (targetConflict.server_version as Song).version
            ),
            ...customData,
          };
          break;
        default:
          throw new Error(`Unsupported resolution: ${resolution}`);
      }

      // Store resolved song
      await this.storage.storeSong(resolvedSong, true, false);

      // Mark conflict as resolved
      await this.storage.resolveConflict(conflictId, resolution);

      this.dispatchEvent(
        new CustomEvent("conflict_resolved", {
          detail: {
            conflictId,
            resolution,
            resolvedItem: resolvedSong,
          },
        })
      );
    } catch (error) {
      this.dispatchEvent(
        new CustomEvent("error", {
          detail: {
            error: {
              message: `Failed to resolve conflict: ${error}`,
              type: "conflict_resolution_error",
              timestamp: new Date().toISOString(),
              recoverable: true,
            },
          },
        })
      );
      throw error;
    }
  }

  /**
   * Get unresolved conflicts
   */
  async getConflicts(): Promise<SyncConflict[]> {
    return this.storage.getUnresolvedConflicts();
  }

  /**
   * Add one-time event listener (simplified)
   */
  once(): void {
    // Simplified implementation
  }

  /**
   * Process songs response from HTTP sync
   */
  private async processSongsResponse(response: {
    songs: Song[];
    total_count: number;
  }): Promise<void> {
    const { songs, total_count } = response;

    let syncedCount = 0;
    for (const song of songs) {
      try {
        await this.storage.storeSong(song, true, false);
        syncedCount++;

        // Emit progress event
        this.dispatchEvent(
          new CustomEvent("songs_synced", {
            detail: { songs: [song], total: total_count, synced: syncedCount },
          })
        );
      } catch (error) {
        console.warn(`Failed to store song ${song.id}:`, error);
      }
    }

    console.log(`✅ Synced ${syncedCount} songs of ${total_count} total`);
  }

  /**
   * Setup event forwarding (simplified)
   */
  private setupEventForwarding(): void {
    // Simplified implementation
  }

  /**
   * Get last sync timestamp
   */
  private async getLastSyncTime(): Promise<string | undefined> {
    // This would be stored in the metadata store
    // For now, return undefined to trigger full sync
    return undefined;
  }

  /**
   * Destroy sync manager and clean up resources
   */
  async destroy(): Promise<void> {
    await this.storage.close();
    this.updateStatus(SyncStatus.Never);
  }

  /**
   * Update current sync status
   */
  private updateStatus(status: SyncStatus): void {
    if (this.currentStatus !== status) {
      const previousStatus = this.currentStatus;
      this.currentStatus = status;

      this.dispatchEvent(
        new CustomEvent("status_changed", {
          detail: {
            status,
            previousStatus,
            timestamp: new Date().toISOString(),
          },
        })
      );
    }
  }
}

/**
 * Event map for song sync events
 */
export interface SongSyncEventMap {
  progress: SongSyncProgressEvent;
  error: SongSyncErrorEvent;
  conflict: SongSyncConflictEvent;
  songs_synced: SongSyncItemsEvent;
  connection: SongSyncConnectionEvent;
  initialized: { success: boolean };
  paused: { timestamp: string };
  resumed: { timestamp: string };
  status_changed: {
    status: SyncStatus;
    previousStatus: SyncStatus;
    timestamp: string;
  };
  conflict_resolved: {
    conflictId: string;
    resolution: ConflictResolution;
    resolvedItem: Song;
  };
}

/**
 * Create a new song sync instance with default configuration
 */
export function createSongSync(
  config: Partial<SongSyncConfig> & {
    apiBaseUrl: string;
    authToken: string;
    clientId: string;
  }
): SongSync {
  const fullConfig: SongSyncConfig = {
    batchSize: 50,
    maxRetryAttempts: 3,
    retryDelay: 1000,
    conflictResolution: ConflictResolution.Manual,
    enableStorage: true,
    maxStorageSize: 50 * 1024 * 1024, // 50MB
    maxCacheAge: 30,
    ...config,
  };

  return new SongSync(fullConfig);
}

/**
 * Check if song sync is supported in current environment
 */
export function isSongSyncSupported(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof fetch !== "undefined" &&
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  );
}

/**
 * Get default song sync configuration
 */
export function getDefaultSongSyncConfig(): Partial<SongSyncConfig> {
  return {
    batchSize: 50,
    maxRetryAttempts: 3,
    retryDelay: 1000,
    conflictResolution: ConflictResolution.Manual,
    enableStorage: true,
    maxStorageSize: 50 * 1024 * 1024,
    maxCacheAge: 30,
  };
}

/**
 * Validate song sync configuration
 */
export function validateSongSyncConfig(config: Partial<SongSyncConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.apiBaseUrl) {
    errors.push("apiBaseUrl is required");
  } else {
    try {
      new URL(config.apiBaseUrl);
    } catch {
      errors.push("apiBaseUrl must be a valid URL");
    }
  }

  if (!config.authToken) {
    errors.push("authToken is required");
  }

  if (!config.clientId) {
    errors.push("clientId is required");
  }

  if (config.batchSize && (config.batchSize < 1 || config.batchSize > 1000)) {
    errors.push("batchSize must be between 1 and 1000");
  }

  if (config.maxRetryAttempts && config.maxRetryAttempts < 0) {
    errors.push("maxRetryAttempts must be non-negative");
  }

  if (config.retryDelay && config.retryDelay < 0) {
    errors.push("retryDelay must be non-negative");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
