//! Local storage management for offline sync capabilities
//!
//! This module provides client-side storage for media blobs, sync metadata,
//! and offline operations using IndexedDB. It supports caching, conflict
//! resolution, and efficient data retrieval for sync operations.

import { MediaBlob, SyncConflict, SyncError } from "./sync-state.js";

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
 * Offline operation types
 */
export enum OfflineOperationType {
  Create = "create",
  Update = "update",
  Delete = "delete",
}

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
  /** Operation data */
  data: any;
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
  /** Whether to store binary data locally */
  store_binary_data: boolean;
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
      version: 1,
      max_storage_size: 100 * 1024 * 1024, // 100MB default
      max_cache_age_days: 30,
      store_binary_data: true,
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
      mediaStore.createIndex("sha256", "sha256", { unique: true });
      mediaStore.createIndex("synced", "synced");
      mediaStore.createIndex("locally_modified", "locally_modified");
      mediaStore.createIndex("created_at", "created_at");
      mediaStore.createIndex("mime", "mime");
      mediaStore.createIndex("stored_at", "stored_at");
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
      conflictsStore.createIndex("media_blob_id", "media_blob_id");
      conflictsStore.createIndex("resolved", "resolved");
      conflictsStore.createIndex("detected_at", "detected_at");
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
                  const { data, ...blobWithoutData } = blob;
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
   * Queue an offline operation
   */
  async queueOfflineOperation(
    type: OfflineOperationType,
    mediaBlobId: string,
    data: any
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

    const [mediaStats, operationsCount, conflictsCount] = await Promise.all([
      this.getMediaBlobStats(),
      this.getOperationsCount(),
      this.getConflictsCount(),
    ]);

    return {
      ...mediaStats,
      pending_operations: operationsCount,
      conflicts: conflictsCount,
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

    if (options.mime_pattern && blob.mime) {
      const pattern = new RegExp(options.mime_pattern, "i");
      if (!pattern.test(blob.mime)) {
        return false;
      }
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

  private async calculateContentHash(blob: MediaBlob): Promise<string> {
    // Simple hash based on key properties
    const content = JSON.stringify({
      sha256: blob.sha256,
      size: blob.size,
      mime: blob.mime,
      metadata: blob.metadata,
      updated_at: blob.updated_at,
    });

    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  private calculateStorageSize(blob: MediaBlob): number {
    let size = 0;

    // Estimate size of all properties
    size += JSON.stringify(blob).length * 2; // UTF-16 encoding

    // Add binary data size if present
    if (blob.data) {
      size += blob.data.length;
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
