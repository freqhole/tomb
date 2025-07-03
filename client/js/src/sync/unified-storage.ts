//! Unified Storage Implementation
//!
//! This module provides a unified storage interface for the new sync system.
//! It uses IndexedDB for efficient storage of both structured data and binary content
//! across multiple domains (music, photos, documents, etc.).

import type {
  UnifiedStorage,
  SyncDomain,
  StorageQueryOptions,
  StorageStats,
  StorageConfig,
} from "./types.js";
import { debugInfo, debugWarn, debugError } from "./debug.js";

/**
 * IndexedDB-based unified storage implementation
 */
export class UnifiedStorageImpl implements UnifiedStorage {
  private config: StorageConfig;
  private db: IDBDatabase | null = null;
  private dbName: string;
  private dbVersion: number;

  // Core tables matching server schema
  private readonly DOMAIN_TABLES = {
    // Music domain tables
    songs: "songs",
    playlists: "playlists",
    playlist_songs: "playlist_songs",
    // Shared filesystem layer
    media_blobs: "media_blobs",
    // Binary data storage
    media_blob_data: "media_blob_data",
  };

  private readonly METADATA_STORE = "sync_metadata";

  // Music domain uses multiple tables
  private getMusicTables() {
    return ["songs", "playlists", "playlist_songs"];
  }

  // Get primary table for domain
  private getDomainTable(domain: SyncDomain): string {
    switch (domain) {
      case "music":
        return "songs"; // Primary table for music
      case "photos":
      case "documents":
      case "videos":
        return "media_blobs";
      default:
        return "media_blobs";
    }
  }

  constructor(config: StorageConfig) {
    this.config = config;
    this.dbName = config.databaseName;
    this.dbVersion = config.version;
  }

  /**
   * Initialize the storage system
   */
  async initialize(): Promise<void> {
    debugInfo(
      `📦 Initializing unified storage: ${this.dbName} v${this.dbVersion}`
    );

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        debugInfo("✅ Unified storage initialized");
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.setupDatabase(db);
      };
    });
  }

  /**
   * Store items for a specific domain
   */
  async storeItems(domain: SyncDomain, items: any[]): Promise<void> {
    if (!this.db) throw new Error("Storage not initialized");

    if (domain === "music") {
      return this.storeMusicItems(items);
    }

    // Other domains use single table
    const storeName = this.getDomainTable(domain);
    const transaction = this.db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);

    for (const item of items) {
      await this.promisifyRequest(
        store.put({
          ...item,
          _domain: domain,
          _stored_at: new Date().toISOString(),
        })
      );
    }

    await this.updateDomainMetadata(domain, {
      last_sync: new Date().toISOString(),
      item_count: await this.countItems(domain),
    });

    debugInfo(`💾 Stored ${items.length} items for domain: ${domain}`);
  }

  /**
   * Store items directly to a specific table
   */
  async storeItemsToTable(tableName: string, items: any[]): Promise<void> {
    if (!this.db) throw new Error("Storage not initialized");

    const transaction = this.db.transaction([tableName], "readwrite");
    const store = transaction.objectStore(tableName);

    for (const item of items) {
      await this.promisifyRequest(
        store.put({
          ...item,
          _stored_at: new Date().toISOString(),
        })
      );
    }

    debugInfo(`💾 Stored ${items.length} items to table: ${tableName}`);
  }

  private async storeMusicItems(items: any[]): Promise<void> {
    if (!this.db) throw new Error("Storage not initialized");

    // Group items by type
    const songs = items.filter(
      (item) => !item._data_type || item._data_type === "songs"
    );
    const playlists = items.filter((item) => item._data_type === "playlists");
    const playlistSongs = items.filter(
      (item) => item._data_type === "playlist-songs"
    );

    const tables = this.getMusicTables();
    const transaction = this.db.transaction(tables, "readwrite");

    // Store songs
    if (songs.length > 0) {
      const songsStore = transaction.objectStore("songs");
      for (const song of songs) {
        const { _data_type, ...cleanSong } = song;
        await this.promisifyRequest(
          songsStore.put({
            ...cleanSong,
            _stored_at: new Date().toISOString(),
          })
        );
      }
    }

    // Store playlists
    if (playlists.length > 0) {
      const playlistsStore = transaction.objectStore("playlists");
      for (const playlist of playlists) {
        const { _data_type, ...cleanPlaylist } = playlist;
        await this.promisifyRequest(
          playlistsStore.put({
            ...cleanPlaylist,
            _stored_at: new Date().toISOString(),
          })
        );
      }
    }

    // Store playlist_songs
    if (playlistSongs.length > 0) {
      const playlistSongsStore = transaction.objectStore("playlist_songs");
      for (const playlistSong of playlistSongs) {
        const { _data_type, ...cleanPlaylistSong } = playlistSong;
        await this.promisifyRequest(
          playlistSongsStore.put({
            ...cleanPlaylistSong,
            _stored_at: new Date().toISOString(),
          })
        );
      }
    }

    debugInfo(
      `🎵 Stored music: ${songs.length} songs, ${playlists.length} playlists, ${playlistSongs.length} playlist_songs`
    );
  }

  /**
   * Get items from a domain with optional filtering
   */
  async getItems(
    domain: SyncDomain,
    options: StorageQueryOptions = {}
  ): Promise<any[]> {
    if (!this.db) throw new Error("Storage not initialized");

    if (domain === "music") {
      return this.getMusicItems(options);
    }

    const storeName = this.getDomainTable(domain);
    const transaction = this.db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);

    const request = store.getAll();
    const allItems = await this.promisifyRequest(request);

    return this.applyQueryOptions(allItems, options);
  }

  private async getMusicItems(
    options: StorageQueryOptions = {}
  ): Promise<any[]> {
    if (!this.db) throw new Error("Storage not initialized");

    const tables = this.getMusicTables();
    const transaction = this.db.transaction(tables, "readonly");

    // Get songs by default, or specific table if requested
    const tableName = "songs"; // Default to songs table for music domain
    const store = transaction.objectStore(tableName);
    const request = store.getAll();
    const items = await this.promisifyRequest(request);

    return this.applyQueryOptions(items, options);
  }

  private applyQueryOptions(items: any[], options: StorageQueryOptions): any[] {
    let filteredItems = items;

    // Apply where conditions
    if (options.where) {
      filteredItems = filteredItems.filter((item) => {
        return Object.entries(options.where!).every(([key, value]) => {
          return item[key] === value;
        });
      });
    }

    // Apply sorting
    if (options.sortBy) {
      const sortField = options.sortBy;
      const sortOrder = options.sortOrder || "asc";

      filteredItems.sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];

        if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
        if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
        return 0;
      });
    }

    // Apply pagination
    if (options.offset || options.limit) {
      const start = options.offset || 0;
      const end = options.limit ? start + options.limit : undefined;
      filteredItems = filteredItems.slice(start, end);
    }

    return filteredItems;
  }

  /**
   * Get a single item by ID
   */
  async getItem(domain: SyncDomain, id: string): Promise<any | null> {
    if (!this.db) throw new Error("Storage not initialized");

    const storeName = this.getDomainTable(domain);
    const transaction = this.db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);

    const request = store.get(id);
    const result = await this.promisifyRequest(request);

    return result || null;
  }

  /**
   * Delete items by IDs
   */
  async deleteItems(domain: SyncDomain, ids: string[]): Promise<void> {
    if (!this.db) throw new Error("Storage not initialized");

    const storeName = this.getDomainTable(domain);
    const transaction = this.db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);

    for (const id of ids) {
      await this.promisifyRequest(store.delete(id));
    }

    // Update metadata
    await this.updateDomainMetadata(domain, {
      item_count: await this.countItems(domain),
    });

    console.log(`🗑️ Deleted ${ids.length} items from domain: ${domain}`);
  }

  /**
   * Clear all data for a domain
   */
  async clearDomain(domain: SyncDomain): Promise<void> {
    if (!this.db) throw new Error("Storage not initialized");

    const storeName = this.getDomainTable(domain);
    const transaction = this.db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);

    await this.promisifyRequest(store.clear());

    // Update metadata
    await this.updateDomainMetadata(domain, {
      last_sync: null,
      item_count: 0,
    });

    debugInfo(`🧹 Cleared all data for domain: ${domain}`);
  }

  /**
   * Store raw binary data (simple blob ID -> ArrayBuffer storage as per plan)
   */
  async storeBinaryData(blobId: string, data: ArrayBuffer): Promise<void> {
    if (!this.db) throw new Error("Storage not initialized");

    // Check size limits
    if (data.byteLength > this.config.maxSize) {
      throw new Error(
        `Binary data too large: ${data.byteLength} > ${this.config.maxSize}`
      );
    }

    const storeName = this.DOMAIN_TABLES.media_blob_data;
    const transaction = this.db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);

    // Store just the raw binary data with blob ID as key (as per plan)
    await this.promisifyRequest(
      store.put({
        id: blobId,
        data,
        stored_at: new Date().toISOString(),
      })
    );

    debugInfo(`📦 Stored binary data: ${blobId} (${data.byteLength} bytes)`);
  }

  /**
   * Get raw binary data by blob ID (simple access as per plan)
   */
  async getBinaryData(blobId: string): Promise<ArrayBuffer | null> {
    if (!this.db) throw new Error("Storage not initialized");

    const storeName = this.DOMAIN_TABLES.media_blob_data;
    const transaction = this.db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);

    const request = store.get(blobId);
    const result = await this.promisifyRequest(request);

    if (!result) return null;

    // Check if data has expired
    const storedAt = new Date(result.stored_at);
    const ageInDays = Math.floor(
      (Date.now() - storedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (ageInDays > this.config.maxAge) {
      // Data has expired, delete it
      await this.deleteBinaryData(blobId);
      return null;
    }

    return result.data;
  }

  /**
   * Delete binary data by blob ID
   */
  async deleteBinaryData(blobId: string): Promise<void> {
    if (!this.db) throw new Error("Storage not initialized");

    const storeName = this.DOMAIN_TABLES.media_blob_data;
    const transaction = this.db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);

    await this.promisifyRequest(store.delete(blobId));
    debugInfo(`🗑️ Deleted binary data: ${blobId}`);
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    if (!this.db) throw new Error("Storage not initialized");

    // Get item counts for each domain
    const itemCounts: Record<SyncDomain, number> = {
      music: await this.countItems("music"),
      photos: await this.countItems("photos"),
      documents: await this.countItems("documents"),
      videos: await this.countItems("videos"),
    };

    // Get binary data size
    const binarySize = await this.calculateBinarySize();

    // Get last sync times
    const lastSyncTimes: Record<SyncDomain, Date | null> = {
      music: await this.getLastSyncTime("music"),
      photos: await this.getLastSyncTime("photos"),
      documents: await this.getLastSyncTime("documents"),
      videos: await this.getLastSyncTime("videos"),
    };

    // Estimate total size (rough calculation)
    const totalSize =
      binarySize + Object.values(itemCounts).reduce((a, b) => a + b, 0) * 1024; // Assume 1KB per item

    return {
      itemCounts,
      totalSize,
      binarySize,
      lastSyncTimes,
    };
  }

  /**
   * Get count for a specific table
   */
  async getTableCount(tableName: string): Promise<number> {
    if (!this.db) throw new Error("Storage not initialized");

    try {
      const transaction = this.db.transaction([tableName], "readonly");
      const store = transaction.objectStore(tableName);
      const countRequest = store.count();

      return await this.promisifyRequest(countRequest);
    } catch (error) {
      debugWarn(`Failed to get count for table ${tableName}:`, error);
      return 0;
    }
  }

  /**
   * Get detailed music domain breakdown
   */
  async getMusicBreakdown(): Promise<{
    songs: number;
    playlists: number;
    playlistSongs: number;
  }> {
    if (!this.db) throw new Error("Storage not initialized");

    const [songs, playlists, playlistSongs] = await Promise.all([
      this.getTableCount("songs"),
      this.getTableCount("playlists"),
      this.getTableCount("playlist_songs"),
    ]);

    return { songs, playlists, playlistSongs };
  }

  /**
   * Save sync completion state
   */
  async saveSyncCompletion(
    domain: SyncDomain,
    itemsSynced: number
  ): Promise<void> {
    if (!this.db) throw new Error("Storage not initialized");

    debugInfo(`💾 Saving sync completion for ${domain}: ${itemsSynced} items`);

    await this.updateDomainMetadata(domain, {
      last_sync: new Date().toISOString(),
      item_count: itemsSynced,
      sync_status: "complete",
    });

    debugInfo(`✅ Sync completion saved for ${domain}`);
  }

  /**
   * Cleanup old and expired data
   */
  async cleanup(): Promise<void> {
    console.log("🧹 Starting storage cleanup...");

    const maxAge = this.config.maxAge * 24 * 60 * 60 * 1000; // Convert days to ms
    const cutoffTime = Date.now() - maxAge;

    let cleanedCount = 0;
    let freedBytes = 0;

    if (!this.db) throw new Error("Storage not initialized");

    // Clean up expired binary data
    const storeName = this.DOMAIN_TABLES.media_blob_data;
    const transaction = this.db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);

    const request = store.openCursor();

    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;

        if (cursor) {
          const record = cursor.value;
          const storedAt = new Date(record.stored_at).getTime();

          if (storedAt < cutoffTime) {
            freedBytes += record.data.byteLength;
            cleanedCount++;
            cursor.delete();
          }

          cursor.continue();
        } else {
          console.log(
            `🧹 Cleanup completed: ${cleanedCount} items, ${freedBytes} bytes freed`
          );
          resolve();
        }
      };

      request.onerror = () => {
        reject(new Error(`Cleanup failed: ${request.error?.message}`));
      };
    });
  }

  // Private helper methods

  private setupDatabase(db: IDBDatabase): void {
    debugInfo("🔧 Setting up database schema...");

    // Create all tables matching server schema
    Object.entries(this.DOMAIN_TABLES).forEach(([tableName, storeName]) => {
      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: "id" });

        // Common indices
        store.createIndex("_stored_at", "_stored_at");

        // Table-specific indices
        switch (tableName) {
          case "songs":
            store.createIndex("title", "title");
            store.createIndex("artist", "artist");
            store.createIndex("album", "album");
            store.createIndex("created_at", "created_at");
            break;
          case "playlists":
            store.createIndex("title", "title");
            store.createIndex("created_at", "created_at");
            break;
          case "playlist_songs":
            store.createIndex("playlist_id", "playlist_id");
            store.createIndex("song_id", "song_id");
            store.createIndex("position", "position");
            break;
          case "media_blobs":
            store.createIndex("created_at", "created_at");
            store.createIndex("mime_type", "mime_type");
            store.createIndex("sha256", "sha256");
            break;
          case "media_blob_data":
            // Binary data store - just blob_id -> data
            break;
        }
      }
    });

    // Create metadata store
    if (!db.objectStoreNames.contains(this.METADATA_STORE)) {
      db.createObjectStore(this.METADATA_STORE, { keyPath: "domain" });
    }

    debugInfo("✅ Database schema setup complete");
  }

  private async promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async countItems(domain: SyncDomain): Promise<number> {
    if (!this.db) return 0;

    if (domain === "music") {
      // Count all music tables combined
      const tables = this.getMusicTables();
      const transaction = this.db.transaction(tables, "readonly");
      let total = 0;
      for (const tableName of tables) {
        const store = transaction.objectStore(tableName);
        const request = store.count();
        total += await this.promisifyRequest(request);
      }
      return total;
    }

    const storeName = this.getDomainTable(domain);
    const transaction = this.db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);

    const request = store.count();
    return await this.promisifyRequest(request);
  }

  private async calculateBinarySize(): Promise<number> {
    if (!this.db) return 0;

    const storeName = this.DOMAIN_TABLES.media_blob_data;
    const transaction = this.db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);

    let totalSize = 0;
    const request = store.openCursor();

    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;

        if (cursor) {
          totalSize += cursor.value.data.byteLength;
          cursor.continue();
        } else {
          resolve(totalSize);
        }
      };

      request.onerror = () => {
        reject(
          new Error(
            `Failed to calculate binary size: ${request.error?.message}`
          )
        );
      };
    });
  }

  private async getLastSyncTime(domain: SyncDomain): Promise<Date | null> {
    const metadata = await this.getDomainMetadata(domain);
    return metadata?.last_sync ? new Date(metadata.last_sync) : null;
  }

  private async updateDomainMetadata(
    domain: SyncDomain,
    updates: any
  ): Promise<void> {
    if (!this.db) return;

    const transaction = this.db.transaction([this.METADATA_STORE], "readwrite");
    const store = transaction.objectStore(this.METADATA_STORE);

    // Get existing metadata
    const existing = (await this.promisifyRequest(store.get(domain))) || {
      domain,
    };

    // Merge updates
    const updated = { ...existing, ...updates };

    // Store updated metadata
    await this.promisifyRequest(store.put(updated));
  }

  private async getDomainMetadata(domain: SyncDomain): Promise<any | null> {
    if (!this.db) return null;

    const transaction = this.db.transaction([this.METADATA_STORE], "readonly");
    const store = transaction.objectStore(this.METADATA_STORE);

    const request = store.get(domain);
    return await this.promisifyRequest(request);
  }

  /**
   * Completely destroy all data and the database
   */
  async destroyAll(): Promise<void> {
    debugInfo("💥 Starting complete database teardown...");

    // Close the current database connection
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    // Delete the entire database
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(this.dbName);

      deleteRequest.onsuccess = () => {
        debugInfo("🗑️ Database completely destroyed:", this.dbName);
        resolve();
      };

      deleteRequest.onerror = () => {
        debugError("❌ Failed to destroy database:", deleteRequest.error);
        reject(
          new Error(
            `Failed to destroy database: ${deleteRequest.error?.message}`
          )
        );
      };

      deleteRequest.onblocked = () => {
        debugWarn(
          "⚠️ Database deletion blocked - close all tabs using this database"
        );
        // Continue anyway, the deletion will complete when other connections close
      };
    });
  }
}

/**
 * Factory function to create unified storage
 */
export function createUnifiedStorage(config: StorageConfig): UnifiedStorage {
  return new UnifiedStorageImpl(config);
}

// Export the interface for external use
export type { UnifiedStorage };
