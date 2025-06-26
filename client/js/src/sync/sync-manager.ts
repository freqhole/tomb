//! Core sync manager that orchestrates all sync operations
//!
//! This module provides the main SyncManager class that coordinates
//! sync operations, manages state, handles conflicts, and provides
//! a unified API for client-side synchronization.

import { ApiClient } from "../lib/api-client.js";
import {
  MediaBlob,
  SyncRequest,
  SyncResponse,
  SyncStatus,
  SyncProgress,
  SyncError,
  SyncConflict,
  PersistentSyncState,
  SyncSessionState,
  SyncCapabilities,
  FullSyncRequest,
  SyncAcknowledgment,
} from "./sync-state.js";
import { createSyncEventSystem } from "./sync-events.js";
import {
  SyncStorageManager,
  StoredMediaBlob,
  OfflineOperationType,
  StorageQueryOptions,
} from "./sync-storage.js";

/**
 * Configuration options for the sync manager
 */
export interface SyncManagerConfig {
  /** API client for server communication */
  apiClient: ApiClient;
  /** Client identifier for sync tracking */
  clientId: string;
  /** Default page size for sync batches */
  defaultPageSize: number;
  /** Maximum page size allowed */
  maxPageSize: number;
  /** Minimum interval between syncs in milliseconds */
  minSyncInterval: number;
  /** Maximum retry attempts for failed operations */
  maxRetryAttempts: number;
  /** Base retry delay in milliseconds */
  baseRetryDelay: number;
  /** Whether to include binary data in sync by default */
  includeBinaryData: boolean;
  /** Storage configuration */
  storage: {
    /** Whether to enable local storage */
    enabled: boolean;
    /** Maximum storage size in bytes */
    maxSize: number;
    /** Maximum cache age in days */
    maxCacheAge: number;
  };
  /** Conflict resolution strategy */
  conflictResolution: {
    /** Default resolution for conflicts */
    defaultStrategy: "keep_local" | "keep_server" | "manual";
    /** Whether to auto-resolve simple conflicts */
    autoResolveSimple: boolean;
  };
}

/**
 * Sync operation options
 */
export interface SyncOptions {
  /** Whether this is a full sync */
  fullSync?: boolean;
  /** Page size for this sync operation */
  pageSize?: number;
  /** Whether to include binary data */
  includeBinaryData?: boolean;
  /** MIME type filters */
  mimeTypes?: string[];
  /** Force sync even if recently synced */
  force?: boolean;
  /** Resume from specific cursor */
  resumeCursor?: string;
}

/**
 * Main sync manager class
 */
export class SyncManager {
  private config: SyncManagerConfig;
  private persistentState: PersistentSyncState;
  private sessionState: SyncSessionState | null = null;
  private storage: SyncStorageManager | null = null;
  private eventSystem: ReturnType<typeof createSyncEventSystem>;
  // Server capabilities are fetched but not actively used in current implementation
  // private serverCapabilities: SyncCapabilities | null = null;
  private lastSyncAttempt: Date = new Date(0);
  private currentSyncPromise: Promise<void> | null = null;
  private isOnline: boolean = navigator.onLine;
  private abortController: AbortController | null = null;

  constructor(config: SyncManagerConfig) {
    this.config = config;
    this.persistentState = PersistentSyncState.load(config.clientId);

    // Create event system
    this.eventSystem = createSyncEventSystem(
      crypto.randomUUID(), // session ID
      config.clientId
    );

    // Initialize storage if enabled
    if (config.storage.enabled) {
      this.storage = new SyncStorageManager({
        database_name: `webauthn_sync_${config.clientId}`,
        max_storage_size: config.storage.maxSize,
        max_cache_age_days: config.storage.maxCacheAge,
        store_binary_data: config.includeBinaryData,
      });
    }

    // Monitor online status
    this.setupNetworkMonitoring();
  }

  /**
   * Initialize the sync manager
   */
  async initialize(): Promise<void> {
    // Initialize storage
    if (this.storage) {
      await this.storage.initialize();
    }

    // Fetch server capabilities
    try {
      await this.fetchServerCapabilities();
    } catch (error) {
      console.warn("Failed to fetch server capabilities:", error);
    }

    // Process any pending offline operations
    if (this.storage && this.isOnline) {
      await this.processPendingOfflineOperations();
    }
  }

  /**
   * Start a sync operation
   */
  async sync(options: SyncOptions = {}): Promise<void> {
    // Prevent concurrent syncs
    if (this.currentSyncPromise) {
      console.log("Sync already in progress, waiting for completion...");
      await this.currentSyncPromise;
      return;
    }

    // Check if we should sync based on interval
    if (!options.force && !this.shouldSync()) {
      console.log("Skipping sync due to minimum interval not reached");
      return;
    }

    // Check online status
    if (!this.isOnline) {
      throw new Error("Cannot sync while offline");
    }

    this.currentSyncPromise = this.performSync(options);

    try {
      await this.currentSyncPromise;
    } finally {
      this.currentSyncPromise = null;
    }
  }

  /**
   * Pause the current sync operation
   */
  pauseSync(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.persistentState.markPaused();

      if (this.sessionState) {
        this.eventSystem.emit(
          this.eventSystem.builder.syncPaused("user", true)
        );
      }
    }
  }

  /**
   * Resume a paused sync operation
   */
  async resumeSync(): Promise<void> {
    if (this.persistentState.status === SyncStatus.Paused) {
      const options: SyncOptions = {
        resumeCursor: this.persistentState.lastCursor,
      };

      this.eventSystem.emit(
        this.eventSystem.builder.syncResumed(options.resumeCursor)
      );

      await this.sync(options);
    }
  }

  /**
   * Force a full resync
   */
  async fullResync(): Promise<void> {
    this.persistentState.reset();

    await this.sync({
      fullSync: true,
      force: true,
    });
  }

  /**
   * Get current sync status
   */
  getSyncStatus(): SyncProgress {
    const session = this.sessionState;

    return {
      status: this.persistentState.status,
      items_synced: session?.itemsInCurrentSession || 0,
      total_items: undefined, // Will be updated during sync
      progress: undefined,
      current_cursor: this.persistentState.lastCursor,
      current_batch: session?.currentBatch || 0,
    };
  }

  /**
   * Get unresolved conflicts
   */
  async getConflicts(): Promise<SyncConflict[]> {
    if (!this.storage) {
      return [];
    }

    return this.storage.getUnresolvedConflicts();
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    conflictId: string,
    resolution: "keep_local" | "keep_server" | "merge" | "skip"
  ): Promise<void> {
    if (!this.storage) {
      throw new Error("Storage not enabled");
    }

    await this.storage.resolveConflict(conflictId, resolution);

    this.eventSystem.emit(
      this.eventSystem.builder.syncConflictResolved(conflictId, resolution)
    );
  }

  /**
   * Get cached media blobs
   */
  async getCachedItems(
    options: StorageQueryOptions = {}
  ): Promise<StoredMediaBlob[]> {
    if (!this.storage) {
      return [];
    }

    return this.storage.queryMediaBlobs(options);
  }

  /**
   * Add event listener
   */
  on = (eventType: any, listener: any) =>
    this.eventSystem.on(eventType, listener);

  /**
   * Add one-time event listener
   */
  once = (eventType: any, listener: any) =>
    this.eventSystem.once(eventType, listener);

  /**
   * Remove event listener
   */
  off = (eventType: any, listener: any) =>
    this.eventSystem.off(eventType, listener);

  /**
   * Add global event listener
   */
  onAny = (listener: any) => this.eventSystem.onAny(listener);

  /**
   * Remove global event listener
   */
  offAny = (listener: any) => this.eventSystem.offAny(listener);

  /**
   * Cleanup and close resources
   */
  async cleanup(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }

    if (this.storage) {
      await this.storage.close();
    }

    this.eventSystem.emitter.removeAllListeners();
  }

  // Private methods

  /**
   * Perform the actual sync operation
   */
  private async performSync(options: SyncOptions): Promise<void> {
    const sessionId = crypto.randomUUID();
    this.sessionState = new SyncSessionState(sessionId, this.persistentState);
    this.abortController = new AbortController();

    try {
      this.lastSyncAttempt = new Date();
      this.persistentState.status = SyncStatus.InProgress;
      this.persistentState.save();

      // Emit sync started event
      this.eventSystem.emit(
        this.eventSystem.builder.syncStarted(
          options.fullSync || false,
          undefined // Will be updated as we learn more
        )
      );

      if (
        options.fullSync ||
        this.persistentState.lastSyncTime.getTime() === 0
      ) {
        await this.performFullSync(options);
      } else {
        await this.performIncrementalSync(options);
      }

      // Mark as complete
      this.persistentState.status = SyncStatus.Complete;
      this.persistentState.save();

      // Emit completion event
      this.eventSystem.emit(
        this.eventSystem.builder.syncCompleted(
          this.sessionState.itemsInCurrentSession,
          this.sessionState.getSessionDuration(),
          this.sessionState.conflicts.filter((c) => c.resolved).length
        )
      );
    } catch (error) {
      this.handleSyncError(error as Error);
    } finally {
      this.abortController = null;
      if (this.sessionState) {
        this.sessionState.clear();
      }
    }
  }

  /**
   * Perform full sync operation
   */
  private async performFullSync(options: SyncOptions): Promise<void> {
    const request: FullSyncRequest = {
      client_id: this.config.clientId,
      batch_size: options.pageSize || this.config.defaultPageSize,
      start_cursor: options.resumeCursor,
      include_data: options.includeBinaryData ?? this.config.includeBinaryData,
      mime_types: options.mimeTypes,
    };

    let hasMore = true;
    let cursor: string | undefined = request.start_cursor;

    while (hasMore && !this.abortController?.signal.aborted) {
      const response = await this.config.apiClient.makeRequest<SyncResponse>(
        "GET",
        "/api/sync/media/full",
        {
          params: {
            ...request,
            start_cursor: cursor,
          },
        }
      );

      await this.processSyncResponse(response, true);

      hasMore = response.pagination.has_more;
      cursor = response.pagination.next_cursor;

      // Update persistent state
      this.persistentState.updateAfterSync(
        new Date(response.sync_timestamp),
        response.items.length,
        cursor
      );

      // Emit batch completed event
      this.eventSystem.emit(
        this.eventSystem.builder.syncBatchCompleted(
          this.sessionState!.currentBatch,
          response.items.length,
          cursor,
          hasMore
        )
      );

      // Respect suggested delay
      if (hasMore && response.pagination.suggested_delay) {
        await this.delay(response.pagination.suggested_delay * 1000);
      }
    }
  }

  /**
   * Perform incremental sync operation
   */
  private async performIncrementalSync(options: SyncOptions): Promise<void> {
    const request: SyncRequest = {
      client_id: this.config.clientId,
      last_sync_time: this.persistentState.lastSyncTime.toISOString(),
      cursor: options.resumeCursor || this.persistentState.lastCursor,
      page_size: options.pageSize || this.config.defaultPageSize,
      include_data: options.includeBinaryData ?? this.config.includeBinaryData,
      mime_types: options.mimeTypes,
    };

    let hasMore = true;
    let cursor = request.cursor;

    while (hasMore && !this.abortController?.signal.aborted) {
      const response = await this.config.apiClient.makeRequest<SyncResponse>(
        "GET",
        "/api/sync/media",
        {
          params: {
            ...request,
            cursor,
          },
        }
      );

      await this.processSyncResponse(response, false);

      hasMore = response.pagination.has_more;
      cursor = response.pagination.next_cursor;

      // Update persistent state
      this.persistentState.updateAfterSync(
        new Date(response.sync_timestamp),
        response.items.length,
        cursor
      );

      // Emit batch completed event
      this.eventSystem.emit(
        this.eventSystem.builder.syncBatchCompleted(
          this.sessionState!.currentBatch,
          response.items.length,
          cursor,
          hasMore
        )
      );

      // Respect suggested delay
      if (hasMore && response.pagination.suggested_delay) {
        await this.delay(response.pagination.suggested_delay * 1000);
      }
    }
  }

  /**
   * Process sync response and handle items
   */
  private async processSyncResponse(
    response: SyncResponse,
    isFullSync: boolean
  ): Promise<void> {
    this.sessionState!.currentBatch++;
    this.sessionState!.itemsInCurrentSession += response.items.length;

    // Emit items received event
    this.eventSystem.emit(
      this.eventSystem.builder.itemsReceived(
        response.items,
        this.sessionState!.currentBatch,
        this.sessionState!.itemsInCurrentSession
      )
    );

    // Process each item
    let processedCount = 0;
    let failedCount = 0;

    for (const item of response.items) {
      try {
        await this.processMediaBlobItem(item, isFullSync);
        processedCount++;
      } catch (error) {
        console.error(`Failed to process item ${item.id}:`, error);
        failedCount++;

        // Create error record
        const syncError: SyncError = {
          type: "processing_error",
          message: `Failed to process item: ${error}`,
          timestamp: new Date().toISOString(),
          context: { item_id: item.id },
          recoverable: true,
        };

        this.sessionState!.addError(syncError);
      }
    }

    // Emit items processed event
    this.eventSystem.emit(
      this.eventSystem.builder.itemsProcessed(
        processedCount,
        failedCount,
        this.sessionState!.itemsInCurrentSession
      )
    );

    // Update progress
    if (response.total_items) {
      const progress: SyncProgress = {
        status: SyncStatus.InProgress,
        items_synced: this.sessionState!.itemsInCurrentSession,
        total_items: response.total_items,
        progress:
          (this.sessionState!.itemsInCurrentSession / response.total_items) *
          100,
        current_cursor: response.pagination.next_cursor,
        current_batch: this.sessionState!.currentBatch,
        total_batches: response.pagination.progress
          ? Math.ceil(response.total_items / response.pagination.batch_size)
          : undefined,
      };

      this.eventSystem.emit(this.eventSystem.builder.syncProgress(progress));
    }

    // Send acknowledgment to server
    await this.sendSyncAcknowledgment(response, processedCount, failedCount);
  }

  /**
   * Process individual media blob item
   */
  private async processMediaBlobItem(
    item: MediaBlob,
    _isFullSync: boolean
  ): Promise<void> {
    if (!this.storage) {
      return; // No storage, just skip
    }

    // Check if item already exists locally
    const existingItem = await this.storage.getMediaBlob(item.id, false);

    if (existingItem) {
      // Check for conflicts
      const conflict = await this.detectConflict(existingItem, item);
      if (conflict) {
        await this.storage.storeConflict(conflict);
        this.sessionState!.addConflict(conflict);

        this.eventSystem.emit(this.eventSystem.builder.syncConflict(conflict));

        // Try to auto-resolve if configured
        if (this.config.conflictResolution.autoResolveSimple) {
          await this.tryAutoResolveConflict(conflict);
        }

        return;
      }
    }

    // Store the item
    await this.storage.storeMediaBlob(item, true, false);
  }

  /**
   * Detect conflicts between local and server versions
   */
  private async detectConflict(
    local: StoredMediaBlob,
    server: MediaBlob
  ): Promise<SyncConflict | null> {
    // Simple conflict detection based on timestamps and local modifications
    if (local.locally_modified) {
      const localTime = new Date(local.updated_at);
      const serverTime = new Date(server.updated_at);

      if (serverTime > localTime) {
        return {
          id: crypto.randomUUID(),
          media_blob_id: server.id,
          type: "version",
          local_version: local,
          server_version: server,
          detected_at: new Date().toISOString(),
          resolved: false,
        };
      }
    }

    return null;
  }

  /**
   * Try to automatically resolve simple conflicts
   */
  private async tryAutoResolveConflict(conflict: SyncConflict): Promise<void> {
    let resolution: "keep_local" | "keep_server" | "merge" | "skip" | null =
      null;

    // Apply default strategy for simple cases
    switch (this.config.conflictResolution.defaultStrategy) {
      case "keep_local":
        resolution = "keep_local";
        break;
      case "keep_server":
        resolution = "keep_server";
        break;
      case "manual":
        return; // Don't auto-resolve
    }

    if (resolution) {
      await this.resolveConflict(conflict.id, resolution);
    }
  }

  /**
   * Send sync acknowledgment to server
   */
  private async sendSyncAcknowledgment(
    response: SyncResponse,
    processedCount: number,
    _failedCount: number
  ): Promise<void> {
    const failedItems = this.sessionState!.errors.filter(
      (e) => e.context?.item_id
    ).map((e) => e.context!.item_id as string);

    const acknowledgment: SyncAcknowledgment = {
      client_id: this.config.clientId,
      sync_timestamp: response.sync_timestamp,
      items_synced: processedCount,
      failed_items: failedItems,
      client_sync_state: this.persistentState.toClientSyncState(),
    };

    try {
      await this.config.apiClient.makeRequest(
        "POST",
        "/api/sync/media/acknowledge",
        {
          data: acknowledgment,
        }
      );
    } catch (error) {
      console.warn("Failed to send sync acknowledgment:", error);
      // Non-fatal error, continue with sync
    }
  }

  /**
   * Process pending offline operations
   */
  private async processPendingOfflineOperations(): Promise<void> {
    if (!this.storage) {
      return;
    }

    const operations = await this.storage.getPendingOperations();

    for (const operation of operations) {
      try {
        await this.processOfflineOperation(operation);
        await this.storage.completeOfflineOperation(operation.id);
      } catch (error) {
        console.error(
          `Failed to process offline operation ${operation.id}:`,
          error
        );

        const syncError: SyncError = {
          type: "offline_operation_error",
          message: `Failed to process offline operation: ${error}`,
          timestamp: new Date().toISOString(),
          context: { operation_id: operation.id },
          recoverable: true,
        };

        await this.storage.failOfflineOperation(operation.id, syncError);
      }
    }
  }

  /**
   * Process individual offline operation
   */
  private async processOfflineOperation(operation: any): Promise<void> {
    // Implementation depends on the specific operation type
    // This would typically involve API calls to sync the operation to the server
    switch (operation.type) {
      case OfflineOperationType.Create:
        // Handle create operation
        break;
      case OfflineOperationType.Update:
        // Handle update operation
        break;
      case OfflineOperationType.Delete:
        // Handle delete operation
        break;
    }
  }

  /**
   * Fetch server capabilities
   */
  private async fetchServerCapabilities(): Promise<void> {
    try {
      await this.config.apiClient.makeRequest<{
        capabilities: SyncCapabilities;
      }>("GET", "/api/sync/status");

      // Store capabilities for future use
      // this.serverCapabilities = response.capabilities;
    } catch (error) {
      console.warn("Failed to fetch server capabilities:", error);
    }
  }

  /**
   * Handle sync errors
   */
  private handleSyncError(error: Error): void {
    this.persistentState.markFailed();

    const syncError: SyncError = {
      type: "sync_error",
      message: error.message,
      timestamp: new Date().toISOString(),
      recoverable: true,
      retry_delay: this.config.baseRetryDelay,
    };

    this.eventSystem.emit(
      this.eventSystem.builder.syncFailed(
        syncError,
        true,
        this.config.baseRetryDelay
      )
    );
  }

  /**
   * Check if sync should run based on interval
   */
  private shouldSync(): boolean {
    const timeSinceLastAttempt = Date.now() - this.lastSyncAttempt.getTime();
    return timeSinceLastAttempt >= this.config.minSyncInterval;
  }

  /**
   * Setup network monitoring
   */
  private setupNetworkMonitoring(): void {
    const updateOnlineStatus = () => {
      const wasOnline = this.isOnline;
      this.isOnline = navigator.onLine;

      if (wasOnline !== this.isOnline) {
        this.eventSystem.emit(
          this.eventSystem.builder.connectionChanged(
            this.isOnline,
            this.isOnline
          )
        );

        // If we came back online, process pending operations
        if (this.isOnline && this.storage) {
          this.processPendingOfflineOperations().catch((error) => {
            console.error(
              "Failed to process pending operations after coming online:",
              error
            );
          });
        }
      }
    };

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a sync manager with default configuration
 */
export function createSyncManager(
  apiClient: ApiClient,
  clientId: string,
  overrides: Partial<SyncManagerConfig> = {}
): SyncManager {
  const defaultConfig: SyncManagerConfig = {
    apiClient,
    clientId,
    defaultPageSize: 50,
    maxPageSize: 100,
    minSyncInterval: 30 * 1000, // 30 seconds
    maxRetryAttempts: 3,
    baseRetryDelay: 1000, // 1 second
    includeBinaryData: false,
    storage: {
      enabled: true,
      maxSize: 100 * 1024 * 1024, // 100MB
      maxCacheAge: 30, // 30 days
    },
    conflictResolution: {
      defaultStrategy: "manual",
      autoResolveSimple: false,
    },
    ...overrides,
  };

  return new SyncManager(defaultConfig);
}
