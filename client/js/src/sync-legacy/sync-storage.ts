//! Local storage management for offline sync capabilities
//!
//! This module provides client-side storage for media blobs, sync metadata,
//! and offline operations using IndexedDB. It supports caching, conflict
//! resolution, and efficient data retrieval for sync operations.

import { SyncConflict, SyncError } from "./sync-state.js";
import type {
  MediaBlob,
  Song,
  Playlist,
  PlaylistSong,
} from "../lib/websocket-types.js";

/**
 * Local storage entry for a media blob
 */
export interface StoredMediaBlob extends MediaBlob {
  /** Local storage timestamp */
  stored_at: string; // ISO 8601 timestamp
  /** Whether this item has been synced to server */
  synced: boolean;
  /** Whether this item was modified locally */
  locally_modified: boolean;
  /** Hash of the item for change detection */
  content_hash: string;
  /** Storage size in bytes */
  storage_size: number;
}

/**
 * Local storage entry for a song
 */
export interface StoredSong extends Song {
  /** Local storage timestamp */
  stored_at: string; // ISO 8601 timestamp
  /** Whether this item has been synced to server */
  synced: boolean;
  /** Whether this item was modified locally */
  locally_modified: boolean;
  /** Hash of the item for change detection */
  content_hash: string;
  /** Storage size in bytes */
  storage_size: number;
}

/**
 * Local storage entry for a playlist
 */
export interface StoredPlaylist extends Playlist {
  /** Local storage timestamp */
  stored_at: string; // ISO 8601 timestamp
  /** Whether this item has been synced to server */
  synced: boolean;
  /** Whether this item was modified locally */
  locally_modified: boolean;
  /** Hash of the item for change detection */
  content_hash: string;
  /** Storage size in bytes */
  storage_size: number;
}

/**
 * Local storage entry for a playlist song
 */
export interface StoredPlaylistSong extends PlaylistSong {
  /** Local storage timestamp */
  stored_at: string; // ISO 8601 timestamp
  /** Whether this item has been synced to server */
  synced: boolean;
  /** Whether this item was modified locally */
  locally_modified: boolean;
  /** Hash of the item for change detection */
  content_hash: string;
  /** Storage size in bytes */
  storage_size: number;
}

/**
 * Offline operation types
 */
import { OfflineOperationType } from "./sync-constants.js";

// Re-export for convenience
export { OfflineOperationType } from "./sync-constants.js";

/**
 * Offline operation for queuing when disconnected
 */
export interface OfflineOperation {
  /** Unique operation ID */
  id: string;
  /** Type of operation */
  type: OfflineOperationType;
  /** Target media blob ID */
  media_blob_id: string;
  /** Operation data - specific to operation type */
  data: OperationData;
  /** Timestamp when operation was queued */
  queued_at: string; // ISO 8601 timestamp
  /** Number of retry attempts */
  retry_count: number;
  /** Last error if operation failed */
  last_error?: SyncError;
  /** Whether operation should be retried */
  should_retry: boolean;
}

/**
 * Type-safe operation data based on operation type
 */
export type OperationData =
  | { type: "create"; blob: MediaBlob; metadata?: Record<string, unknown> }
  | { type: "update"; changes: Partial<MediaBlob>; version?: string }
  | { type: "delete"; reason?: string; backup?: boolean }
  | { type: "create_song"; song: Song; metadata?: Record<string, unknown> }
  | { type: "update_song"; changes: Partial<Song>; version?: string }
  | { type: "delete_song"; reason?: string; backup?: boolean }
  | {
      type: "create_playlist";
      playlist: Playlist;
      metadata?: Record<string, unknown>;
    }
  | { type: "update_playlist"; changes: Partial<Playlist>; version?: string }
  | { type: "delete_playlist"; reason?: string; backup?: boolean }
  | {
      type: "create_playlist_song";
      playlistSong: PlaylistSong;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "update_playlist_song";
      changes: Partial<PlaylistSong>;
      version?: string;
    }
  | { type: "delete_playlist_song"; reason?: string; backup?: boolean };

/**
 * Storage statistics
 */
export interface StorageStats {
  /** Total items stored */
  total_items: number;
  /** Items that need syncing */
  unsynced_items: number;
  /** Items modified locally */
  locally_modified_items: number;
  /** Total storage size in bytes */
  total_size: number;
  /** Number of pending offline operations */
  pending_operations: number;
  /** Number of conflicts */
  conflicts: number;
  /** Last cleanup timestamp */
  last_cleanup?: string; // ISO 8601 timestamp
  /** Music-specific stats */
  music_stats: {
    /** Total songs stored */
    total_songs: number;
    /** Total playlists stored */
    total_playlists: number;
    /** Total playlist songs stored */
    total_playlist_songs: number;
  };
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Database name */
  database_name: string;
  /** Database version */
  version: number;
  /** Maximum storage size in bytes (0 = unlimited) */
  max_storage_size: number;
  /** Maximum age for cached items in days */
  max_cache_age_days: number;
  /** Cleanup interval in milliseconds */
  cleanup_interval_ms: number;
}

/**
 * Query options for retrieving stored items
 */
export interface StorageQueryOptions {
  /** Limit number of results */
  limit?: number;
  /** Skip number of items */
  offset?: number;
  /** Only return unsynced items */
  unsynced_only?: boolean;
  /** Only return locally modified items */
  locally_modified_only?: boolean;
  /** Filter by MIME type pattern */
  mime_pattern?: string;
  /** Filter by date range */
  created_after?: Date;
  created_before?: Date;
  /** Include binary data in results */
  include_data?: boolean;
}

/**
 * IndexedDB-based storage manager for sync operations
 */
export class SyncStorageManager {
  private db: IDBDatabase | null = null;
  private config: StorageConfig;
  private cleanupTimer?: number;

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = {
      database_name: "webauthn_sync_storage",
      version: 4, // Updated to remove binary_data store
      max_storage_size: 100 * 1024 * 1024, // 100MB default
      max_cache_age_days: 30,
      cleanup_interval_ms: 60 * 60 * 1000, // 1 hour
      ...config,
    };
  }

  /**
   * Initialize the storage manager
   */
  async initialize(): Promise<void> {
    if (this.db) {
      return; // Already initialized
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(
        this.config.database_name,
        this.config.version
      );

      request.onerror = () =>
        reject(new Error(`Failed to open database: ${request.error}`));

      request.onsuccess = () => {
        this.db = request.result;
        this.startCleanupTimer();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStores(db);
      };
    });
  }

  /**
   * Create object stores for first-time setup
   */
  private createStores(db: IDBDatabase): void {
    // Media blobs store
    if (!db.objectStoreNames.contains("media_blobs")) {
      const mediaStore = db.createObjectStore("media_blobs", { keyPath: "id" });
      mediaStore.createIndex("sha256", "sha256", { unique: false });
      mediaStore.createIndex("synced", "synced");
      mediaStore.createIndex("locally_modified", "locally_modified");
      mediaStore.createIndex("created_at", "created_at");
      mediaStore.createIndex("mime", "mime");
      mediaStore.createIndex("stored_at", "stored_at");
    }

    // Songs store
    if (!db.objectStoreNames.contains("songs")) {
      const songsStore = db.createObjectStore("songs", { keyPath: "id" });
      songsStore.createIndex("media_blob_id", "media_blob_id");
      songsStore.createIndex("title", "title");
      songsStore.createIndex("artist", "artist");
      songsStore.createIndex("album", "album");
      songsStore.createIndex("synced", "synced");
      songsStore.createIndex("locally_modified", "locally_modified");
      songsStore.createIndex("created_at", "created_at");
      songsStore.createIndex("stored_at", "stored_at");
      songsStore.createIndex("is_favorite", "is_favorite");
    }

    // Playlists store
    if (!db.objectStoreNames.contains("playlists")) {
      const playlistsStore = db.createObjectStore("playlists", {
        keyPath: "id",
      });
      playlistsStore.createIndex("title", "title");
      playlistsStore.createIndex("client_id", "client_id");
      playlistsStore.createIndex("is_public", "is_public");
      playlistsStore.createIndex("synced", "synced");
      playlistsStore.createIndex("locally_modified", "locally_modified");
      playlistsStore.createIndex("created_at", "created_at");
      playlistsStore.createIndex("stored_at", "stored_at");
    }

    // Playlist songs store
    if (!db.objectStoreNames.contains("playlist_songs")) {
      const playlistSongsStore = db.createObjectStore("playlist_songs", {
        keyPath: "id",
      });
      playlistSongsStore.createIndex("playlist_id", "playlist_id");
      playlistSongsStore.createIndex("song_id", "song_id");
      playlistSongsStore.createIndex("position", "position");
      playlistSongsStore.createIndex("synced", "synced");
      playlistSongsStore.createIndex("locally_modified", "locally_modified");
      playlistSongsStore.createIndex("created_at", "created_at");
      playlistSongsStore.createIndex("stored_at", "stored_at");
    }

    // Offline operations store
    if (!db.objectStoreNames.contains("offline_operations")) {
      const opsStore = db.createObjectStore("offline_operations", {
        keyPath: "id",
      });
      opsStore.createIndex("media_blob_id", "media_blob_id");
      opsStore.createIndex("type", "type");
      opsStore.createIndex("queued_at", "queued_at");
      opsStore.createIndex("should_retry", "should_retry");
    }

    // Conflicts store
    if (!db.objectStoreNames.contains("conflicts")) {
      const conflictsStore = db.createObjectStore("conflicts", {
        keyPath: "id",
      });
      conflictsStore.createIndex("item_id", "item_id");
      conflictsStore.createIndex("item_type", "item_type");
      conflictsStore.createIndex("resolved", "resolved");
      conflictsStore.createIndex("detected_at", "detected_at");
    }

    // Media blob binary data store
    if (!db.objectStoreNames.contains("media_blob_data")) {
      const binaryDataStore = db.createObjectStore("media_blob_data", {
        keyPath: "id",
      });
      binaryDataStore.createIndex("cached_at", "cached_at");
      binaryDataStore.createIndex("size", "size");
      binaryDataStore.createIndex("mime", "mime");
    }

    // Metadata store for storage stats and config
    if (!db.objectStoreNames.contains("metadata")) {
      db.createObjectStore("metadata", { keyPath: "key" });
    }
  }

  /**
   * Store a media blob
   */
  async storeMediaBlob(
    blob: MediaBlob,
    synced: boolean = false,
    locallyModified: boolean = false
  ): Promise<void> {
    await this.ensureInitialized();

    const storedBlob: StoredMediaBlob = {
      ...blob,
      stored_at: new Date().toISOString(),
      synced,
      locally_modified: locallyModified,
      content_hash: await this.calculateContentHash(blob),
      storage_size: this.calculateStorageSize(blob),
    };

    await this.performTransaction("media_blobs", "readwrite", (store) => {
      return store.put(storedBlob);
    });
  }

  /**
   * Retrieve a media blob by ID
   */
  async getMediaBlob(
    id: string,
    includeData: boolean = true
  ): Promise<StoredMediaBlob | null> {
    await this.ensureInitialized();

    const blob = await this.performTransaction(
      "media_blobs",
      "readonly",
      (store) => {
        return store.get(id);
      }
    );

    if (!blob) {
      return null;
    }

    if (!includeData) {
      // Remove binary data for efficiency
      const { data, ...blobWithoutData } = blob;
      return blobWithoutData as StoredMediaBlob;
    }

    return blob;
  }

  /**
   * Query media blobs with filtering options
   */
  async queryMediaBlobs(
    options: StorageQueryOptions = {}
  ): Promise<StoredMediaBlob[]> {
    await this.ensureInitialized();

    return this.performTransaction("media_blobs", "readonly", async (store) => {
      let cursor: IDBRequest<IDBCursorWithValue | null>;

      // Choose appropriate index based on query
      if (options.created_after || options.created_before) {
        const range = this.createDateRange(
          options.created_after,
          options.created_before
        );
        cursor = store.index("created_at").openCursor(range);
      } else {
        cursor = store.openCursor();
      }

      const results: StoredMediaBlob[] = [];
      let count = 0;
      let skipped = 0;

      return new Promise<StoredMediaBlob[]>((resolve, reject) => {
        cursor.onsuccess = () => {
          const cursorResult = cursor.result;
          if (!cursorResult) {
            resolve(results);
            return;
          }

          const blob = cursorResult.value as StoredMediaBlob;

          // Apply filters
          if (this.matchesFilters(blob, options)) {
            // Apply offset
            if (options.offset && skipped < options.offset) {
              skipped++;
            } else {
              // Apply limit
              if (!options.limit || count < options.limit) {
                if (!options.include_data) {
                  const { data, ...blobWithoutData } = blob as any;
                  results.push(blobWithoutData as StoredMediaBlob);
                } else {
                  results.push(blob);
                }
                count++;
              } else {
                resolve(results);
                return;
              }
            }
          }

          cursorResult.continue();
        };

        cursor.onerror = () => reject(cursor.error);
      });
    });
  }

  /**
   * Update media blob sync status
   */
  async markAsSynced(id: string): Promise<void> {
    await this.ensureInitialized();

    return this.performTransaction(
      "media_blobs",
      "readwrite",
      async (store) => {
        const blob = await this.requestToPromise(store.get(id));
        if (blob) {
          blob.synced = true;
          blob.locally_modified = false;
          await this.requestToPromise(store.put(blob));
        }
      }
    );
  }

  /**
   * Mark media blob as locally modified
   */
  async markAsLocallyModified(id: string): Promise<void> {
    await this.ensureInitialized();

    return this.performTransaction(
      "media_blobs",
      "readwrite",
      async (store) => {
        const blob = await this.requestToPromise(store.get(id));
        if (blob) {
          blob.locally_modified = true;
          blob.synced = false;
          blob.content_hash = await this.calculateContentHash(blob);
          await this.requestToPromise(store.put(blob));
        }
      }
    );
  }

  /**
   * Delete a media blob from storage
   */
  async deleteMediaBlob(id: string): Promise<void> {
    await this.ensureInitialized();

    return this.performTransaction("media_blobs", "readwrite", (store) => {
      return store.delete(id);
    });
  }

  /**
   * Store a song
   */
  async storeSong(
    song: Song,
    synced: boolean = false,
    locallyModified: boolean = false
  ): Promise<void> {
    await this.ensureInitialized();

    const storedSong: StoredSong = {
      ...song,
      stored_at: new Date().toISOString(),
      synced,
      locally_modified: locallyModified,
      content_hash: await this.calculateContentHash(song),
      storage_size: this.calculateStorageSize(song),
    };

    await this.performTransaction("songs", "readwrite", (store) => {
      return store.put(storedSong);
    });
  }

  /**
   * Retrieve a song by ID
   */
  async getSong(id: string): Promise<StoredSong | null> {
    await this.ensureInitialized();

    return this.performTransaction("songs", "readonly", async (store) => {
      const song = await this.requestToPromise(store.get(id));
      return song || null;
    });
  }

  /**
   * Query songs with filters
   */
  async querySongs(options: StorageQueryOptions = {}): Promise<StoredSong[]> {
    await this.ensureInitialized();

    return this.performTransaction("songs", "readonly", (store) => {
      const results: StoredSong[] = [];
      const cursor = store.openCursor();
      let count = 0;
      let skipped = 0;

      return new Promise<StoredSong[]>((resolve, reject) => {
        cursor.onsuccess = () => {
          const cursorResult = cursor.result;
          if (!cursorResult) {
            resolve(results);
            return;
          }

          const song = cursorResult.value as StoredSong;

          // Apply filters
          if (this.matchesSongFilters(song, options)) {
            // Apply offset
            if (options.offset && skipped < options.offset) {
              skipped++;
            } else {
              // Apply limit
              if (!options.limit || count < options.limit) {
                results.push(song);
                count++;
              } else {
                resolve(results);
                return;
              }
            }
          }

          cursorResult.continue();
        };

        cursor.onerror = () => reject(cursor.error);
      });
    });
  }

  /**
   * Store a playlist
   */
  async storePlaylist(
    playlist: Playlist,
    synced: boolean = false,
    locallyModified: boolean = false
  ): Promise<void> {
    await this.ensureInitialized();

    const storedPlaylist: StoredPlaylist = {
      ...playlist,
      stored_at: new Date().toISOString(),
      synced,
      locally_modified: locallyModified,
      content_hash: await this.calculateContentHash(playlist),
      storage_size: this.calculateStorageSize(playlist),
    };

    await this.performTransaction("playlists", "readwrite", (store) => {
      return store.put(storedPlaylist);
    });
  }

  /**
   * Retrieve a playlist by ID
   */
  async getPlaylist(id: string): Promise<StoredPlaylist | null> {
    await this.ensureInitialized();

    return this.performTransaction("playlists", "readonly", async (store) => {
      const playlist = await this.requestToPromise(store.get(id));
      return playlist || null;
    });
  }

  /**
   * Query playlists with filters
   */
  async queryPlaylists(
    options: StorageQueryOptions = {}
  ): Promise<StoredPlaylist[]> {
    await this.ensureInitialized();

    return this.performTransaction("playlists", "readonly", (store) => {
      const results: StoredPlaylist[] = [];
      const cursor = store.openCursor();
      let count = 0;
      let skipped = 0;

      return new Promise<StoredPlaylist[]>((resolve, reject) => {
        cursor.onsuccess = () => {
          const cursorResult = cursor.result;
          if (!cursorResult) {
            resolve(results);
            return;
          }

          const playlist = cursorResult.value as StoredPlaylist;

          // Apply filters
          if (this.matchesPlaylistFilters(playlist, options)) {
            // Apply offset
            if (options.offset && skipped < options.offset) {
              skipped++;
            } else {
              // Apply limit
              if (!options.limit || count < options.limit) {
                results.push(playlist);
                count++;
              } else {
                resolve(results);
                return;
              }
            }
          }

          cursorResult.continue();
        };

        cursor.onerror = () => reject(cursor.error);
      });
    });
  }

  /**
   * Store a playlist song
   */
  async storePlaylistSong(
    playlistSong: PlaylistSong,
    synced: boolean = false,
    locallyModified: boolean = false
  ): Promise<void> {
    await this.ensureInitialized();

    const storedPlaylistSong: StoredPlaylistSong = {
      ...playlistSong,
      stored_at: new Date().toISOString(),
      synced,
      locally_modified: locallyModified,
      content_hash: await this.calculateContentHash(playlistSong),
      storage_size: this.calculateStorageSize(playlistSong),
    };

    await this.performTransaction("playlist_songs", "readwrite", (store) => {
      return store.put(storedPlaylistSong);
    });
  }

  /**
   * Retrieve playlist songs by playlist ID
   */
  async getPlaylistSongs(playlistId: string): Promise<StoredPlaylistSong[]> {
    await this.ensureInitialized();

    return this.performTransaction("playlist_songs", "readonly", (store) => {
      const results: StoredPlaylistSong[] = [];
      const index = store.index("playlist_id");
      const cursor = index.openCursor(playlistId);

      return new Promise<StoredPlaylistSong[]>((resolve, reject) => {
        cursor.onsuccess = () => {
          const cursorResult = cursor.result;
          if (!cursorResult) {
            resolve(results);
            return;
          }

          results.push(cursorResult.value as StoredPlaylistSong);
          cursorResult.continue();
        };

        cursor.onerror = () => reject(cursor.error);
      });
    });
  }

  /**
   * Mark song as synced
   */
  async markSongAsSynced(id: string): Promise<void> {
    await this.ensureInitialized();

    return this.performTransaction("songs", "readwrite", async (store) => {
      const song = await this.requestToPromise(store.get(id));
      if (song) {
        song.synced = true;
        song.locally_modified = false;
        await this.requestToPromise(store.put(song));
      }
    });
  }

  /**
   * Mark playlist as synced
   */
  async markPlaylistAsSynced(id: string): Promise<void> {
    await this.ensureInitialized();

    return this.performTransaction("playlists", "readwrite", async (store) => {
      const playlist = await this.requestToPromise(store.get(id));
      if (playlist) {
        playlist.synced = true;
        playlist.locally_modified = false;
        await this.requestToPromise(store.put(playlist));
      }
    });
  }

  /**
   * Mark playlist song as synced
   */
  async markPlaylistSongAsSynced(id: string): Promise<void> {
    await this.ensureInitialized();

    return this.performTransaction(
      "playlist_songs",
      "readwrite",
      async (store) => {
        const playlistSong = await this.requestToPromise(store.get(id));
        if (playlistSong) {
          playlistSong.synced = true;
          playlistSong.locally_modified = false;
          await this.requestToPromise(store.put(playlistSong));
        }
      }
    );
  }

  /**
   * Queue an offline operation
   */
  async queueOfflineOperation(
    type: OfflineOperationType,
    mediaBlobId: string,
    data: OperationData
  ): Promise<string> {
    await this.ensureInitialized();

    const operation: OfflineOperation = {
      id: crypto.randomUUID(),
      type,
      media_blob_id: mediaBlobId,
      data,
      queued_at: new Date().toISOString(),
      retry_count: 0,
      should_retry: true,
    };

    await this.performTransaction(
      "offline_operations",
      "readwrite",
      (store) => {
        return store.put(operation);
      }
    );

    return operation.id;
  }

  /**
   * Get pending offline operations
   */
  async getPendingOperations(): Promise<OfflineOperation[]> {
    await this.ensureInitialized();

    return this.performTransaction(
      "offline_operations",
      "readonly",
      (store) => {
        return new Promise<OfflineOperation[]>((resolve, reject) => {
          const request = store.openCursor();
          const operations: OfflineOperation[] = [];

          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
              const operation = cursor.value as OfflineOperation;
              if (operation.should_retry) {
                operations.push(operation);
              }
              cursor.continue();
            } else {
              // Sort by queued_at timestamp
              operations.sort(
                (a, b) =>
                  new Date(a.queued_at).getTime() -
                  new Date(b.queued_at).getTime()
              );
              resolve(operations);
            }
          };

          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Mark offline operation as completed
   */
  async completeOfflineOperation(id: string): Promise<void> {
    await this.ensureInitialized();

    return this.performTransaction(
      "offline_operations",
      "readwrite",
      (store) => {
        return store.delete(id);
      }
    );
  }

  /**
   * Mark offline operation as failed
   */
  async failOfflineOperation(id: string, error: SyncError): Promise<void> {
    await this.ensureInitialized();

    return this.performTransaction(
      "offline_operations",
      "readwrite",
      async (store) => {
        const operation = await this.requestToPromise(store.get(id));
        if (operation) {
          operation.retry_count++;
          operation.last_error = error;
          // Stop retrying after 5 attempts or if error is not recoverable
          operation.should_retry =
            operation.retry_count < 5 && error.recoverable !== false;
          await this.requestToPromise(store.put(operation));
        }
      }
    );
  }

  /**
   * Store a sync conflict
   */
  async storeConflict(conflict: SyncConflict): Promise<void> {
    await this.ensureInitialized();

    await this.performTransaction("conflicts", "readwrite", (store) => {
      return store.put(conflict);
    });
  }

  /**
   * Get unresolved conflicts
   */
  async getUnresolvedConflicts(): Promise<SyncConflict[]> {
    await this.ensureInitialized();

    return this.performTransaction("conflicts", "readonly", (store) => {
      return new Promise<SyncConflict[]>((resolve, reject) => {
        const request = store.openCursor();
        const conflicts: SyncConflict[] = [];

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const conflict = cursor.value as SyncConflict;
            if (!conflict.resolved) {
              conflicts.push(conflict);
            }
            cursor.continue();
          } else {
            resolve(conflicts);
          }
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    conflictId: string,
    resolution: "keep_local" | "keep_server" | "merge" | "skip"
  ): Promise<void> {
    await this.ensureInitialized();

    return this.performTransaction("conflicts", "readwrite", async (store) => {
      const conflict = await this.requestToPromise(store.get(conflictId));
      if (conflict) {
        conflict.resolved = true;
        conflict.resolution = resolution;
        await this.requestToPromise(store.put(conflict));
      }
    });
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    await this.ensureInitialized();

    const [mediaStats, musicStats, operationsCount, conflictsCount] =
      await Promise.all([
        this.getMediaBlobStats(),
        this.getMusicStats(),
        this.getOperationsCount(),
        this.getConflictsCount(),
      ]);

    return {
      ...mediaStats,
      pending_operations: operationsCount,
      conflicts: conflictsCount,
      music_stats: musicStats,
    };
  }

  /**
   * Clean up old data
   */
  async cleanup(): Promise<void> {
    await this.ensureInitialized();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.max_cache_age_days);

    // Clean up old synced items
    await this.performTransaction("media_blobs", "readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const request = store
          .index("stored_at")
          .openCursor(IDBKeyRange.upperBound(cutoffDate.toISOString()));

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const blob = cursor.value as StoredMediaBlob;
            // Only delete if synced and not locally modified
            if (blob.synced && !blob.locally_modified) {
              cursor.delete();
            }
            cursor.continue();
          } else {
            resolve();
          }
        };

        request.onerror = () => reject(request.error);
      });
    });

    // Update cleanup timestamp
    await this.performTransaction("metadata", "readwrite", (store) => {
      return store.put({
        key: "last_cleanup",
        value: new Date().toISOString(),
      });
    });
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();

    const storeNames = [
      "media_blobs",
      "offline_operations",
      "conflicts",
      "metadata",
    ];

    for (const storeName of storeNames) {
      await this.performTransaction(storeName, "readwrite", (store) => {
        return store.clear();
      });
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Private helper methods

  private async ensureInitialized(): Promise<void> {
    if (!this.db) {
      await this.initialize();
    }
  }

  /**
   * Helper to wrap IDBRequest as Promise
   */
  private requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async performTransaction<T>(
    storeName: string,
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
  ): Promise<T> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    return new Promise<T>((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], mode);
      const store = transaction.objectStore(storeName);

      transaction.oncomplete = () => {
        // Transaction completed successfully
      };

      transaction.onerror = () => reject(transaction.error);

      try {
        const result = callback(store);
        if (result instanceof Promise) {
          result.then(resolve).catch(reject);
        } else {
          result.onsuccess = () => resolve(result.result);
          result.onerror = () => reject(result.error);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  private matchesFilters(
    blob: StoredMediaBlob,
    options: StorageQueryOptions
  ): boolean {
    if (options.unsynced_only && blob.synced) {
      return false;
    }

    if (options.locally_modified_only && !blob.locally_modified) {
      return false;
    }

    if (options.mime_pattern && (blob as MediaBlob).mime) {
      const pattern = new RegExp(options.mime_pattern, "i");
      if (!pattern.test((blob as MediaBlob).mime!)) {
        return false;
      }
    }

    return true;
  }

  private matchesSongFilters(
    song: StoredSong,
    options: StorageQueryOptions
  ): boolean {
    if (options.unsynced_only && song.synced) {
      return false;
    }

    if (options.locally_modified_only && !song.locally_modified) {
      return false;
    }

    return true;
  }

  private matchesPlaylistFilters(
    playlist: StoredPlaylist,
    options: StorageQueryOptions
  ): boolean {
    if (options.unsynced_only && playlist.synced) {
      return false;
    }

    if (options.locally_modified_only && !playlist.locally_modified) {
      return false;
    }

    return true;
  }

  private createDateRange(
    after?: Date,
    before?: Date
  ): IDBKeyRange | undefined {
    if (after && before) {
      return IDBKeyRange.bound(after.toISOString(), before.toISOString());
    } else if (after) {
      return IDBKeyRange.lowerBound(after.toISOString());
    } else if (before) {
      return IDBKeyRange.upperBound(before.toISOString());
    }
    return undefined;
  }

  private async calculateContentHash(
    item: MediaBlob | Song | Playlist | PlaylistSong
  ): Promise<string> {
    // Simple hash based on key properties
    let content: string;

    if ("sha256" in item) {
      // MediaBlob
      content = JSON.stringify({
        sha256: item.sha256,
        size: item.size,
        mime: item.mime,
        metadata: item.metadata,
        updated_at: item.updated_at,
      });
    } else if ("media_blob_id" in item && "title" in item) {
      // Song
      content = JSON.stringify({
        id: item.id,
        title: item.title,
        artist: item.artist,
        album: item.album,
        metadata: item.metadata,
        updated_at: item.updated_at,
        version: item.version,
      });
    } else if ("title" in item && !("media_blob_id" in item)) {
      // Playlist
      content = JSON.stringify({
        id: item.id,
        title: item.title,
        description: item.description || null,
        metadata: item.metadata,
        updated_at: item.updated_at,
        version: item.version,
      });
    } else {
      // PlaylistSong
      content = JSON.stringify({
        id: item.id,
        playlist_id: (item as PlaylistSong).playlist_id,
        song_id: (item as PlaylistSong).song_id,
        position: (item as PlaylistSong).position,
        metadata: item.metadata,
        created_at: item.created_at,
      });
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  private calculateStorageSize(
    item: MediaBlob | Song | Playlist | PlaylistSong
  ): number {
    let size = 0;

    // Estimate size of all properties
    size += JSON.stringify(item).length * 2; // UTF-16 encoding

    // Add binary data size if present (for MediaBlob)
    if ("data" in item && item.data) {
      size += item.data.length;
    }

    return size;
  }

  private async getMediaBlobStats(): Promise<
    Omit<StorageStats, "pending_operations" | "conflicts">
  > {
    return this.performTransaction("media_blobs", "readonly", (store) => {
      return new Promise<
        Omit<StorageStats, "pending_operations" | "conflicts">
      >((resolve, reject) => {
        const request = store.openCursor();

        let totalItems = 0;
        let unsyncedItems = 0;
        let locallyModifiedItems = 0;
        let totalSize = 0;

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const blob = cursor.value as StoredMediaBlob;
            totalItems++;
            totalSize += blob.storage_size;

            if (!blob.synced) {
              unsyncedItems++;
            }

            if (blob.locally_modified) {
              locallyModifiedItems++;
            }

            cursor.continue();
          } else {
            resolve({
              total_items: totalItems,
              unsynced_items: unsyncedItems,
              locally_modified_items: locallyModifiedItems,
              total_size: totalSize,
              music_stats: {
                total_songs: 0,
                total_playlists: 0,
                total_playlist_songs: 0,
              },
            });
          }
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  private async getOperationsCount(): Promise<number> {
    return this.performTransaction(
      "offline_operations",
      "readonly",
      (store) => {
        return new Promise<number>((resolve, reject) => {
          const request = store.count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  private async getConflictsCount(): Promise<number> {
    return this.performTransaction("conflicts", "readonly", (store) => {
      return new Promise<number>((resolve, reject) => {
        const request = store.openCursor();
        let count = 0;

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const conflict = cursor.value as SyncConflict;
            if (!conflict.resolved) {
              count++;
            }
            cursor.continue();
          } else {
            resolve(count);
          }
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  private async getMusicStats() {
    const [songStats, playlistStats, playlistSongStats] = await Promise.all([
      this.getSongStats(),
      this.getPlaylistStats(),
      this.getPlaylistSongStats(),
    ]);

    return {
      total_songs: songStats.total,
      total_playlists: playlistStats.total,
      total_playlist_songs: playlistSongStats.total,
    };
  }

  private async getSongStats(): Promise<{ total: number }> {
    return this.performTransaction("songs", "readonly", (store) => {
      return new Promise<{ total: number }>((resolve, reject) => {
        const request = store.count();
        request.onsuccess = () => resolve({ total: request.result });
        request.onerror = () => reject(request.error);
      });
    });
  }

  private async getPlaylistStats(): Promise<{ total: number }> {
    return this.performTransaction("playlists", "readonly", (store) => {
      return new Promise<{ total: number }>((resolve, reject) => {
        const request = store.count();
        request.onsuccess = () => resolve({ total: request.result });
        request.onerror = () => reject(request.error);
      });
    });
  }

  private async getPlaylistSongStats(): Promise<{ total: number }> {
    return this.performTransaction("playlist_songs", "readonly", (store) => {
      return new Promise<{ total: number }>((resolve, reject) => {
        const request = store.count();
        request.onsuccess = () => resolve({ total: request.result });
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Store binary data for a media blob
   */
  async storeBinaryData(
    blobId: string,
    data: Uint8Array,
    mime: string
  ): Promise<void> {
    await this.ensureInitialized();

    const binaryData = {
      id: blobId,
      data,
      mime,
      size: data.length,
      cached_at: new Date().toISOString(),
    };

    await this.performTransaction("media_blob_data", "readwrite", (store) => {
      return this.requestToPromise(store.put(binaryData));
    });
  }

  /**
   * Get binary data for a media blob
   */
  async getBinaryData(blobId: string): Promise<{
    id: string;
    data: Uint8Array;
    mime: string;
    size: number;
    cached_at: string;
  } | null> {
    await this.ensureInitialized();

    return this.performTransaction("media_blob_data", "readonly", (store) => {
      return this.requestToPromise(store.get(blobId));
    });
  }

  /**
   * Check if binary data exists for a media blob
   */
  async hasBinaryData(blobId: string): Promise<boolean> {
    const data = await this.getBinaryData(blobId);
    return data !== null;
  }

  /**
   * Delete binary data for a media blob
   */
  async deleteBinaryData(blobId: string): Promise<void> {
    await this.ensureInitialized();

    await this.performTransaction("media_blob_data", "readwrite", (store) => {
      return this.requestToPromise(store.delete(blobId));
    });
  }

  /**
   * Get all binary data entries
   */
  async getAllBinaryData(): Promise<
    Array<{
      id: string;
      data: Uint8Array;
      mime: string;
      size: number;
      cached_at: string;
    }>
  > {
    await this.ensureInitialized();

    return this.performTransaction("media_blob_data", "readonly", (store) => {
      return new Promise((resolve, reject) => {
        const results: any[] = [];
        const request = store.openCursor();

        request.onsuccess = (event: Event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Get binary data statistics
   */
  async getBinaryDataStats(): Promise<{
    totalItems: number;
    totalSize: number;
    oldestEntry?: string;
    newestEntry?: string;
  }> {
    await this.ensureInitialized();

    return this.performTransaction("media_blob_data", "readonly", (store) => {
      return new Promise((resolve, reject) => {
        let totalItems = 0;
        let totalSize = 0;
        let oldestEntry: string | undefined;
        let newestEntry: string | undefined;

        const request = store.openCursor();

        request.onsuccess = (event: Event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const data = cursor.value;
            totalItems++;
            totalSize += data.size;

            if (!oldestEntry || data.cached_at < oldestEntry) {
              oldestEntry = data.cached_at;
            }
            if (!newestEntry || data.cached_at > newestEntry) {
              newestEntry = data.cached_at;
            }

            cursor.continue();
          } else {
            resolve({
              totalItems,
              totalSize,
              oldestEntry,
              newestEntry,
            });
          }
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Clean up old binary data entries
   */
  async cleanupBinaryData(maxAgeMs: number): Promise<{
    removed: number;
    freedBytes: number;
  }> {
    await this.ensureInitialized();

    const cutoffDate = new Date(Date.now() - maxAgeMs).toISOString();
    let removed = 0;
    let freedBytes = 0;

    await this.performTransaction("media_blob_data", "readwrite", (store) => {
      return new Promise((resolve, reject) => {
        const index = store.index("cached_at");
        const request = index.openCursor(IDBKeyRange.upperBound(cutoffDate));

        request.onsuccess = (event: Event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const data = cursor.value;
            cursor.delete();
            removed++;
            freedBytes += data.size;
            cursor.continue();
          } else {
            resolve({ removed, freedBytes });
          }
        };

        request.onerror = () => reject(request.error);
      });
    });

    return { removed, freedBytes };
  }

  private startCleanupTimer(): void {
    if (this.config.cleanup_interval_ms > 0) {
      this.cleanupTimer = window.setInterval(() => {
        this.cleanup().catch((error) => {
          console.warn("Automatic cleanup failed:", error);
        });
      }, this.config.cleanup_interval_ms);
    }
  }
}
