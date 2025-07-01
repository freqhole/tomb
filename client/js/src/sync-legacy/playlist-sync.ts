//! Playlist synchronization module
//!
//! This module provides synchronization capabilities for playlist entities,
//! including incremental sync, conflict resolution, and offline operations.
//! It follows the same pattern as the song sync but is specialized
//! for playlist management.

import { SyncStorageManager } from "./sync-storage.js";
import {
  SyncProgress,
  SyncError,
  SyncConflict,
  PlaylistSyncResponse,
} from "./sync-schemas.js";
import { SyncStatus, ConflictResolution } from "./sync-constants.js";
import { SyncApiClient, createSyncApiClient } from "./sync-api-client.js";
import { ApiClient } from "../lib/api-client.js";
import type { Playlist } from "../lib/websocket-types.js";
import type { StoredPlaylist } from "./sync-storage.js";

/**
 * Playlist sync progress event
 */
export interface PlaylistSyncProgressEvent {
  progress: SyncProgress;
}

/**
 * Playlist sync conflict event
 */
export interface PlaylistSyncConflictEvent {
  conflict: SyncConflict;
}

/**
 * Playlist sync error event
 */
export interface PlaylistSyncErrorEvent {
  error: SyncError;
}

/**
 * Playlist sync items event
 */
export interface PlaylistSyncItemsEvent {
  playlists: Playlist[];
}

/**
 * Playlist sync connection event
 */
export interface PlaylistSyncConnectionEvent {
  connected: boolean;
  reconnectAttempts?: number;
}

/**
 * Configuration for playlist sync
 */
export interface PlaylistSyncConfig {
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
  /** Playlist-specific filters */
  filters?: {
    /** Only sync public playlists */
    publicOnly?: boolean;
    /** Filter by client ID */
    clientId?: string;
  };
}

/**
 * Event listener type for playlist sync events
 */
export type PlaylistSyncEventListener<T = any> = (event: T) => void;

/**
 * Playlist synchronization manager
 *
 * Provides high-level sync operations for playlists with automatic
 * conflict resolution, offline support, and progress tracking.
 */
export class PlaylistSync extends EventTarget {
  private config: PlaylistSyncConfig;
  private storage: SyncStorageManager;
  private apiClient: SyncApiClient;
  private isInitialized: boolean = false;
  private currentStatus: SyncStatus = SyncStatus.Idle;
  private lastSyncTime?: string;

  constructor(config: PlaylistSyncConfig, storage?: SyncStorageManager) {
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

    // Initialize API client
    const baseApiClient = new ApiClient({
      baseUrl: config.apiBaseUrl,
      defaultHeaders: {
        Authorization: `Bearer ${config.authToken}`,
      },
    });
    this.apiClient = createSyncApiClient({
      apiClient: baseApiClient,
      timeout: 30000,
      validateRequests: true,
    });

    this.setupEventForwarding();
  }

  /**
   * Initialize the playlist sync system
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
   * Start incremental sync for playlists
   */
  async sync(
    options: {
      publicOnly?: boolean;
      clientId?: string;
      forceFullSync?: boolean;
    } = {}
  ): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.updateStatus(SyncStatus.Syncing);

    try {
      this.updateStatus(SyncStatus.InProgress);

      // Get last sync time for incremental sync unless forcing full sync
      const lastSync = options.forceFullSync
        ? undefined
        : await this.getLastSyncTime();

      // Build query parameters
      const query = {
        last_sync_time: lastSync,
        page_size: this.config.batchSize || 50,
        public_only: options.publicOnly,
        client_id: options.clientId,
      };

      // Use the API client for sync
      const syncResponse = await this.apiClient.syncPlaylists(query);
      await this.processPlaylistsResponse(syncResponse);

      // Update last sync time
      this.lastSyncTime = new Date().toISOString();
      await this.updateLastSyncTime(this.lastSyncTime);

      this.updateStatus(SyncStatus.Complete);
    } catch (error) {
      this.updateStatus(SyncStatus.Error);
      throw error;
    }
  }

  /**
   * Start full sync for playlists
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
   * Resume a paused sync operation
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

    const shouldSync = timeSinceLastSync > 10 * 60 * 1000; // 10 minutes

    return {
      shouldSync,
      estimatedItems: Math.max(0, stats.music_stats.total_playlists / 20), // Estimate 5% new/changed
      estimatedDuration: Math.max(1000, stats.music_stats.total_playlists * 50), // 50ms per playlist estimate
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
      const conflicts = await this.storage.getUnresolvedConflicts();
      const targetConflict = conflicts.find((c) => c.id === conflictId);

      if (!targetConflict) {
        throw new Error(`Conflict with ID ${conflictId} not found`);
      }

      let resolvedPlaylist: Playlist;

      switch (resolution) {
        case ConflictResolution.LocalWins:
          resolvedPlaylist = targetConflict.local_version as Playlist;
          break;
        case ConflictResolution.RemoteWins:
          resolvedPlaylist = targetConflict.server_version as Playlist;
          break;
        case ConflictResolution.Merge:
          // Simple merge strategy - prefer local changes for content, server for timestamps
          resolvedPlaylist = {
            ...(targetConflict.server_version as Playlist),
            ...(targetConflict.local_version as Playlist),
            updated_at: (targetConflict.server_version as Playlist).updated_at,
            version: Math.max(
              (targetConflict.local_version as Playlist).version,
              (targetConflict.server_version as Playlist).version
            ),
            ...customData,
          };
          break;
        default:
          throw new Error(`Unsupported resolution: ${resolution}`);
      }

      // Store resolved playlist
      await this.storage.storePlaylist(resolvedPlaylist, true, false);

      // Mark conflict as resolved
      await this.storage.resolveConflict(conflictId, resolution);

      this.dispatchEvent(
        new CustomEvent("conflict_resolved", {
          detail: {
            conflictId,
            resolution,
            resolvedItem: resolvedPlaylist,
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
   * Get stored playlists with optional filters
   */
  async getPlaylists(
    options: {
      limit?: number;
      offset?: number;
      publicOnly?: boolean;
      localOnly?: boolean;
    } = {}
  ): Promise<StoredPlaylist[]> {
    return this.storage.queryPlaylists({
      limit: options.limit,
      offset: options.offset,
      unsynced_only: options.localOnly,
    });
  }

  /**
   * Get a specific playlist by ID
   */
  async getPlaylist(id: string): Promise<StoredPlaylist | null> {
    return this.storage.getPlaylist(id);
  }

  /**
   * Create a new playlist locally
   */
  async createPlaylist(
    title: string,
    description?: string,
    isPublic: boolean = false
  ): Promise<Playlist> {
    const playlist: Playlist = {
      id: crypto.randomUUID(),
      title,
      description,
      client_id: this.config.clientId,
      is_public: isPublic,
      is_collaborative: false,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };

    // Store locally as unsynced
    await this.storage.storePlaylist(playlist, false, true);

    // Queue for sync
    await this.storage.queueOfflineOperation("create", playlist.id, {
      type: "create_playlist",
      playlist,
    });

    this.dispatchEvent(
      new CustomEvent("playlist_created", { detail: { playlist } })
    );

    return playlist;
  }

  /**
   * Update an existing playlist
   */
  async updatePlaylist(
    id: string,
    updates: Partial<
      Pick<Playlist, "title" | "description" | "is_public" | "is_collaborative">
    >
  ): Promise<void> {
    const existingPlaylist = await this.storage.getPlaylist(id);
    if (!existingPlaylist) {
      throw new Error(`Playlist with ID ${id} not found`);
    }

    const updatedPlaylist: Playlist = {
      ...existingPlaylist,
      ...updates,
      updated_at: new Date().toISOString(),
      version: existingPlaylist.version + 1,
    };

    // Store locally as modified
    await this.storage.storePlaylist(updatedPlaylist, false, true);

    // Queue for sync
    await this.storage.queueOfflineOperation("update", id, {
      type: "update_playlist",
      changes: updates,
    });

    this.dispatchEvent(
      new CustomEvent("playlist_updated", {
        detail: { playlist: updatedPlaylist },
      })
    );
  }

  /**
   * Delete a playlist
   */
  async deletePlaylist(id: string): Promise<void> {
    const existingPlaylist = await this.storage.getPlaylist(id);
    if (!existingPlaylist) {
      throw new Error(`Playlist with ID ${id} not found`);
    }

    // Mark as deleted locally
    const deletedPlaylist: Playlist = {
      ...existingPlaylist,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: existingPlaylist.version + 1,
    };

    await this.storage.storePlaylist(deletedPlaylist, false, true);

    // Queue for sync
    await this.storage.queueOfflineOperation("delete", id, {
      type: "delete_playlist",
      reason: "user_deleted",
    });

    this.dispatchEvent(
      new CustomEvent("playlist_deleted", { detail: { playlistId: id } })
    );
  }

  /**
   * Process playlists response from sync API
   */
  private async processPlaylistsResponse(
    response: PlaylistSyncResponse
  ): Promise<void> {
    const { items: playlists, total_items } = response;

    let syncedCount = 0;
    for (const playlist of playlists) {
      try {
        await this.storage.storePlaylist(playlist, true, false);
        syncedCount++;

        // Emit progress event
        this.dispatchEvent(
          new CustomEvent("playlists_synced", {
            detail: {
              playlists: [playlist],
              total: total_items,
              synced: syncedCount,
            },
          })
        );
      } catch (error) {
        console.warn(`Failed to store playlist ${playlist.id}:`, error);
      }
    }

    console.log(`✅ Synced ${syncedCount} playlists of ${total_items} total`);
  }

  /**
   * Destroy sync manager and clean up resources
   */
  async destroy(): Promise<void> {
    await this.storage.close();
    this.updateStatus(SyncStatus.Never);
  }

  /**
   * Setup event forwarding (simplified)
   */
  private setupEventForwarding(): void {
    // Simplified implementation
  }

  // Removed performSync method as it's not used in simplified implementation

  /**
   * Get last sync timestamp
   */
  private async getLastSyncTime(): Promise<string | undefined> {
    return this.lastSyncTime;
  }

  /**
   * Update last sync timestamp
   */
  private async updateLastSyncTime(timestamp: string): Promise<void> {
    this.lastSyncTime = timestamp;
    // TODO: Persist to storage for cross-session sync state
  }

  /**
   * Update current sync status
   */
  private updateStatus(status: SyncStatus): void {
    if (this.currentStatus !== status) {
      if (status !== this.currentStatus) {
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
}

/**
 * Event map for playlist sync events
 */
export interface PlaylistSyncEventMap {
  progress: PlaylistSyncProgressEvent;
  error: PlaylistSyncErrorEvent;
  conflict: PlaylistSyncConflictEvent;
  playlists_synced: PlaylistSyncItemsEvent;
  connection: PlaylistSyncConnectionEvent;
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
    resolvedItem: Playlist;
  };
  playlist_created: { playlist: Playlist };
  playlist_updated: { playlist: Playlist };
  playlist_deleted: { playlistId: string };
}

/**
 * Create a new playlist sync instance with default configuration
 */
export function createPlaylistSync(
  config: Partial<PlaylistSyncConfig> & {
    apiBaseUrl: string;
    authToken: string;
    clientId: string;
  }
): PlaylistSync {
  const fullConfig: PlaylistSyncConfig = {
    batchSize: 25, // Smaller batch size for playlists
    maxRetryAttempts: 3,
    retryDelay: 1000,
    conflictResolution: ConflictResolution.Manual,
    enableStorage: true,
    maxStorageSize: 10 * 1024 * 1024, // 10MB
    maxCacheAge: 30,
    ...config,
  };

  return new PlaylistSync(fullConfig);
}

/**
 * Check if playlist sync is supported in current environment
 */
export function isPlaylistSyncSupported(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof fetch !== "undefined" &&
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  );
}

/**
 * Get default playlist sync configuration
 */
export function getDefaultPlaylistSyncConfig(): Partial<PlaylistSyncConfig> {
  return {
    batchSize: 25,
    maxRetryAttempts: 3,
    retryDelay: 1000,
    conflictResolution: ConflictResolution.Manual,
    enableStorage: true,
    maxStorageSize: 10 * 1024 * 1024,
    maxCacheAge: 30,
  };
}

/**
 * Validate playlist sync configuration
 */
export function validatePlaylistSyncConfig(
  config: Partial<PlaylistSyncConfig>
): { valid: boolean; errors: string[] } {
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
