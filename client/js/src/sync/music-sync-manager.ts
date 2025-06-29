//! Unified music synchronization manager
//!
//! This module provides a high-level synchronization manager that coordinates
//! syncing of all music-related entities: songs, playlists, and playlist songs.
//! It also manages binary data storage for media blobs and provides a unified
//! interface for the music domain.

import { SongSync } from "./song-sync.js";
import { PlaylistSync } from "./playlist-sync.js";
import { PlaylistSongSync } from "./playlist-song-sync.js";
import { MediaBlobSync } from "./media-blob-sync.js";
import { SyncStorageManager } from "./sync-storage.js";
import { MusicSyncEventEmitter, MusicSyncEvents } from "./music-sync-events.js";
import { SyncStatus, ConflictResolution } from "./sync-constants.js";
import type {
  Song,
  Playlist,
  PlaylistSong,
  MediaBlob,
} from "../lib/websocket-types.js";
import type {
  StoredSong,
  StoredPlaylist,
  StoredPlaylistSong,
} from "./sync-storage.js";

/**
 * Configuration for the unified music sync manager
 */
export interface MusicSyncManagerConfig {
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
  /** Whether to sync binary data for media blobs */
  syncBinaryData: boolean;
  /** Music-specific sync options */
  musicOptions?: {
    /** Only sync favorite songs */
    favoritesOnly?: boolean;
    /** Only sync public playlists */
    publicPlaylistsOnly?: boolean;
    /** Auto-sync interval in milliseconds */
    autoSyncInterval?: number;
    /** Enable background sync */
    enableBackgroundSync?: boolean;
  };
}

/**
 * Sync progress for all music entities
 */
export interface MusicSyncProgress {
  /** Overall sync status */
  status: SyncStatus;
  /** Total items synced across all entities */
  totalItemsSynced: number;
  /** Estimated total items to sync */
  estimatedTotalItems?: number;
  /** Overall progress percentage (0-100) */
  overallProgress?: number;
  /** Progress per entity type */
  entityProgress: {
    songs: {
      synced: number;
      total?: number;
      status: SyncStatus;
    };
    playlists: {
      synced: number;
      total?: number;
      status: SyncStatus;
    };
    playlistSongs: {
      synced: number;
      total?: number;
      status: SyncStatus;
    };
    mediaBlobs: {
      synced: number;
      total?: number;
      status: SyncStatus;
    };
  };
  /** Current sync phase */
  currentPhase:
    | "songs"
    | "playlists"
    | "playlist_songs"
    | "media_blobs"
    | "complete";
  /** Timestamp when sync started */
  startedAt: string;
  /** Estimated completion time */
  estimatedCompletionAt?: string;
}

/**
 * Music sync statistics
 */
export interface MusicSyncStats {
  /** Last successful sync timestamp */
  lastSyncTime?: string;
  /** Total songs stored locally */
  totalSongs: number;
  /** Total playlists stored locally */
  totalPlaylists: number;
  /** Total playlist songs stored locally */
  totalPlaylistSongs: number;
  /** Total media blobs with binary data */
  totalBinaryData: number;
  /** Storage size used in bytes */
  storageSize: number;
  /** Number of unsynced items */
  unsyncedItems: number;
  /** Number of conflicts */
  conflicts: number;
  /** Sync health score (0-100) */
  healthScore: number;
}

/**
 * Event listener type for music sync events
 */
export type MusicSyncEventListener<T = any> = (event: T) => void;

/**
 * Unified music synchronization manager
 *
 * Coordinates synchronization of all music-related entities and provides
 * a high-level interface for music data management with offline support.
 */
export class MusicSyncManager extends MusicSyncEventEmitter {
  private config: MusicSyncManagerConfig;
  private storage: SyncStorageManager;
  private songSync!: SongSync;
  private playlistSync!: PlaylistSync;
  private playlistSongSync!: PlaylistSongSync;
  private mediaBlobSync!: MediaBlobSync;
  private isInitialized: boolean = false;
  private currentStatus: SyncStatus = SyncStatus.Idle;
  private syncProgress: MusicSyncProgress;
  private autoSyncTimer?: number;

  constructor(config: MusicSyncManagerConfig) {
    super();
    this.config = config;

    // Initialize shared storage manager
    this.storage = new SyncStorageManager({
      database_name: "webauthn_sync_storage",
      version: 4,
      max_storage_size: config.maxStorageSize,
      max_cache_age_days: config.maxCacheAge,
    });

    // Initialize sync progress
    this.syncProgress = this.createInitialProgress();

    // Initialize individual sync managers
    this.initializeSyncManagers();
    this.setupEventForwarding();
  }

  /**
   * Initialize the music sync manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.storage.initialize();

      await Promise.all([
        this.songSync.initialize(),
        this.playlistSync.initialize(),
        this.playlistSongSync.initialize(),
        this.mediaBlobSync.initialize(),
      ]);

      this.isInitialized = true;

      // Start auto-sync if enabled
      if (this.config.musicOptions?.enableBackgroundSync) {
        this.startAutoSync();
      }

      this.emit(MusicSyncEvents.INITIALIZED, { success: true });
    } catch (error) {
      this.emit(MusicSyncEvents.ERROR, {
        error: {
          type: "initialization_failed",
          message: `Failed to initialize music sync manager: ${error}`,
          timestamp: new Date().toISOString(),
          recoverable: true,
        },
      });
      throw error;
    }
  }

  /**
   * Start comprehensive music sync
   */
  async syncAll(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.updateStatus(SyncStatus.Syncing);
    this.syncProgress = this.createInitialProgress();
    this.syncProgress.startedAt = new Date().toISOString();

    try {
      // Phase 1: Sync songs
      this.syncProgress.currentPhase = "songs";
      this.emit(MusicSyncEvents.PROGRESS, { progress: this.syncProgress });

      await this.songSync.sync({
        favoritesOnly: this.config.musicOptions?.favoritesOnly,
      });

      // Phase 2: Sync playlists
      this.syncProgress.currentPhase = "playlists";
      this.emit(MusicSyncEvents.PROGRESS, { progress: this.syncProgress });

      await this.playlistSync.sync({
        publicOnly: this.config.musicOptions?.publicPlaylistsOnly,
      });

      // Phase 3: Sync playlist songs for each playlist
      this.syncProgress.currentPhase = "playlist_songs";
      this.emit(MusicSyncEvents.PROGRESS, { progress: this.syncProgress });

      // Get all playlists from storage (they should be synced now) and sync their songs
      const playlists = await this.storage.queryPlaylists();
      console.log(`Found ${playlists.length} playlists to sync songs for`);

      for (const playlist of playlists) {
        console.log(
          `Syncing songs for playlist: ${playlist.title} (${playlist.id})`
        );
        try {
          await this.playlistSongSync.sync({ playlistId: playlist.id });
        } catch (error) {
          console.error(
            `Failed to sync playlist songs for ${playlist.title}:`,
            error
          );
        }
      }

      // Phase 4: Sync media blobs (if binary data is enabled)
      if (this.config.syncBinaryData) {
        this.syncProgress.currentPhase = "media_blobs";
        this.emit(MusicSyncEvents.PROGRESS, { progress: this.syncProgress });

        await this.mediaBlobSync.sync();
      }

      // Complete
      this.syncProgress.currentPhase = "complete";
      this.syncProgress.status = SyncStatus.Idle;
      this.updateStatus(SyncStatus.Idle);

      this.emit(MusicSyncEvents.SYNC_COMPLETED, {
        progress: this.syncProgress,
        stats: await this.getStats(),
      });
    } catch (error) {
      this.updateStatus(SyncStatus.Error);
      this.syncProgress.status = SyncStatus.Error;

      this.emit(MusicSyncEvents.ERROR, {
        error: {
          type: "sync_failed",
          message: `Music sync failed: ${error}`,
          timestamp: new Date().toISOString(),
          recoverable: true,
        },
      });
      throw error;
    }
  }

  /**
   * Sync only songs
   */
  async syncSongs(options?: {
    artist?: string;
    album?: string;
    favoritesOnly?: boolean;
  }): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return this.songSync.sync(options);
  }

  /**
   * Sync only playlists
   */
  async syncPlaylists(options?: { publicOnly?: boolean }): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return this.playlistSync.sync(options);
  }

  /**
   * Sync playlist songs for a specific playlist
   */
  async syncPlaylistSongs(playlistId?: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return this.playlistSongSync.sync({ playlistId });
  }

  /**
   * Sync media blobs with binary data
   */
  async syncMediaBlobs(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return this.mediaBlobSync.sync();
  }

  /**
   * Get music sync statistics
   */
  async getStats(): Promise<MusicSyncStats> {
    const storageStats = await this.storage.getStorageStats();

    const totalItems =
      storageStats.total_items +
      storageStats.music_stats.total_songs +
      storageStats.music_stats.total_playlists +
      storageStats.music_stats.total_playlist_songs;

    const unsyncedRatio =
      totalItems > 0 ? storageStats.unsynced_items / totalItems : 1;
    const conflictRatio =
      totalItems > 0 ? storageStats.conflicts / totalItems : 0;

    // Calculate health score (100 = perfect, 0 = terrible)
    const healthScore = Math.max(
      0,
      Math.min(100, 100 - unsyncedRatio * 50 - conflictRatio * 50)
    );

    return {
      lastSyncTime: undefined, // Would be stored in metadata
      totalSongs: storageStats.music_stats.total_songs,
      totalPlaylists: storageStats.music_stats.total_playlists,
      totalPlaylistSongs: storageStats.music_stats.total_playlist_songs,
      totalBinaryData: 0, // Binary data is now stored in media_blob.data field
      storageSize: storageStats.total_size,
      unsyncedItems: storageStats.unsynced_items,
      conflicts: storageStats.conflicts,
      healthScore: Math.round(healthScore),
    };
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return this.currentStatus;
  }

  /**
   * Get current sync progress
   */
  getProgress(): MusicSyncProgress {
    return { ...this.syncProgress };
  }

  /**
   * Check if any sync is recommended
   */
  async shouldSync(): Promise<boolean> {
    const [
      songRecommendation,
      playlistRecommendation,
      playlistSongRecommendation,
    ] = await Promise.all([
      this.songSync.shouldSync(),
      this.playlistSync.shouldSync(),
      this.playlistSongSync.shouldSync(),
    ]);

    return (
      songRecommendation || playlistRecommendation || playlistSongRecommendation
    );
  }

  /**
   * Pause all sync operations
   */
  pauseSync(): void {
    this.songSync.pauseSync();
    this.playlistSync.pauseSync();
    this.playlistSongSync.pauseSync();
    this.mediaBlobSync.pauseSync();

    this.updateStatus(SyncStatus.Paused);
    this.stopAutoSync();

    this.emit(MusicSyncEvents.PAUSED, {
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Resume all sync operations
   */
  async resumeSync(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    await Promise.all([
      this.songSync.resumeSync(),
      this.playlistSync.resumeSync(),
      this.playlistSongSync.resumeSync(),
      this.mediaBlobSync.resumeSync(),
    ]);

    this.updateStatus(SyncStatus.Syncing);

    if (this.config.musicOptions?.enableBackgroundSync) {
      this.startAutoSync();
    }

    this.emit(MusicSyncEvents.RESUMED, {
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get stored songs with optional filtering
   */
  async getSongs(options?: {
    limit?: number;
    offset?: number;
    artist?: string;
    album?: string;
    favoritesOnly?: boolean;
  }): Promise<StoredSong[]> {
    return this.storage.querySongs({
      limit: options?.limit,
      offset: options?.offset,
      // Additional filtering would need to be implemented in querySongs
    });
  }

  /**
   * Get stored playlists
   */
  async getPlaylists(options?: {
    limit?: number;
    offset?: number;
    publicOnly?: boolean;
  }): Promise<StoredPlaylist[]> {
    return this.storage.queryPlaylists({
      limit: options?.limit,
      offset: options?.offset,
    });
  }

  /**
   * Get songs in a playlist
   */
  async getPlaylistSongs(playlistId: string): Promise<StoredPlaylistSong[]> {
    return this.storage.getPlaylistSongs(playlistId);
  }

  /**
   * Create a new playlist
   */
  async createPlaylist(
    title: string,
    description?: string,
    isPublic: boolean = false
  ): Promise<Playlist> {
    return this.playlistSync.createPlaylist(title, description, isPublic);
  }

  /**
   * Add a song to a playlist
   */
  async addSongToPlaylist(
    playlistId: string,
    songId: string,
    position?: number
  ): Promise<PlaylistSong> {
    return this.playlistSongSync.addSongToPlaylist(
      playlistId,
      songId,
      position
    );
  }

  /**
   * Remove a song from a playlist
   */
  async removeSongFromPlaylist(playlistSongId: string): Promise<void> {
    return this.playlistSongSync.removeSongFromPlaylist(playlistSongId);
  }

  /**
   * Reorder songs in a playlist
   */
  async reorderPlaylistSongs(
    playlistId: string,
    songIds: string[]
  ): Promise<void> {
    return this.playlistSongSync.reorderPlaylistSongs(playlistId, songIds);
  }

  /**
   * Clean up old data and optimize storage
   */
  async cleanup(): Promise<void> {
    await this.storage.cleanup();

    this.emit(MusicSyncEvents.CLEANUP_COMPLETED, {
      timestamp: new Date().toISOString(),
      stats: await this.getStats(),
    });
  }

  /**
   * Destroy the sync manager and clean up resources
   */
  async destroy(): Promise<void> {
    this.stopAutoSync();

    await Promise.all([
      this.songSync.destroy(),
      this.playlistSync.destroy(),
      this.playlistSongSync.destroy(),
      this.mediaBlobSync.destroy(),
      this.storage.close(),
    ]);

    this.removeAllListeners();
    this.isInitialized = false;
    this.updateStatus(SyncStatus.Idle);
  }

  /**
   * Initialize individual sync managers
   */
  private initializeSyncManagers(): void {
    const baseConfig = {
      apiBaseUrl: this.config.apiBaseUrl,
      authToken: this.config.authToken,
      clientId: this.config.clientId,
      batchSize: this.config.batchSize,
      maxRetryAttempts: this.config.maxRetryAttempts,
      retryDelay: this.config.retryDelay,
      conflictResolution: this.config.conflictResolution,
      enableStorage: this.config.enableStorage,
      maxStorageSize: Math.floor(this.config.maxStorageSize / 4), // Split storage between entities
      maxCacheAge: this.config.maxCacheAge,
    };

    // Song sync
    this.songSync = new SongSync(
      {
        ...baseConfig,
        filters: {
          favoritesOnly: this.config.musicOptions?.favoritesOnly,
        },
      },
      this.storage
    );

    // Playlist sync
    this.playlistSync = new PlaylistSync(
      {
        ...baseConfig,
        filters: {
          publicOnly: this.config.musicOptions?.publicPlaylistsOnly,
        },
      },
      this.storage
    );

    // Playlist song sync
    this.playlistSongSync = new PlaylistSongSync(baseConfig);

    // Media blob sync
    this.mediaBlobSync = new MediaBlobSync({
      ...baseConfig,
      serverUrl: baseConfig.apiBaseUrl,
      includeBinaryData: this.config.syncBinaryData,
      conflictResolution: "manual",
    });
  }

  /**
   * Set up event forwarding from individual sync managers
   */
  private setupEventForwarding(): void {
    // Song sync events
    this.songSync.addEventListener("songs_synced", (event: any) => {
      const data = event.detail;
      this.syncProgress.entityProgress.songs.synced += data.songs.length;
      this.updateOverallProgress();
      this.emit(MusicSyncEvents.SONGS_SYNCED, { songs: data.songs });
    });

    this.songSync.addEventListener("error", (event: any) => {
      const data = event.detail;
      this.syncProgress.entityProgress.songs.status = SyncStatus.Error;
      this.emit(MusicSyncEvents.ERROR, { error: data.error });
    });

    // Playlist sync events
    this.playlistSync.addEventListener("playlists_synced", (event: any) => {
      const data = event.detail;
      this.syncProgress.entityProgress.playlists.synced +=
        data.playlists.length;
      this.updateOverallProgress();
      this.emit(MusicSyncEvents.PLAYLISTS_SYNCED, {
        playlists: data.playlists,
      });
    });

    this.playlistSync.addEventListener("error", (event: any) => {
      const data = event.detail;
      this.syncProgress.entityProgress.playlists.status = SyncStatus.Error;
      this.emit(MusicSyncEvents.ERROR, { error: data.error });
    });

    // Playlist song sync events
    this.playlistSongSync.addEventListener(
      "playlist_songs_synced",
      (event: any) => {
        const data = event.detail;
        this.syncProgress.entityProgress.playlistSongs.synced +=
          data.playlistSongs.length;
        this.updateOverallProgress();
        this.emit(MusicSyncEvents.PLAYLIST_SONGS_SYNCED, {
          playlistSongs: data.playlistSongs,
        });
      }
    );

    this.playlistSongSync.addEventListener("error", (event: any) => {
      const data = event.detail;
      this.syncProgress.entityProgress.playlistSongs.status = SyncStatus.Error;
      this.emit(MusicSyncEvents.ERROR, { error: data.error });
    });

    // Media blob sync events
    this.mediaBlobSync.addEventListener("items_synced", (event: any) => {
      const data = event.detail;
      this.syncProgress.entityProgress.mediaBlobs.synced +=
        data.items?.length || 0;
      this.updateOverallProgress();
      this.emit(MusicSyncEvents.MEDIA_BLOBS_SYNCED, {
        mediaBlobs: data.mediaBlobs,
      });
    });

    this.mediaBlobSync.addEventListener("error", (event: any) => {
      const data = event.detail;
      this.syncProgress.entityProgress.mediaBlobs.status = SyncStatus.Error;
      this.emit(MusicSyncEvents.ERROR, { error: data.error || data });
    });
  }

  /**
   * Create initial progress state
   */
  private createInitialProgress(): MusicSyncProgress {
    return {
      status: SyncStatus.Idle,
      totalItemsSynced: 0,
      currentPhase: "songs",
      startedAt: new Date().toISOString(),
      entityProgress: {
        songs: { synced: 0, status: SyncStatus.Idle },
        playlists: { synced: 0, status: SyncStatus.Idle },
        playlistSongs: { synced: 0, status: SyncStatus.Idle },
        mediaBlobs: { synced: 0, status: SyncStatus.Idle },
      },
    };
  }

  /**
   * Update overall progress based on entity progress
   */
  private updateOverallProgress(): void {
    const totalSynced = Object.values(this.syncProgress.entityProgress).reduce(
      (sum, entity) => sum + entity.synced,
      0
    );

    const totalEstimated = Object.values(
      this.syncProgress.entityProgress
    ).reduce((sum, entity) => sum + (entity.total || 0), 0);

    this.syncProgress.totalItemsSynced = totalSynced;
    this.syncProgress.estimatedTotalItems = totalEstimated;

    if (totalEstimated > 0) {
      this.syncProgress.overallProgress = (totalSynced / totalEstimated) * 100;
    }

    this.emit(MusicSyncEvents.PROGRESS, { progress: this.syncProgress });
  }

  /**
   * Update current sync status
   */
  private updateStatus(status: SyncStatus): void {
    if (this.currentStatus !== status) {
      const previousStatus = this.currentStatus;
      this.currentStatus = status;

      this.emit(MusicSyncEvents.STATUS_CHANGED, {
        status,
        previousStatus,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Start automatic sync timer
   */
  private startAutoSync(): void {
    const interval =
      this.config.musicOptions?.autoSyncInterval || 5 * 60 * 1000; // 5 minutes default

    this.autoSyncTimer = window.setInterval(async () => {
      if (this.currentStatus === SyncStatus.Idle && (await this.shouldSync())) {
        try {
          await this.syncAll();
        } catch (error) {
          // Auto-sync failures are logged but don't throw
          this.emit(MusicSyncEvents.AUTO_SYNC_FAILED, {
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          });
        }
      }
    }, interval);
  }

  /**
   * Stop automatic sync timer
   */
  private stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = undefined;
    }
  }
}

/**
 * Event map for music sync manager events
 */
export interface MusicSyncManagerEventMap {
  initialized: { success: boolean };
  progress: { progress: MusicSyncProgress };
  status_changed: {
    status: SyncStatus;
    previousStatus: SyncStatus;
    timestamp: string;
  };
  sync_completed: {
    progress: MusicSyncProgress;
    stats: MusicSyncStats;
  };
  songs_synced: { songs: Song[] };
  playlists_synced: { playlists: Playlist[] };
  playlist_songs_synced: { playlistSongs: PlaylistSong[] };
  media_blobs_synced: { items: MediaBlob[] };
  error: { error: any };
  paused: { timestamp: string };
  resumed: { timestamp: string };
  cleanup_completed: { timestamp: string; stats: MusicSyncStats };
  auto_sync_failed: { error: string; timestamp: string };
}

/**
 * Create a new music sync manager with default configuration
 */
export function createMusicSyncManager(
  config: Partial<MusicSyncManagerConfig> & {
    apiBaseUrl: string;
    authToken: string;
    clientId: string;
  }
): MusicSyncManager {
  // Ensure clientId is a valid UUID, generate one if not
  const clientId =
    config.clientId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      config.clientId
    )
      ? config.clientId
      : crypto.randomUUID();

  const fullConfig: MusicSyncManagerConfig = {
    batchSize: 50,
    maxRetryAttempts: 3,
    retryDelay: 1000,
    conflictResolution: ConflictResolution.Manual,
    enableStorage: true,
    maxStorageSize: 200 * 1024 * 1024, // 200MB
    maxCacheAge: 30,
    syncBinaryData: true,
    musicOptions: {
      autoSyncInterval: 5 * 60 * 1000, // 5 minutes
      enableBackgroundSync: false,
    },
    ...config,
    clientId, // Override with validated UUID
  };

  return new MusicSyncManager(fullConfig);
}

/**
 * Check if music sync is supported in current environment
 */
export function isMusicSyncSupported(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof fetch !== "undefined" &&
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  );
}

/**
 * Get default music sync configuration
 */
export function getDefaultMusicSyncConfig(): Partial<MusicSyncManagerConfig> {
  return {
    batchSize: 50,
    maxRetryAttempts: 3,
    retryDelay: 1000,
    conflictResolution: ConflictResolution.Manual,
    enableStorage: true,
    maxStorageSize: 200 * 1024 * 1024,
    maxCacheAge: 30,
    syncBinaryData: true,
    musicOptions: {
      autoSyncInterval: 5 * 60 * 1000,
      enableBackgroundSync: false,
      favoritesOnly: false,
      publicPlaylistsOnly: false,
    },
  };
}
