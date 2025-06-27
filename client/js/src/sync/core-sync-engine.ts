//! Core Sync Engine - Phase 4.3 Implementation
//!
//! This module implements the core synchronization engine with:
//! - State management and cursor tracking
//! - Incremental sync algorithms
//! - Conflict detection and resolution
//! - Real-time event system integration
//! - Robust error handling and retry logic

import { ApiClient } from "../lib/api-client.js";
import { WebSocketConnection } from "../lib/websocket-connection.js";
import {
  SyncConfig,
  SyncResponse,
  SyncProgress,
  SyncError,
  SyncConflict,
  SyncCapabilities,
  SyncStatusResponse,
  SyncRecommendationsResponse,
  validateSyncConfig,
  safeParseSyncResponse,
  safeParseSyncStatus,
  safeParseSyncRecommendations,
  IncrementalSyncQuery,
  FullSyncQuery,
  SyncAckRequest,
} from "./sync-schemas.js";
import { PersistentSyncState, SyncSessionState } from "./sync-state.js";
import { createSyncEventSystem, SyncEventType } from "./sync-events.js";
import type { MediaBlob } from "../lib/websocket-types.js";
import { SyncStorageManager } from "./sync-storage.js";

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
 * Core sync engine state
 */
interface SyncEngineState {
  isInitialized: boolean;
  isOnline: boolean;
  currentOperation: "idle" | "incremental" | "full" | "paused";
  lastSyncAttempt: Date;
  serverCapabilities: SyncCapabilities | null;
  retryCount: number;
  maxRetries: number;
}

/**
 * Core Sync Engine implementation
 */
export class CoreSyncEngine {
  private config: SyncConfig;
  private apiClient: ApiClient;
  private wsConnection: WebSocketConnection | null = null;
  private persistentState: PersistentSyncState;
  private sessionState: SyncSessionState | null = null;
  private storage: SyncStorageManager | null = null;
  private eventSystem: ReturnType<typeof createSyncEventSystem>;
  private abortController: AbortController | null = null;
  private state: SyncEngineState;

  constructor(config: Partial<SyncConfig>, apiClient: ApiClient) {
    // Validate and set config with defaults
    this.config = validateSyncConfig({
      apiBaseUrl: "http://localhost:8080",
      authToken: "",
      clientId: crypto.randomUUID(),
      ...config,
    });

    this.apiClient = apiClient;
    this.persistentState = PersistentSyncState.load(this.config.clientId);

    // Initialize event system
    this.eventSystem = createSyncEventSystem(
      crypto.randomUUID(), // session ID
      this.config.clientId
    );

    // Initialize state
    this.state = {
      isInitialized: false,
      isOnline: navigator.onLine,
      currentOperation: "idle",
      lastSyncAttempt: new Date(0),
      serverCapabilities: null,
      retryCount: 0,
      maxRetries: this.config.maxRetryAttempts,
    };

    // Setup network monitoring
    this.setupNetworkMonitoring();
  }

  /**
   * Initialize the sync engine
   */
  async initialize(): Promise<void> {
    if (this.state.isInitialized) {
      return;
    }

    try {
      // Initialize storage if enabled
      if (this.config.enableStorage) {
        this.storage = new SyncStorageManager({
          database_name: `media_sync_${this.config.clientId}`,
          max_storage_size: this.config.maxStorageSize,
          max_cache_age_days: this.config.maxCacheAge,
          store_binary_data: this.config.includeBinaryData,
        });
        await this.storage.initialize();
      }

      // Fetch server capabilities
      if (this.state.isOnline) {
        await this.fetchServerCapabilities();
      }

      // Initialize WebSocket connection for real-time sync
      await this.initializeWebSocket();

      this.state.isInitialized = true;
      console.log("✅ Core Sync Engine initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize sync engine:", error);
      throw new Error(`Sync engine initialization failed: ${error}`);
    }
  }

  /**
   * Start a sync operation
   */
  async sync(options: SyncOptions = {}): Promise<void> {
    if (!this.state.isInitialized) {
      await this.initialize();
    }

    // Check if we can sync
    if (!this.canSync()) {
      throw new Error("Cannot sync: offline or operation in progress");
    }

    // Check sync interval unless forced
    if (!options.force && !this.shouldSync()) {
      console.log("⏭️ Skipping sync due to minimum interval");
      return;
    }

    const isFullSync =
      options.fullSync || this.persistentState.status === "Never";

    // Create session state
    this.sessionState = new SyncSessionState(
      crypto.randomUUID(),
      this.persistentState
    );

    // Create abort controller for this sync
    this.abortController = new AbortController();

    try {
      this.state.currentOperation = isFullSync ? "full" : "incremental";
      this.state.lastSyncAttempt = new Date();

      // Emit sync started event
      this.eventSystem.emit(this.eventSystem.builder.syncStarted(isFullSync));

      // Perform the sync
      if (isFullSync) {
        await this.performFullSync(options);
      } else {
        await this.performIncrementalSync(options);
      }

      // Mark as completed
      this.state.currentOperation = "idle";
      this.state.retryCount = 0;

      const duration = Date.now() - this.sessionState.startTime.getTime();
      this.eventSystem.emit(
        this.eventSystem.builder.syncCompleted(
          this.sessionState.itemsInCurrentSession,
          duration,
          this.sessionState.conflicts.filter((c) => c.resolved).length
        )
      );
    } catch (error) {
      await this.handleSyncError(error as Error);
    } finally {
      this.abortController = null;
      this.state.currentOperation = "idle";
    }
  }

  /**
   * Pause the current sync operation
   */
  pauseSync(): void {
    if (this.abortController && this.state.currentOperation !== "idle") {
      this.abortController.abort();
      this.persistentState.markPaused();
      this.state.currentOperation = "paused";

      this.eventSystem.emit(this.eventSystem.builder.syncPaused("user", true));
    }
  }

  /**
   * Resume a paused sync operation
   */
  async resumeSync(): Promise<void> {
    if (this.persistentState.status === "Paused") {
      const options: SyncOptions = {
        resumeCursor: this.persistentState.lastCursor,
        force: true,
      };

      this.eventSystem.emit(
        this.eventSystem.builder.syncResumed(this.persistentState.lastCursor)
      );

      await this.sync(options);
    }
  }

  /**
   * Get current sync status and progress
   */
  getSyncStatus(): SyncProgress {
    const status = this.persistentState.status;
    const sessionItems = this.sessionState?.itemsInCurrentSession || 0;

    return {
      status,
      items_synced: sessionItems,
      current_cursor: this.persistentState.lastCursor,
    };
  }

  /**
   * Get sync recommendations from server
   */
  async getSyncRecommendations(): Promise<SyncRecommendationsResponse | null> {
    try {
      const response =
        await this.apiClient.makeRequest<SyncRecommendationsResponse>(
          "GET",
          "/api/sync/recommendations"
        );

      const validation = safeParseSyncRecommendations(response);
      if (!validation.success) {
        console.warn(
          "Invalid sync recommendations response:",
          validation.error
        );
        return null;
      }

      return validation.data;
    } catch (error) {
      console.error("Failed to fetch sync recommendations:", error);
      return null;
    }
  }

  /**
   * Event listener management
   */
  on(eventType: string | SyncEventType, listener: (event: any) => void): void {
    this.eventSystem.on(eventType as any, listener);
  }

  once(
    eventType: string | SyncEventType,
    listener: (event: any) => void
  ): void {
    this.eventSystem.once(eventType as any, listener);
  }

  off(eventType: string | SyncEventType, listener: (event: any) => void): void {
    this.eventSystem.off(eventType as any, listener);
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }

    if (this.wsConnection) {
      this.wsConnection.disconnect();
    }

    if (this.storage) {
      await this.storage.cleanup?.();
    }

    // Clean up event listeners
    this.eventSystem.emitter.removeAllListeners();
    this.state.isInitialized = false;
  }

  // Private methods

  private async performFullSync(options: SyncOptions): Promise<void> {
    console.log("🔄 Starting full sync...");

    const query: FullSyncQuery = {
      batch_size: options.pageSize || this.config.batchSize,
      start_cursor: options.resumeCursor,
      include_data: options.includeBinaryData ?? this.config.includeBinaryData,
      mime_types: options.mimeTypes?.join(","),
    };

    let cursor: string | undefined = query.start_cursor;
    let totalSynced = 0;

    do {
      this.checkAborted();

      const response = await this.apiClient.makeRequest<SyncResponse>(
        "GET",
        "/api/sync/media/full",
        {
          params: { ...query, start_cursor: cursor },
        }
      );

      const validation = safeParseSyncResponse(response);
      if (!validation.success) {
        throw new Error(`Invalid sync response: ${validation.error.message}`);
      }

      const syncData = validation.data;

      // Process batch
      await this.processSyncBatch(syncData, totalSynced);

      totalSynced += syncData.items.length;
      cursor = syncData.pagination.next_cursor;

      // Update persistent state
      this.persistentState.updateAfterSync(
        new Date(syncData.sync_timestamp),
        syncData.items.length,
        cursor
      );

      // Emit batch completed
      this.eventSystem.emit(
        this.eventSystem.builder.syncBatchCompleted(
          this.sessionState!.currentBatch,
          syncData.items.length,
          cursor,
          syncData.pagination.has_more
        )
      );
    } while (cursor && !this.abortController?.signal.aborted);

    console.log(`✅ Full sync completed: ${totalSynced} items`);
  }

  private async performIncrementalSync(options: SyncOptions): Promise<void> {
    console.log("⚡ Starting incremental sync...");

    const query: IncrementalSyncQuery = {
      last_sync_time: this.persistentState.lastSyncTime.toISOString(),
      cursor: options.resumeCursor || this.persistentState.lastCursor,
      page_size: options.pageSize || this.config.batchSize,
      include_data: options.includeBinaryData ?? this.config.includeBinaryData,
      mime_types: options.mimeTypes?.join(","),
    };

    let cursor: string | undefined = query.cursor;
    let totalSynced = 0;

    do {
      this.checkAborted();

      const response = await this.apiClient.makeRequest<SyncResponse>(
        "GET",
        "/api/sync/media",
        {
          params: { ...query, cursor },
        }
      );

      const validation = safeParseSyncResponse(response);
      if (!validation.success) {
        throw new Error(`Invalid sync response: ${validation.error.message}`);
      }

      const syncData = validation.data;

      if (syncData.items.length === 0) {
        console.log("📋 No new items to sync");
        break;
      }

      // Process batch
      await this.processSyncBatch(syncData, totalSynced);

      totalSynced += syncData.items.length;
      cursor = syncData.pagination.next_cursor;

      // Update persistent state
      this.persistentState.updateAfterSync(
        new Date(syncData.sync_timestamp),
        syncData.items.length,
        cursor
      );

      // Send acknowledgment
      await this.sendSyncAcknowledgment(syncData, []);
    } while (cursor && !this.abortController?.signal.aborted);

    console.log(`✅ Incremental sync completed: ${totalSynced} items`);
  }

  private async processSyncBatch(
    syncData: SyncResponse,
    totalSynced: number
  ): Promise<void> {
    this.sessionState!.currentBatch++;

    // Emit items received
    this.eventSystem.emit(
      this.eventSystem.builder.itemsReceived(
        syncData.items,
        this.sessionState!.currentBatch,
        totalSynced + syncData.items.length
      )
    );

    // Process each item
    const failedItems: string[] = [];
    let processedCount = 0;

    for (const item of syncData.items) {
      try {
        await this.processMediaBlobItem(item);
        processedCount++;
      } catch (error) {
        console.error(`Failed to process item ${item.id}:`, error);
        failedItems.push(item.id);
      }

      this.sessionState!.itemsInCurrentSession++;

      // Emit progress update
      const progress: SyncProgress = {
        status: "InProgress",
        items_synced: this.sessionState!.itemsInCurrentSession,
        current_cursor: syncData.pagination.next_cursor,
        current_batch: this.sessionState!.currentBatch,
      };

      this.eventSystem.emit(this.eventSystem.builder.syncProgress(progress));
    }

    // Emit items processed
    this.eventSystem.emit(
      this.eventSystem.builder.itemsProcessed(
        processedCount,
        failedItems.length,
        this.sessionState!.itemsInCurrentSession
      )
    );

    // Store items if storage is enabled
    if (this.storage) {
      for (const item of syncData.items) {
        if (!failedItems.includes(item.id)) {
          await this.storage.storeMediaBlob(item);
        }
      }
    }
  }

  private async processMediaBlobItem(item: MediaBlob): Promise<void> {
    // Check for conflicts if we have local storage
    if (this.storage) {
      const existingItem = await this.storage.getMediaBlob(item.id);
      if (existingItem) {
        const conflict = await this.detectConflict(
          item,
          existingItem as MediaBlob
        );
        if (conflict) {
          this.sessionState!.addConflict(conflict);

          this.eventSystem.emit(
            this.eventSystem.builder.syncConflict(conflict)
          );

          // Try auto-resolution
          if (this.config.conflictResolution !== "manual") {
            await this.tryAutoResolveConflict(conflict);
          }
          return;
        }
      }
    }

    // Process the item (validation, transformation, etc.)
    console.log(`Processing item: ${item.id}`);
  }

  private async detectConflict(
    serverItem: MediaBlob,
    localItem: MediaBlob
  ): Promise<SyncConflict | null> {
    // Simple conflict detection based on timestamps and content
    const serverTime = new Date(serverItem.updated_at);
    const localTime = new Date(localItem.updated_at);

    if (serverTime.getTime() !== localTime.getTime()) {
      return {
        id: crypto.randomUUID(),
        media_blob_id: serverItem.id,
        type: "version",
        local_version: localItem,
        server_version: serverItem,
        detected_at: new Date().toISOString(),
        resolved: false,
      };
    }

    return null;
  }

  private async tryAutoResolveConflict(conflict: SyncConflict): Promise<void> {
    let resolution: "keep_local" | "keep_server" | "merge" | "skip";

    switch (this.config.conflictResolution) {
      case "keep_local":
        resolution = "keep_local";
        break;
      case "keep_server":
        resolution = "keep_server";
        break;
      default:
        return; // Manual resolution required
    }

    conflict.resolved = true;
    conflict.resolution = resolution;

    this.eventSystem.emit(
      this.eventSystem.builder.syncConflictResolved(conflict.id, resolution)
    );
  }

  private async sendSyncAcknowledgment(
    syncData: SyncResponse,
    failedItems: string[]
  ): Promise<void> {
    const ackRequest: SyncAckRequest = {
      sync_timestamp: syncData.sync_timestamp,
      items_synced: syncData.items.length - failedItems.length,
      failed_items: failedItems,
    };

    try {
      await this.apiClient.makeRequest("POST", "/api/sync/media/acknowledge", {
        data: ackRequest,
      });
    } catch (error) {
      console.warn("Failed to send sync acknowledgment:", error);
    }
  }

  private async fetchServerCapabilities(): Promise<void> {
    try {
      const response = await this.apiClient.makeRequest<SyncStatusResponse>(
        "GET",
        "/api/sync/status"
      );

      const validation = safeParseSyncStatus(response);
      if (validation.success) {
        this.state.serverCapabilities = validation.data.capabilities;
        console.log("📊 Server capabilities fetched");
      }
    } catch (error) {
      console.warn("Failed to fetch server capabilities:", error);
    }
  }

  private async initializeWebSocket(): Promise<void> {
    // Initialize WebSocket connection for real-time notifications
    try {
      this.wsConnection = new WebSocketConnection({
        url: this.config.apiBaseUrl.replace("http", "ws") + "/ws",
      });

      // Listen for real-time sync notifications
      this.wsConnection.addEventListener("message", (event: Event) => {
        if (!(event instanceof MessageEvent)) return;
        try {
          const data = JSON.parse(event.data);
          if (
            data.type === "media_blob_updated" ||
            data.type === "media_blob_created"
          ) {
            // Trigger incremental sync for real-time updates
            this.handleRealtimeUpdate(data);
          }
        } catch (e) {
          console.warn("Failed to parse WebSocket message:", e);
        }
      });

      await this.wsConnection.connect();
    } catch (error) {
      console.warn("WebSocket initialization failed:", error);
    }
  }

  private async handleRealtimeUpdate(
    _notificationData: unknown
  ): Promise<void> {
    // Only trigger auto-sync if we're not already syncing
    if (this.state.currentOperation === "idle") {
      console.log("📱 Real-time update detected, triggering incremental sync");

      // Small delay to batch multiple rapid updates
      setTimeout(() => {
        if (this.state.currentOperation === "idle") {
          this.sync({ force: false }).catch(console.error);
        }
      }, 1000);
    }
  }

  private async handleSyncError(error: Error): Promise<void> {
    this.state.retryCount++;
    this.persistentState.markFailed();

    const syncError: SyncError = {
      type: "sync_error",
      message: error.message,
      timestamp: new Date().toISOString(),
      recoverable: this.state.retryCount < this.state.maxRetries,
      retry_delay: Math.min(1000 * Math.pow(2, this.state.retryCount), 30000),
    };

    this.sessionState?.addError(syncError);

    this.eventSystem.emit(
      this.eventSystem.builder.syncFailed(
        syncError,
        syncError.recoverable || false
      )
    );

    // Auto-retry if recoverable
    if (syncError.recoverable) {
      console.log(
        `🔄 Retrying sync in ${syncError.retry_delay}ms (attempt ${this.state.retryCount})`
      );
      setTimeout(() => {
        this.sync({ force: true }).catch(console.error);
      }, syncError.retry_delay);
    }
  }

  private canSync(): boolean {
    return this.state.isOnline && this.state.currentOperation === "idle";
  }

  private shouldSync(): boolean {
    if (!this.state.serverCapabilities) {
      return true; // Sync if we don't know the interval
    }

    const minInterval = this.state.serverCapabilities.min_sync_interval * 1000;
    const timeSinceLastSync = Date.now() - this.state.lastSyncAttempt.getTime();

    return timeSinceLastSync >= minInterval;
  }

  private setupNetworkMonitoring(): void {
    const handleOnline = () => {
      this.state.isOnline = true;
      this.eventSystem.emit(
        this.eventSystem.builder.connectionChanged(true, true)
      );
    };

    const handleOffline = () => {
      this.state.isOnline = false;
      this.eventSystem.emit(
        this.eventSystem.builder.connectionChanged(false, false)
      );
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
  }

  private checkAborted(): void {
    if (this.abortController?.signal.aborted) {
      throw new Error("Sync operation was aborted");
    }
  }
}

/**
 * Factory function to create a configured sync engine
 */
export function createSyncEngine(
  config: Partial<SyncConfig>,
  apiClient: ApiClient
): CoreSyncEngine {
  return new CoreSyncEngine(config, apiClient);
}
