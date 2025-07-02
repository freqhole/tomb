//! Unified Sync Manager - Core Implementation
//!
//! This is the main implementation of the new unified sync system. It provides
//! a single, clean interface for synchronizing multiple domains (music, photos,
//! documents, etc.) with automatic WebSocket-based updates and service worker support.

import { SyncStatus, SyncEventType } from "./types.js";

import type {
  UnifiedSyncManager,
  SyncDomain,
  SyncAllOptions,
  SyncDomainOptions,
  SyncResult,
  SyncStatusMap,
  SyncProgressMap,
  SyncProgress,
  SyncEventListener,
  AnySyncEvent,
  SyncStartedEvent,
  SyncProgressEvent,
  SyncCompletedEvent,
  SyncFailedEvent,
  AutoSyncTriggeredEvent,
  // ConnectionChangedEvent,
  DomainConfig,
  WebSocketNotification,
  UnifiedSyncConfig,
  SyncError,
  BinarySyncStats,
} from "./types.js";

import type { UnifiedStorage } from "./unified-storage.js";
import type { WebSocketClient } from "../lib/websocket-client.js";
import type { ApiClient } from "../lib/api-client.js";
import { createDomainConfigs } from "./domain-configs.js";
import type { ServiceWorkerSyncManager } from "./service-worker-types.js";
import {
  createServiceWorkerSyncManager,
  isServiceWorkerSyncSupported,
} from "./service-worker-sync-manager.js";

/**
 * Main unified sync manager implementation
 */
export class UnifiedSyncManagerImpl implements UnifiedSyncManager {
  private storage: UnifiedStorage;
  // @ts-ignore - Will be used for WebSocket notifications in Phase 2
  private wsClient: WebSocketClient;
  // @ts-ignore - Used for direct API calls in sync operations
  private apiClient: ApiClient;
  private config: UnifiedSyncConfig;
  private domainConfigs: Record<SyncDomain, DomainConfig>;

  // State tracking
  private currentStatus: SyncStatusMap;
  private currentProgress: SyncProgressMap;
  private activeSyncs = new Set<SyncDomain>();
  private eventListeners = new Map<SyncEventType, Set<SyncEventListener>>();

  // Auto-sync state
  // @ts-ignore - Will be used for auto-sync features in Phase 3
  private autoSyncEnabled = false;
  private autoSyncTimeouts = new Map<SyncDomain, NodeJS.Timeout>();
  private notificationQueue: WebSocketNotification[] = [];
  private debounceTimeout?: NodeJS.Timeout;

  // Service worker integration
  private serviceWorkerSyncManager: ServiceWorkerSyncManager | null = null;

  constructor(
    storage: UnifiedStorage,
    wsClient: WebSocketClient,
    apiClient: ApiClient,
    config: UnifiedSyncConfig
  ) {
    this.storage = storage;
    this.wsClient = wsClient;
    this.apiClient = apiClient;
    this.config = config;
    this.domainConfigs = createDomainConfigs();

    // Initialize status tracking
    this.currentStatus = {
      music: SyncStatus.Never,
      photos: SyncStatus.Never,
      documents: SyncStatus.Never,
      videos: SyncStatus.Never,
    };

    this.currentProgress = {
      music: this.createEmptyProgress(),
      photos: this.createEmptyProgress(),
      documents: this.createEmptyProgress(),
      videos: this.createEmptyProgress(),
    };
  }

  /**
   * Initialize the sync manager
   */
  async initialize(): Promise<void> {
    console.log("🚀 Initializing UnifiedSyncManager...");

    // Initialize storage
    await this.storage.initialize();

    // Set up WebSocket listeners
    this.setupWebSocketListeners();

    // Load previous sync states
    await this.loadSyncStates();

    // Enable auto-sync if configured
    if (this.config.autoSync.enabled) {
      this.enableAutoSync(true);
    }

    // Initialize service worker sync if enabled and supported
    if (this.config.serviceWorker?.enabled && isServiceWorkerSyncSupported()) {
      try {
        this.serviceWorkerSyncManager = createServiceWorkerSyncManager(
          this,
          this.config.serviceWorker
        );
        await this.serviceWorkerSyncManager.initialize();
        console.log("✅ Service Worker sync initialized");
      } catch (error) {
        console.warn("⚠️ Service Worker sync initialization failed:", error);
      }
    }

    console.log("✅ UnifiedSyncManager initialized");
  }

  /**
   * Sync all domains
   */
  async syncAll(options: SyncAllOptions = {}): Promise<SyncResult> {
    console.log("🔄 Starting sync all domains...");

    const startTime = Date.now();
    const domainsToSync =
      options.domains || (Object.keys(this.domainConfigs) as SyncDomain[]);
    const priorityOrder = options.priorityOrder || domainsToSync;

    // Sort domains by priority
    const orderedDomains = priorityOrder.filter((domain) =>
      domainsToSync.includes(domain)
    );

    // Add any missing domains at the end
    domainsToSync.forEach((domain) => {
      if (!orderedDomains.includes(domain)) {
        orderedDomains.push(domain);
      }
    });

    const results: SyncResult[] = [];
    let totalItemsSynced = 0;
    const errors: SyncError[] = [];

    // Emit started event
    this.emitEvent({
      type: SyncEventType.Started,
      timestamp: new Date(),
      domain: orderedDomains[0], // First domain
      isFullSync: options.forceFullSync || false,
    } as SyncStartedEvent);

    // Sync each domain in order
    for (const domain of orderedDomains) {
      try {
        const domainOptions: SyncDomainOptions = {
          forceFullSync: options.forceFullSync,
          includeBinaryData: options.includeBinaryData,
        };

        const result = await this.syncDomain(domain, domainOptions);
        results.push(result);
        totalItemsSynced += result.itemsSynced;

        if (result.errors.length > 0) {
          errors.push(...result.errors);
        }
      } catch (error) {
        console.error(`❌ Failed to sync domain ${domain}:`, error);
        const syncError: SyncError = {
          code: "DOMAIN_SYNC_FAILED",
          message: `Failed to sync ${domain}: ${error instanceof Error ? error.message : String(error)}`,
          details: error,
        };
        errors.push(syncError);
      }
    }

    const duration = Date.now() - startTime;
    const finalStatus =
      errors.length > 0 ? SyncStatus.Failed : SyncStatus.Complete;

    // Create aggregate result
    const aggregateResult: SyncResult = {
      domain: "music", // Primary domain for now
      status: finalStatus,
      itemsSynced: totalItemsSynced,
      totalItems: results.reduce((sum, r) => sum + r.totalItems, 0),
      duration,
      errors,
      binaryStats: this.aggregateBinaryStats(results),
    };

    // Emit completion event
    this.emitEvent({
      type: SyncEventType.AllCompleted,
      timestamp: new Date(),
      result: aggregateResult,
    } as SyncCompletedEvent);

    console.log(
      `✅ Sync all completed: ${totalItemsSynced} items in ${duration}ms`
    );
    return aggregateResult;
  }

  /**
   * Sync a specific domain
   */
  async syncDomain(
    domain: SyncDomain,
    options: SyncDomainOptions = {}
  ): Promise<SyncResult> {
    console.log(`🔄 Starting sync for domain: ${domain}`);

    if (this.activeSyncs.has(domain)) {
      throw new Error(`Sync already in progress for domain: ${domain}`);
    }

    this.activeSyncs.add(domain);
    this.updateStatus(domain, SyncStatus.InProgress);

    const startTime = Date.now();
    const errors: SyncError[] = [];

    try {
      // Emit started event
      this.emitEvent({
        type: SyncEventType.Started,
        timestamp: new Date(),
        domain,
        isFullSync: options.forceFullSync || false,
      } as SyncStartedEvent);

      // Step 1: Sync structured data
      const structuredResult = await this.syncStructuredData(domain, options);

      // Step 2: Binary data sync via WebSocket
      let binaryStats: BinarySyncStats | undefined;
      if (options.includeBinaryData && domain === "music") {
        console.log("🔄 Starting binary data sync...");
        binaryStats = await this.syncBinaryData();
      }

      const duration = Date.now() - startTime;
      const result: SyncResult = {
        domain,
        status: SyncStatus.Complete,
        itemsSynced: structuredResult.itemsSynced,
        totalItems: structuredResult.totalItems,
        duration,
        binaryStats,
        errors,
      };

      // Update status
      this.updateStatus(domain, SyncStatus.Complete);
      this.updateProgress(domain, {
        status: SyncStatus.Complete,
        progress: 100,
        itemsProcessed: result.itemsSynced,
        totalItems: result.totalItems,
        currentBatch: 1,
        totalBatches: 1,
        currentOperation: "Complete",
      });

      // Emit completion event
      this.emitEvent({
        type: SyncEventType.DomainCompleted,
        timestamp: new Date(),
        domain,
        result,
      } as SyncCompletedEvent);

      console.log(
        `✅ Domain ${domain} sync completed: ${result.itemsSynced} items`
      );
      return result;
    } catch (error) {
      console.error(`❌ Domain ${domain} sync failed:`, error);

      const syncError: SyncError = {
        code: "SYNC_FAILED",
        message: error instanceof Error ? error.message : String(error),
        details: error,
      };
      errors.push(syncError);

      this.updateStatus(domain, SyncStatus.Failed);

      // Emit failure event
      this.emitEvent({
        type: SyncEventType.Failed,
        timestamp: new Date(),
        domain,
        error: syncError,
      } as SyncFailedEvent);

      const duration = Date.now() - startTime;
      return {
        domain,
        status: SyncStatus.Failed,
        itemsSynced: 0,
        totalItems: 0,
        duration,
        errors,
      };
    } finally {
      this.activeSyncs.delete(domain);
    }
  }

  /**
   * Get a blob URL for media content
   */
  async getBlobUrl(blobId: string): Promise<string | null> {
    try {
      // Check if we have cached raw binary data
      const binaryData = await this.storage.getBinaryData(blobId);
      if (binaryData) {
        // Get metadata from media_blobs table (as per plan)
        const mediaBlobs = await this.storage.getItems("documents"); // media_blobs table
        const mediaBlob = mediaBlobs.find((blob: any) => blob.id === blobId);

        if (mediaBlob) {
          // Create blob URL from cached data using metadata from media_blobs
          const blob = new Blob([binaryData], {
            type: mediaBlob.mime || "application/octet-stream",
          });
          return URL.createObjectURL(blob);
        }
      }

      // Fall back to direct API URL
      return `${this.config.apiBaseUrl}/blobs/${blobId}`;
    } catch (error) {
      console.error(`Failed to get blob URL for ${blobId}:`, error);
      return null;
    }
  }

  /**
   * Enable/disable auto-sync
   */
  enableAutoSync(enabled: boolean): void {
    console.log(`${enabled ? "🔄 Enabling" : "⏸️ Disabling"} auto-sync...`);

    this.autoSyncEnabled = enabled;

    if (enabled) {
      // Set up periodic sync if configured
      if (this.config.autoSync.periodicInterval) {
        this.setupPeriodicSync();
      }
    } else {
      // Clear all auto-sync timeouts
      this.autoSyncTimeouts.forEach((timeout) => clearTimeout(timeout));
      this.autoSyncTimeouts.clear();

      if (this.debounceTimeout) {
        clearTimeout(this.debounceTimeout);
        this.debounceTimeout = undefined;
      }
    }
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatusMap {
    return { ...this.currentStatus };
  }

  /**
   * Get current sync progress
   */
  getProgress(): SyncProgressMap {
    return {
      music: { ...this.currentProgress.music },
      photos: { ...this.currentProgress.photos },
      documents: { ...this.currentProgress.documents },
      videos: { ...this.currentProgress.videos },
    };
  }

  /**
   * Completely destroy all data and reset the system
   */
  async destroyAll(): Promise<void> {
    console.log("💥 Starting complete system teardown...");

    try {
      // Disable auto-sync first
      this.enableAutoSync(false);

      // Clear all active syncs
      this.activeSyncs.clear();

      // Reset status and progress
      this.currentStatus = {
        music: SyncStatus.Never,
        photos: SyncStatus.Never,
        documents: SyncStatus.Never,
        videos: SyncStatus.Never,
      };

      this.currentProgress = {
        music: this.createEmptyProgress(),
        photos: this.createEmptyProgress(),
        documents: this.createEmptyProgress(),
        videos: this.createEmptyProgress(),
      };

      // Destroy all storage data
      await this.storage.destroyAll();

      console.log("🗑️ Complete system teardown successful");

      // Emit teardown event
      this.emitEvent({
        type: SyncEventType.AllCompleted,
        timestamp: new Date(),
        result: {
          domain: "music",
          status: SyncStatus.Complete,
          itemsSynced: 0,
          totalItems: 0,
          duration: 0,
          errors: [],
        },
      });
    } catch (error) {
      console.error("❌ Failed to destroy system:", error);
      throw new Error(`System teardown failed: ${error}`);
    }
  }

  /**
   * Get media blobs for image grid
   */
  async getMediaBlobs(): Promise<any[]> {
    try {
      const mediaBlobs = await this.storage.getItems("documents");
      return mediaBlobs.filter(
        (blob: any) => blob.mime && blob.mime.startsWith("image/")
      );
    } catch (error) {
      console.error("Failed to get media blobs:", error);
      return [];
    }
  }

  /**
   * Subscribe to sync events
   */
  on(event: SyncEventType, listener: SyncEventListener): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * Unsubscribe from sync events
   */
  off(event: SyncEventType, listener: SyncEventListener): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Get service worker sync manager (if available)
   */
  async getServiceWorkerSyncManager(): Promise<ServiceWorkerSyncManager | null> {
    return this.serviceWorkerSyncManager;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    console.log("🧹 Destroying UnifiedSyncManager...");

    // Clear auto-sync timeouts
    this.enableAutoSync(false);

    // Cleanup service worker sync manager
    if (this.serviceWorkerSyncManager) {
      await this.serviceWorkerSyncManager.destroy();
      this.serviceWorkerSyncManager = null;
    }

    // Clear event listeners
    this.eventListeners.clear();

    // Clear active syncs
    this.activeSyncs.clear();

    console.log("✅ UnifiedSyncManager destroyed");
  }

  // Private helper methods

  private async syncStructuredData(
    domain: SyncDomain,
    options: SyncDomainOptions
  ) {
    const domainConfig = this.domainConfigs[domain];

    // For music domain, sync songs, playlists, and playlist_songs together
    if (domain === "music") {
      return this.syncMusicDomain(options);
    }

    const pageSize =
      options.pageSize || domainConfig.defaultOptions.pageSize || 50;

    // Get cursor for incremental sync
    let cursor: string | null = null;
    if (!options.forceFullSync) {
      // TODO: Get last sync cursor from storage
      cursor = null; // For now, always do full sync
    }

    let page = 0;
    let totalItemsSynced = 0;
    let totalItems = 0;
    let hasMore = true;

    while (
      hasMore &&
      (!options.maxItems || totalItemsSynced < options.maxItems)
    ) {
      page++;
      console.log(`📄 Syncing ${domain} page ${page}...`);

      // Build query parameters
      const queryParams: URLSearchParams = new URLSearchParams({
        page_size: pageSize.toString(),
        ...(cursor && { cursor }),
      });

      // Make API request using simple fetch
      const url = `${this.config.apiBaseUrl}${domainConfig.endpoints.sync}?${queryParams}`;
      const response: Response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.authToken && {
            Authorization: `Bearer ${this.config.authToken}`,
          }),
        },
      });

      if (!response.ok) {
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}`
        );
      }

      const data: any = await response.json();
      const items = data.items || [];
      totalItems = data.total_count || items.length;

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      // Transform and store items
      const transformedItems = items.map((item: any) =>
        domainConfig.transforms.toStorage(domainConfig.transforms.fromApi(item))
      );

      await this.storage.storeItems(domain, transformedItems);
      totalItemsSynced += items.length;

      // Update progress
      this.updateProgress(domain, {
        status: SyncStatus.InProgress,
        progress: Math.min(100, (totalItemsSynced / totalItems) * 100),
        itemsProcessed: totalItemsSynced,
        totalItems,
        currentBatch: page,
        totalBatches: Math.ceil(totalItems / pageSize),
        currentOperation: `Syncing ${domain} data`,
      });

      // Emit progress event
      this.emitEvent({
        type: SyncEventType.Progress,
        timestamp: new Date(),
        domain,
        progress: this.currentProgress[domain],
      } as SyncProgressEvent);

      // Update cursor for next page
      cursor = data.next_cursor;
      hasMore = !!cursor && items.length === pageSize;

      // Respect maxItems limit
      if (options.maxItems && totalItemsSynced >= options.maxItems) {
        break;
      }
    }

    return { itemsSynced: totalItemsSynced, totalItems };
  }

  /**
   * Unified music domain sync - handles songs, playlists, and playlist_songs together
   */
  private async syncMusicDomain(options: SyncDomainOptions) {
    console.log("🎵 Starting unified music domain sync...");

    let totalItemsSynced = 0;
    let totalItems = 0;

    // 1. Sync songs first
    console.log("🎵 Syncing songs...");
    const songsResult = await this.syncMusicDataType("songs", options);
    totalItemsSynced += songsResult.itemsSynced;
    totalItems += songsResult.totalItems;

    // 2. Sync playlists
    console.log("📋 Syncing playlists...");
    const playlistsResult = await this.syncMusicDataType("playlists", options);
    totalItemsSynced += playlistsResult.itemsSynced;
    totalItems += playlistsResult.totalItems;

    // 3. Sync playlist_songs relationships
    console.log("🔗 Syncing playlist songs...");
    const playlistSongsResult = await this.syncMusicDataType(
      "playlist-songs",
      options
    );
    totalItemsSynced += playlistSongsResult.itemsSynced;
    totalItems += playlistSongsResult.totalItems;

    // 4. Sync media_blobs (the metadata, not binary data)
    console.log("📦 Syncing media blobs...");
    const mediaBlobsResult = await this.syncMediaBlobs(options);
    totalItemsSynced += mediaBlobsResult.itemsSynced;
    totalItems += mediaBlobsResult.totalItems;

    console.log(
      `✅ Unified music sync complete: ${totalItemsSynced} total items`
    );
    return { itemsSynced: totalItemsSynced, totalItems };
  }

  /**
   * Sync a specific music data type (songs, playlists, playlist-songs)
   */
  private async syncMusicDataType(
    dataType: string,
    options: SyncDomainOptions
  ) {
    const pageSize = Math.min(options.pageSize || 50, 100); // Cap at 100 items
    const endpoint =
      dataType === "songs"
        ? `/api/sync/songs`
        : dataType === "playlists"
          ? `/api/sync/playlists`
          : `/api/sync/playlist-songs`;

    let cursor: string | null = null;
    let totalItemsSynced = 0;
    let hasMore = true;
    let page = 0;
    const maxPages = 20; // Safety limit to prevent infinite loops

    console.log(`🚀 Starting ${dataType} sync with pageSize: ${pageSize}`);

    while (
      hasMore &&
      page < maxPages &&
      (!options.maxItems || totalItemsSynced < options.maxItems)
    ) {
      page++;

      try {
        const queryParams = new URLSearchParams({
          page_size: pageSize.toString(),
        });

        if (cursor !== null) {
          queryParams.set("cursor", cursor);
        }

        const url = `${this.config.apiBaseUrl}${endpoint}?${queryParams}`;
        console.log(
          `🔄 Syncing ${dataType} page ${page}/${maxPages} from: ${url}`
        );

        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...(this.config.authToken && {
              Authorization: `Bearer ${this.config.authToken}`,
            }),
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to sync ${dataType}: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        const items = data.items || [];
        const pagination = data.pagination || {};

        console.log(`📊 ${dataType} page ${page} response:`, {
          itemsCount: items.length,
          hasMore: pagination.has_more || false,
          nextCursor: pagination.next_cursor || null,
        });

        if (items.length === 0) {
          console.log(`📭 No more ${dataType} items, stopping sync`);
          break;
        }

        // Safety check for data size
        const itemSizeCheck = JSON.stringify(items).length;
        if (itemSizeCheck > 10 * 1024 * 1024) {
          // 10MB limit
          console.warn(`⚠️ Large ${dataType} response: ${itemSizeCheck} bytes`);
        }

        // Transform and store items directly to correct table
        const domainConfig = this.domainConfigs["music"];
        const transformedItems = items
          .map((item: any) => {
            try {
              return domainConfig.transforms.toStorage(
                domainConfig.transforms.fromApi(item)
              );
            } catch (error) {
              console.error(
                `❌ Transform error for ${dataType} item:`,
                item,
                error
              );
              return null;
            }
          })
          .filter((item: any) => item !== null);

        console.log(
          `🔄 Storing ${transformedItems.length} ${dataType} items to storage`
        );

        // Store directly to the correct table
        await this.storeToMusicTable(dataType, transformedItems);
        totalItemsSynced += items.length;

        // Use server's pagination info
        hasMore = pagination.has_more || false;
        cursor = pagination.next_cursor || null;

        console.log(
          `✅ Synced ${dataType} page ${page}: ${items.length} items (total: ${totalItemsSynced})`
        );
      } catch (error) {
        console.error(`❌ Failed to sync ${dataType} page ${page}:`, error);
        break; // Exit the while loop on error
      }
    }

    console.log(
      `🎯 Completed ${dataType} sync: ${totalItemsSynced} total items`
    );
    return { itemsSynced: totalItemsSynced, totalItems: totalItemsSynced };
  }

  /**
   * Sync media blobs metadata (not binary data)
   */
  private async syncMediaBlobs(
    options: SyncDomainOptions
  ): Promise<{ itemsSynced: number; totalItems: number }> {
    const pageSize = options.pageSize || 50;
    const endpoint = `/api/sync/media`;

    let cursor: string | null = null;
    let totalItemsSynced = 0;
    let hasMore = true;
    let page = 0;

    while (
      hasMore &&
      (!options.maxItems || totalItemsSynced < options.maxItems)
    ) {
      page++;

      const queryParams = new URLSearchParams({
        page_size: pageSize.toString(),
        include_data: "false", // We only want metadata, not binary data
      });

      if (cursor !== null) {
        queryParams.set("cursor", cursor);
      }

      const url = `${this.config.apiBaseUrl}${endpoint}?${queryParams}`;
      console.log(`🔄 Syncing media_blobs page ${page} from: ${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.authToken && {
            Authorization: `Bearer ${this.config.authToken}`,
          }),
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to sync media_blobs: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      const items = data.items || [];
      const pagination = data.pagination || {};

      console.log(`📊 media_blobs page ${page} response:`, {
        itemsCount: items.length,
        hasMore: pagination.has_more || false,
        nextCursor: pagination.next_cursor || null,
      });

      if (items.length === 0) {
        break;
      }

      // Store media blobs to media_blobs table
      console.log(`🔄 Storing ${items.length} media_blobs items to storage`);

      await this.storage.storeItemsToTable("media_blobs", items);
      totalItemsSynced += items.length;

      // Use server's pagination info
      hasMore = pagination.has_more || false;
      cursor = pagination.next_cursor || null;

      console.log(
        `✅ Synced media_blobs page ${page}: ${items.length} items (total: ${totalItemsSynced})`
      );
    }

    console.log(
      `🎯 Completed media_blobs sync: ${totalItemsSynced} total items`
    );
    return { itemsSynced: totalItemsSynced, totalItems: totalItemsSynced };
  }

  /**
   * Store items directly to the correct music table
   */
  private async storeToMusicTable(
    dataType: string,
    items: any[]
  ): Promise<void> {
    const tableName =
      dataType === "songs"
        ? "songs"
        : dataType === "playlists"
          ? "playlists"
          : "playlist_songs";

    // Store directly using the storage's table-specific method
    if (tableName === "songs") {
      await this.storage.storeItemsToTable("songs", items);
    } else if (tableName === "playlists") {
      await this.storage.storeItemsToTable("playlists", items);
    } else {
      await this.storage.storeItemsToTable("playlist_songs", items);
    }
  }

  /**
   * Sync binary data for media blobs using WebSocket
   */
  private async syncBinaryData(): Promise<BinarySyncStats> {
    const startTime = Date.now();
    let itemsSynced = 0;
    let totalBytes = 0;
    let errors: string[] = [];

    try {
      // Get all media blobs that need binary data
      const mediaBlobs = await this.storage.getItems("documents"); // media_blobs table is used for documents domain
      console.log(
        `📦 Found ${mediaBlobs.length} media blobs to check for binary data`
      );

      for (const blob of mediaBlobs) {
        try {
          // Skip if we already have binary data cached
          const existingData = await this.storage.getBinaryData(blob.id);
          if (existingData) {
            console.log(`✅ Skipping ${blob.id} - already cached`);
            continue;
          }

          console.log(`🔄 Requesting binary data for blob ${blob.id}...`);

          // Request binary data via WebSocket
          const binaryData = await this.requestBinaryDataViaWebSocket(blob.id);

          if (binaryData) {
            // Store binary data (metadata comes from media_blobs table as per plan)
            await this.storage.storeBinaryData(blob.id, binaryData);

            itemsSynced++;
            totalBytes += binaryData.byteLength;
            console.log(
              `✅ Cached binary data for ${blob.id} (${binaryData.byteLength} bytes)`
            );
          }
        } catch (error) {
          const errorMsg = `Failed to sync binary data for ${blob.id}: ${error}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }
      }

      const duration = Date.now() - startTime;
      const skipped = mediaBlobs.length - itemsSynced - errors.length;
      console.log(
        `🎉 Binary sync complete: ${itemsSynced} cached, ${skipped} skipped, ${errors.length} failed, ${totalBytes} bytes in ${duration}ms`
      );

      return {
        cached: itemsSynced,
        skipped,
        failed: errors.length,
        bytesDownloaded: totalBytes,
      };
    } catch (error) {
      const errorMsg = `Binary sync failed: ${error}`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Request binary data for a blob via WebSocket and wait for binary response
   */
  private async requestBinaryDataViaWebSocket(
    blobId: string
  ): Promise<ArrayBuffer | null> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for binary data for blob ${blobId}`));
      }, 10000); // 10 second timeout

      // Create a direct WebSocket connection for binary frames
      const wsUrl = this.config.websocketUrl || "ws://localhost:3000/ws";

      const binarySocket = new WebSocket(wsUrl);

      binarySocket.onopen = () => {
        console.log(`🔌 Binary WebSocket connected for blob ${blobId}`);

        // Send GetMediaBlobData request
        const request = {
          type: "GetMediaBlobData",
          data: { id: blobId },
        };

        const requestJson = JSON.stringify(request);
        console.log(`📤 Sending binary request for ${blobId}:`, requestJson);
        binarySocket.send(requestJson);
        console.log(`✅ Binary request sent for ${blobId}`);
      };

      binarySocket.onmessage = (event) => {
        console.log(`🔍 Binary WebSocket message for ${blobId}:`, {
          dataType: typeof event.data,
          isArrayBuffer: event.data instanceof ArrayBuffer,
          isBlob: event.data instanceof Blob,
          size: event.data.byteLength || event.data.size || event.data.length,
          data:
            event.data instanceof ArrayBuffer
              ? "ArrayBuffer"
              : event.data instanceof Blob
                ? "Blob"
                : typeof event.data === "string"
                  ? event.data.substring(0, 100)
                  : "Unknown",
        });

        if (event.data instanceof ArrayBuffer) {
          // This is our binary response!
          console.log(
            `📦 Received ArrayBuffer for ${blobId} (${event.data.byteLength} bytes)`
          );
          clearTimeout(timeout);
          binarySocket.close();
          resolve(event.data);
        } else if (event.data instanceof Blob) {
          // Handle Blob response - convert to ArrayBuffer
          console.log(
            `📦 Received Blob for ${blobId} (${event.data.size} bytes), converting to ArrayBuffer...`
          );
          event.data
            .arrayBuffer()
            .then((arrayBuffer) => {
              console.log(
                `✅ Converted Blob to ArrayBuffer for ${blobId} (${arrayBuffer.byteLength} bytes)`
              );
              clearTimeout(timeout);
              binarySocket.close();
              resolve(arrayBuffer);
            })
            .catch((error) => {
              console.error(
                `❌ Failed to convert Blob to ArrayBuffer for ${blobId}:`,
                error
              );
              clearTimeout(timeout);
              binarySocket.close();
              reject(
                new Error(`Failed to convert Blob to ArrayBuffer: ${error}`)
              );
            });
        } else if (typeof event.data === "string") {
          // Handle potential JSON error responses
          try {
            const response = JSON.parse(event.data);
            console.log(`📝 JSON response for ${blobId}:`, response);
            if (response.type === "Error") {
              clearTimeout(timeout);
              binarySocket.close();
              reject(new Error(`Server error: ${response.data.message}`));
              return;
            }
            // Check for other response types that might indicate success
            if (
              response.type === "Welcome" ||
              response.type === "ConnectionStatus"
            ) {
              console.log(`ℹ️ Ignoring non-data response: ${response.type}`);
              return;
            }
          } catch (e) {
            console.log(
              `⚠️ Non-JSON string response for ${blobId}:`,
              event.data.substring(0, 100)
            );
          }
        }
      };

      binarySocket.onerror = (error) => {
        console.error(`❌ Binary WebSocket error for blob ${blobId}:`, error);
        console.log(
          `🔍 WebSocket state: readyState=${binarySocket.readyState}, url=${binarySocket.url}`
        );
        clearTimeout(timeout);
        reject(new Error(`WebSocket error for blob ${blobId}`));
      };

      binarySocket.onclose = (event) => {
        console.log(
          `🔌 Binary WebSocket closed for blob ${blobId}: code=${event.code}, reason='${event.reason}', wasClean=${event.wasClean}`
        );
        if (event.code !== 1000) {
          console.warn(
            `⚠️ Binary WebSocket closed unexpectedly for blob ${blobId}: ${event.code} ${event.reason}`
          );
          clearTimeout(timeout);
          reject(
            new Error(
              `WebSocket closed unexpectedly for blob ${blobId}: ${event.code} ${event.reason}`
            )
          );
        }
      };
    });
  }

  private setupWebSocketListeners(): void {
    // TODO: Set up WebSocket listeners for sync notifications
    // This will be implemented when we add WebSocket notification support
    console.log("📡 WebSocket listeners ready for sync notifications");
  }

  // @ts-ignore - Will be used for auto-sync notifications in Phase 3
  private handleAutoSyncNotification(
    notification: WebSocketNotification
  ): void {
    console.log(`🔔 Auto-sync notification received:`, notification);

    // Add to notification queue
    this.notificationQueue.push(notification);

    // Debounce multiple notifications
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = setTimeout(() => {
      this.processNotificationQueue();
    }, this.config.autoSync.debounceDelay);
  }

  private async processNotificationQueue(): Promise<void> {
    if (this.notificationQueue.length === 0) return;

    console.log(
      `📥 Processing ${this.notificationQueue.length} sync notifications...`
    );

    // Group notifications by domain
    const domainNotifications = new Map<SyncDomain, WebSocketNotification[]>();

    for (const notification of this.notificationQueue) {
      if (!domainNotifications.has(notification.domain)) {
        domainNotifications.set(notification.domain, []);
      }
      domainNotifications.get(notification.domain)!.push(notification);
    }

    // Clear the queue
    this.notificationQueue = [];

    // Trigger sync for each domain with notifications
    for (const [domain, notifications] of domainNotifications) {
      if (this.config.autoSync.domains.includes(domain)) {
        this.emitEvent({
          type: SyncEventType.AutoSyncTriggered,
          timestamp: new Date(),
          domain,
          trigger: "new_content",
          itemCount: notifications.reduce(
            (sum, n) => sum + n.itemIds.length,
            0
          ),
        } as AutoSyncTriggeredEvent);

        // Trigger incremental sync
        try {
          await this.syncDomain(domain, { includeBinaryData: true });
        } catch (error) {
          console.error(`Auto-sync failed for domain ${domain}:`, error);
        }
      }
    }
  }

  private setupPeriodicSync(): void {
    if (!this.config.autoSync.periodicInterval) return;

    const intervalMs = this.config.autoSync.periodicInterval * 60 * 1000;

    for (const domain of this.config.autoSync.domains) {
      const timeout = setInterval(async () => {
        console.log(`⏰ Periodic sync triggered for ${domain}`);

        this.emitEvent({
          type: SyncEventType.AutoSyncTriggered,
          timestamp: new Date(),
          domain,
          trigger: "periodic",
        } as AutoSyncTriggeredEvent);

        try {
          await this.syncDomain(domain, { includeBinaryData: true });
        } catch (error) {
          console.error(`Periodic sync failed for domain ${domain}:`, error);
        }
      }, intervalMs);

      this.autoSyncTimeouts.set(domain, timeout as any);
    }
  }

  private async loadSyncStates(): Promise<void> {
    // Load last sync states from storage
    const stats = await this.storage.getStats();

    for (const domain of Object.keys(this.currentStatus) as SyncDomain[]) {
      const lastSyncTime = stats.lastSyncTimes[domain];
      if (lastSyncTime) {
        this.currentStatus[domain] = SyncStatus.Complete;
      }
    }
  }

  private updateStatus(domain: SyncDomain, status: SyncStatus): void {
    this.currentStatus[domain] = status;
  }

  private updateProgress(domain: SyncDomain, progress: SyncProgress): void {
    this.currentProgress[domain] = progress;
  }

  private createEmptyProgress(): SyncProgress {
    return {
      status: SyncStatus.Never,
      progress: 0,
      itemsProcessed: 0,
      totalItems: 0,
      currentBatch: 0,
      totalBatches: 0,
    };
  }

  private emitEvent(event: AnySyncEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in sync event listener:`, error);
        }
      });
    }
  }

  private aggregateBinaryStats(
    results: SyncResult[]
  ): BinarySyncStats | undefined {
    const statsArray = results
      .map((r) => r.binaryStats)
      .filter((stats): stats is BinarySyncStats => !!stats);

    if (statsArray.length === 0) return undefined;

    return {
      cached: statsArray.reduce((sum, stats) => sum + stats.cached, 0),
      skipped: statsArray.reduce((sum, stats) => sum + stats.skipped, 0),
      failed: statsArray.reduce((sum, stats) => sum + stats.failed, 0),
      bytesDownloaded: statsArray.reduce(
        (sum, stats) => sum + stats.bytesDownloaded,
        0
      ),
    };
  }
}

/**
 * Factory function to create a unified sync manager
 */
export function createUnifiedSyncManager(
  storage: UnifiedStorage,
  wsClient: WebSocketClient,
  apiClient: ApiClient,
  config: UnifiedSyncConfig
): UnifiedSyncManager {
  return new UnifiedSyncManagerImpl(storage, wsClient, apiClient, config);
}
